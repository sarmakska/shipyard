# Examples and Recipes

Concrete, copy-pasteable tasks against the real code. Each recipe names the files and symbols it touches so you can follow it in the source. The running theme is that almost everything goes through three things: the scoped repository, a permission, and an audit entry.

## Get the demo running

```bash
pnpm install
SHIPYARD_DB_PATH=shipyard.db pnpm seed   # Acme and Globex
pnpm test
SHIPYARD_DB_PATH=shipyard.db pnpm dev     # http://localhost:3000/login
```

Sign in as `owner@acme.test` / `password-acme-123` and open `/app/settings`. The seed (`src/db/seed.ts`) creates two organisations, invites an admin and a viewer to Acme, subscribes Acme to Pro and records 1,234 `api_calls` of usage, so the dashboard has real data.

## Drive the API with curl

```bash
curl -s -c jar.txt -X POST localhost:3000/api/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"o@acme.test","password":"password-acme-123","organisationName":"Acme"}'

curl -s -b jar.txt localhost:3000/api/protected/members
curl -s -b jar.txt -X POST localhost:3000/api/protected/billing \
  -H 'content-type: application/json' -d '{"plan":"pro"}'
curl -s -b jar.txt localhost:3000/api/protected/audit
```

The cookie jar holds the session. Full route docs are in [API Reference](API-Reference).

## Recipe: add a new permission

Say you add a "data export" capability that only owners and admins should have.

1. Add the permission to `PERMISSIONS` in `src/lib/rbac.ts`:

```ts
export const PERMISSIONS = [ /* ... */, "data:export" ] as const;
```

2. Add it to the role bundles that should hold it in `ROLE_PERMISSIONS` (owner already gets all permissions via the spread; add to `admin`).
3. Assert it at the call site: `withGuard({ permission: "data:export" }, handler, req)` in a route, or `guard(ctx, "data:export")` in a service.
4. Add an `rbac.test.ts` case proving an admin passes and a member is refused.

A permission left out of every bundle is held by nobody, which is the fail-closed default. See [Auth and RBAC](Auth-and-RBAC).

## Recipe: add a tenant-scoped feature

Say you add a `projects` table. The obligation is that it goes through the scoped path so isolation applies for free.

1. Add the interface and `TableDef` to `src/db/schema.ts`, with an `organisationId` column.
2. Add `"projects"` to `TENANT_SCOPED_TABLES`. This is the line that makes the repository inject the tenant predicate; without it the table is treated as global and isolation does not apply.
3. Access it only through `repo.insertScoped`, `selectScoped`, `updateScoped`, never the global helpers. The repository will throw `TenantScopeError` if you slip.
4. Gate the privileged operations with a permission and record an audit entry.
5. Add an isolation test: create a project under tenant A, assert it is invisible and unwritable under tenant B. Copy the cross-tenant-update test in `tests/tenant-isolation.test.ts`.

See [Data Model](Data-Model) and [Repository Reference](Repository-Reference).

## Recipe: record a new audit action

Inside any privileged operation, one call:

```ts
import { recordAudit } from "@/lib/audit";

recordAudit(repo, {
  organisationId: ctx.organisationId,
  actorUserId: ctx.user.id,        // or null for a system action
  action: "data.export",            // convention: domain.verb
  metadata: { rows: exported.length },
});
```

It writes through the scoped repository, so the entry is correctly attributed and tenant-isolated. Reads come back newest-first via `listAudit`. See [Audit Log](Audit-Log).

## Recipe: meter usage and enforce a budget

```ts
const billing = new BillingService(db(), provider());
billing.incrementUsage(ctx.organisationId, "api_calls", 1); // throws UsageLimitError (402) over budget
```

The budget is read from the tenant's plan (`budgetFor` in `src/lib/billing/plans.ts`). A `null` budget is unlimited. To add a metric, add it to each plan's `budgets`. An unknown metric returns a budget of `0`, so it is blocked by default until you define it. See [Billing](Billing).

## Recipe: change the rate limit on a route

Add or adjust a group in `RATE_LIMITS` (`src/lib/rate-limit.ts`) and reference it:

```ts
withGuard({ permission: "usage:write", rateLimitGroup: "api" }, handler, req);
```

The key is `organisationId:group`, so each tenant has its own budget per group. For a custom cost per request, `limiter.consume(key, cost)` takes a cost. See [Rate Limiting](Rate-Limiting).

## Recipe: go live with Stripe

1. `pnpm add stripe`.
2. In `src/lib/billing/provider-stripe.ts`, construct a Stripe client from `STRIPE_SECRET_KEY` and replace the three marked calls (`createCustomer`, `createSubscription`, `cancelSubscription`) with the SDK equivalents. The event mapper `mapStripeEvent` and the signature check are already written.
3. Set `STRIPE_PRICE_PRO`, `STRIPE_PRICE_SCALE`, `STRIPE_WEBHOOK_SECRET`, and `BILLING_PROVIDER=stripe`.
4. Add a webhook route that reads the raw body and `Stripe-Signature`, calls `provider.parseWebhook(rawBody, signature)`, then `billing.applyEvent(orgId, event)`.

The signature verification is the security-critical part and it is real and tested. See [Billing](Billing) and [Security Model](Security-Model).

## Recipe: add an OAuth provider

The seam is `AuthService.createSession`. An OAuth callback resolves the provider profile to a local `User` (creating one with `insertGlobal` if needed), then:

```ts
const token = new AuthService(db()).createSession(user.id, organisationId);
setSessionCookie(response, token);
```

Everything downstream, tenant resolution and RBAC, is unchanged because it only ever sees a session. See [Auth and RBAC](Auth-and-RBAC).

## Recipe: inspect the seeded database

```bash
SHIPYARD_DB_PATH=shipyard.db pnpm seed
sqlite3 shipyard.db '.tables'
sqlite3 shipyard.db 'select email, role from users join memberships on users.id = memberships.userId;'
```

The session cookie is httpOnly, so to act as a user from a script use the curl signup/login flow above rather than reading the database for a token (there are no plaintext tokens stored anyway, only hashes).

---
SarmaLinux . sarmalinux.com . [shipyard on GitHub](https://github.com/sarmakska/shipyard)
