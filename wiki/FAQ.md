# FAQ

Short answers, each pointing at the page or file with the detail.

### Is this a framework or a product?

Neither. It is a spine: the unglamorous parts of a B2B SaaS (tenant isolation, sessions, RBAC, audit, rate limiting, a billing scaffold) done once and pinned by tests, with the product itself left empty. It is opinionated about the hard parts and deliberately blank where your product lives.

### Can I run it in production as-is?

No, and that is intentional. The SQLite data layer is for dev and tests so the project installs and proves itself with no service. For production you swap the repository onto Postgres and wire the Redis rate-limit store. See [Deployment](Deployment) and [Roadmap](Roadmap).

### Why SQLite and not Postgres from the start?

So `pnpm install` has no native build step and `pnpm test` runs anywhere with nothing running. `node:sqlite` is built into Node, needs no compile, and gives a hermetic test suite. The repository is the seam onto Postgres. The full reasoning, including why not `better-sqlite3`, is in [Design Decisions](Design-Decisions).

### Why no ORM?

The isolation guarantee rests on there being one narrow, readable path to tenant data. The repository is about 230 lines I can read top to bottom. An ORM hides the `WHERE` clause the whole guarantee depends on. See [Design Decisions](Design-Decisions) and [Repository Reference](Repository-Reference).

### How is tenant isolation actually enforced?

Every tenant-scoped statement has `organisationId = @organisationId` injected from the first argument by the repository, not from the caller's filter. A payload or filter cannot override it. The active tenant comes from the session, not the request body. A cross-tenant update matches zero rows. Proved in `tests/tenant-isolation.test.ts`. See [Multi-Tenancy](Multi-Tenancy).

### What stops a user acting on a tenant they do not belong to?

`resolveContext` reads the role from the user's membership in the session's active tenant. No membership means no role, which fails every permission check with a 403. A session pointed at a foreign tenant is refused. Proved by the cross-tenant-session test in `tests/rbac.test.ts`. See [Auth and RBAC](Auth-and-RBAC).

### Where are sessions stored, and is a leak dangerous?

Server-side in the `sessions` table. Only a SHA-256 hash of the token is stored; the plaintext is the httpOnly cookie. A database dump cannot be replayed as a cookie. Expired sessions are deleted on read. See [Security Model](Security-Model).

### Why permissions instead of role checks?

Routes assert a permission (`billing:manage`), roles are bundles of permissions. Direct role checks (`if (role === "admin")`) rot: every new capability forces a revisit of every comparison. Permissions keep call sites readable and let the role table grow without touching them. See [Auth and RBAC](Auth-and-RBAC).

### Why a token bucket for rate limiting?

It gives smooth throttling with controlled bursts, its whole state is two numbers `(tokens, lastRefill)`, and it ports to a Redis Lua script unchanged. A fixed window double-rates at the boundary; a sliding-window log needs a per-key timestamp list. See [Rate Limiting](Rate-Limiting).

### Does the rate limiter work behind multiple instances?

Not out of the box. The default store is in-memory and per-instance, so the effective limit multiplies by the instance count. The `BucketStore` interface exists so you can drop in a Redis store; the algorithm does not change. See [Rate Limiting](Rate-Limiting).

### Does Stripe actually work?

The webhook signature verification is real and tested (HMAC-SHA256 over `timestamp.payload`, constant-time compare). The customer and subscription API calls throw until you `pnpm add stripe` and complete the three marked methods. I will not bundle a payment SDK into a starter. See [Billing](Billing).

### Can a webhook reactivate a canceled subscription?

No. `canceled` is terminal in the state machine, and `applyEvent` rejects an illegal transition with a `BillingError`. It also checks the event's `providerSubscriptionId` against the stored one, so an event for another subscription cannot mutate this tenant's record. See [Billing](Billing).

### Is the audit log really immutable?

There is no code path that updates or deletes an `audit_log` row through the scoped API. On Postgres you reinforce this with a revoked `UPDATE`/`DELETE` grant. See [Audit Log](Audit-Log).

### What Node version do I need?

Node 22.5 or newer, because `node:sqlite` was added then and is stable from 24. CI pins Node 24. If you see `ERR_UNKNOWN_BUILTIN_MODULE`, your Node is too old. See [Troubleshooting](Troubleshooting).

### Why does signup or login feel slightly slow?

scrypt password hashing costs about 25 ms per hash on an M3 Pro, by design: a password hash should be slow. The cost parameters are tunable and travel with the hash. See [Performance](Performance) and [Configuration](Configuration).

### Can a user belong to more than one organisation?

The schema supports it: `users` is global and `memberships` is the per-tenant join. The session records one active organisation. An organisation switcher is on the [Roadmap](Roadmap) as a "might add".

### How do I add a feature without breaking isolation?

Put the table on the tenant side (`TENANT_SCOPED_TABLES`), access it only through the scoped repository, gate privileged operations with a permission, record an audit entry, and write the isolation test. The step-by-step is in [Examples and Recipes](Examples-and-Recipes).

### What licence is it under?

MIT. See `LICENSE` in the repo.

---
SarmaLinux . sarmalinux.com . [shipyard on GitHub](https://github.com/sarmakska/shipyard)
