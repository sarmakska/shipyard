# Testing Strategy

The tests are the product. shipyard's whole claim is that the isolation and authorisation guarantees hold, and that claim is only as good as the tests that pin it down. This page explains how the suite is structured, what each file proves, why it runs with no service, and how to add a test that defends a new guarantee.

## The shape of the suite

Six files, 29 tests, in `tests/`. They run with Vitest (`vitest.config.ts`) in the `node` environment, against fresh in-memory SQLite databases. On this machine the suite finishes in about 460 ms in process, ~1.04 s wall-clock (see [Performance](Performance)).

```text
$ pnpm test
 Test Files  6 passed (6)
      Tests  29 passed (29)
```

| File | What it proves |
| --- | --- |
| `tenant-isolation.test.ts` | cross-tenant reads return nothing; a smuggled tenant id is overwritten; cross-tenant updates change zero rows; scoped ops on global tables throw |
| `rbac.test.ts` | the role-to-permission map; the guard throws on a missing permission; a viewer is refused; a user with no membership in the tenant fails closed |
| `audit.test.ts` | signup and invites write entries with the right actor, tenant and metadata; entries come back newest first |
| `rate-limit.test.ts` | the bucket allows up to capacity then blocks; refills at the configured rate; never exceeds the ceiling; isolates by key; rejects bad config |
| `billing.test.ts` | subscribe/activate/cancel transitions; illegal and mismatched events rejected; audit writes; usage increments; budgets enforced; unlimited on scale; per-tenant counter isolation |
| `stripe-webhook.test.ts` | a correctly signed payload is accepted and mapped; a tampered or unsigned payload is rejected |

## Hermetic by construction

The single most important testing decision is that every test owns its own database. `tests/helpers.ts`:

```ts
export function freshRepo(): { db: Database; repo: Repository } {
  const db = new Database(":memory:");
  db.migrate();
  return { db, repo: new Repository(db) };
}
```

No file path, no Postgres, no shared singleton. Each test builds a clean in-memory database, migrates it and gets a repository. There is therefore no shared state to leak between cases and no service to stand up in CI. This is also why `node:sqlite` was chosen over `better-sqlite3`: a built-in needs no native compile, so `pnpm install` and the test run work on any machine and any CI runner. See [Design Decisions](Design-Decisions).

The application singletons (`getDatabase`, `db()`) are never touched by tests, because tests construct their own `Database` and `Repository` directly. There is `resetDatabaseSingleton()` and `resetRepository()` for completeness, but the test design avoids needing them.

## How the hard paths are made testable

Two dependencies that would otherwise force a clock or a network are injected, which is what lets the tests be both deterministic and fast.

**The clock.** `RateLimiter` takes a `now()` function. The tests pass a frozen or hand-advanced clock, so refill behaviour is exercised without sleeping:

```ts
let now = 0;
const limiter = new RateLimiter({ capacity: 2, refillPerSecond: 1 }, new MemoryBucketStore(), () => now);
expect(limiter.consume("k").allowed).toBe(true);
expect(limiter.consume("k").allowed).toBe(true);
expect(limiter.consume("k").allowed).toBe(false);
now = 1000; // one token refills
expect(limiter.consume("k").allowed).toBe(true);
```

**The billing provider.** `BillingService` takes a `BillingProvider`. The tests pass `FakeBillingProvider`, which keeps customers and subscriptions in memory and parses webhooks as plain JSON, so the state machine is exercised without Stripe. The one genuinely security-critical Stripe code, the signature check, is tested directly against the real implementation with a real HMAC in `stripe-webhook.test.ts`.

## The test that defines the project

If you read one test, read this one in `tenant-isolation.test.ts`. A legitimate owner of Globex tries to demote an Acme member, holding Acme's real `userId`:

```ts
const acmeMembership = repo.selectScoped(a.organisationId, "memberships")[0] as { userId: string };
const changed = repo.updateScoped(
  b.organisationId, "memberships", { role: "viewer" }, { userId: acmeMembership.userId },
);
expect(changed).toBe(0);
expect((repo.selectScoped(a.organisationId, "memberships")[0] as { role: string }).role).toBe("owner");
```

The update touches zero rows because the tenant predicate is bound to Globex and the target row belongs to Acme, so the two predicates never both hold. There is no second code path that skips the predicate, because the repository is the only way to reach tenant tables. This is the guarantee the whole project is built to give, expressed as an assertion you can run.

## What is unit-tested versus not

The domain (`src/lib/**`, `src/db/**`) is fully unit-tested without a server, because the layering keeps it HTTP-agnostic (see [Architecture](Architecture)). The transport layer (the Next.js routes and middleware) is thin glue over the domain and is not unit-tested in the suite; its behaviour is the composition of `withGuard`, `resolveContext`, the guard and the services, each of which is tested. The coverage config in `vitest.config.ts` reflects this, including only `src/lib/**` and `src/db/**`.

## Adding a test for a new guarantee

The pattern is consistent across the suite:

1. Build a fresh repository with `freshRepo()`.
2. Drive the domain through its real service or helper, not through HTTP.
3. Assert the property, including the negative case. A guarantee is only proved if the violation is shown to be refused.

For a new tenant-scoped feature, the obligatory test is the isolation one: write data under tenant A, prove it is invisible and unwritable under tenant B. Copy the structure of the cross-tenant-update test above. For a new permission, assert both that the holding role passes and a non-holding role is refused, as `rbac.test.ts` does. The negative assertion is the one that matters.

## Running

```bash
pnpm test         # one run
pnpm test:watch   # re-run on change
```

CI runs lint, test and build on Node 24 on every push to `main` and every pull request (`.github/workflows/ci.yml`), so what merges is what passed. See [Contributing](Contributing).

---
SarmaLinux . sarmalinux.com . [shipyard on GitHub](https://github.com/sarmakska/shipyard)
