# Contributing

How to work on shipyard, and how to extend it without undoing the reason it is small enough to trust. The guiding rule: every change either defends an existing guarantee or adds a new one with its own test. Code without a test for the property it claims is not done.

## Local setup

```bash
pnpm install
pnpm test
pnpm lint
pnpm build
```

Node 22.5 or newer is required because of `node:sqlite`; CI pins Node 24. The scripts are in `package.json`: `dev`, `build`, `start`, `lint`, `test`, `test:watch`, `seed`.

## The layering you must respect

The dependency direction is strictly downward and it is what keeps the domain unit-testable without a server.

| Layer | Files | May depend on |
| --- | --- | --- |
| Transport | `src/app/**`, `src/middleware.ts` | plumbing, domain |
| Plumbing | `src/lib/http.ts`, `src/lib/context.ts` | domain, data |
| Domain | `src/lib/{auth,members,audit,rbac}.ts`, `src/lib/billing/**` | data |
| Data | `src/db/**` | nothing above it |

The data layer must not import HTTP or Next.js. The domain must not import Next.js. If you find yourself reaching upward, the abstraction is in the wrong place. See [Architecture](Architecture).

## Writing an extension: the checklist

Adding a tenant-scoped feature is the most common change, so here is the full discipline. Suppose you add `projects`.

1. **Schema.** Add the interface and `TableDef` to `src/db/schema.ts` with an `organisationId` column and any indexes.
2. **Tenant line.** Add `"projects"` to `TENANT_SCOPED_TABLES`. This single line is what makes the repository inject the tenant predicate. Forgetting it means the table is treated as global and isolation silently does not apply, which is exactly the class of bug shipyard exists to prevent. See [Data Model](Data-Model).
3. **Access.** Read and write only through the scoped repository methods. Never reach for the global helpers on a tenant table; the repository throws `TenantScopeError` if you do.
4. **Service.** Put the business logic in a service under `src/lib/`, taking the `Repository` (and any awkward dependency, like a clock or a provider) as a constructor argument so it is injectable for tests.
5. **Permission.** Gate each privileged operation with `guard(ctx, "projects:create")` (service) or `withGuard({ permission: ... }, handler, req)` (route). Add the permission to `PERMISSIONS` and the right role bundles in `src/lib/rbac.ts`. See [Auth and RBAC](Auth-and-RBAC).
6. **Audit.** Call `recordAudit` inside each privileged operation with `domain.verb` as the action. See [Audit Log](Audit-Log).
7. **Test.** The non-negotiable one: an isolation test. Create a project under tenant A, prove it is invisible and unwritable under tenant B. Copy the cross-tenant-update test in `tests/tenant-isolation.test.ts`. Then test the permission (a holding role passes, a non-holding role is refused) and the happy path.

A worked version of this is in [Examples and Recipes](Examples-and-Recipes).

## Conventions

- **Inject awkward dependencies.** Clocks, providers, stores. The rate limiter takes `now()`; the billing service takes a `BillingProvider`. This is what makes the hard paths deterministic and fast to test.
- **Fail closed.** A missing permission, an unknown session, a user with no membership: refuse, never fall through. Throw a typed error and let `errorResponse` map it.
- **Errors as types, mapped centrally.** New failure classes get their own error type; map it in `errorResponse` (`src/lib/http.ts`). Do not return status codes from the domain.
- **Voice in code.** Short, dry comments where they earn their place, idiomatic TypeScript, naming that reads like one author chose it. Not a comment on every line, not zero.

## Style and checks

- TypeScript is `strict` (`tsconfig.json`). `pnpm build` runs the type check; it must pass.
- `pnpm lint` uses `eslint-config-next` 16 native flat config in `eslint.config.mjs`. Do not wrap it in `FlatCompat`.
- If you add a value type the repository cannot bind, extend `toBind` in `src/db/repository.ts` rather than casting at the call site.

## Commits and pull requests

Commit history should read like a person built this: small, logically ordered commits with specific messages (`fix off-by-one in bucket refill`, not `update code`), spread across `feat`, `fix`, `test`, `docs`, `chore`. The format follows the existing `CHANGELOG.md`, which is Keep a Changelog plus SemVer.

CI runs lint, test and build on Node 24 on every push to `main` and every pull request (`.github/workflows/ci.yml`). A pull request that does not pass all three will not merge. If you change behaviour, update the relevant wiki page; the wiki is mirrored in `wiki/` in the repo so it travels with the code.

## Security findings

Do not open a public issue for a vulnerability. Report privately to security@sarmalinux.com, per `SECURITY.md`. Cross-tenant access, RBAC bypasses and session forgery are exactly the findings I want. See [Security Model](Security-Model).

---
SarmaLinux . sarmalinux.com . [shipyard on GitHub](https://github.com/sarmakska/shipyard)
