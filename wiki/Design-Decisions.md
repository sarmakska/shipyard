# Design Decisions

The choices that shaped shipyard, including the ones I argued myself out of. Recording the rejected alternatives is more honest than only listing what I kept, and for a project whose value is its opinions, the reasoning is the documentation.

## node:sqlite, not better-sqlite3 or an ORM

**Decision:** the data layer runs on Node's built-in `node:sqlite`, behind a hand-written typed repository.

**Rejected: better-sqlite3.** It is excellent and faster, but it is a compiled native addon, which is exactly the thing that breaks in someone's CI on a Tuesday. A built-in needs no compile, so `pnpm install` is fast and `pnpm test` runs anywhere. For a starter whose first job is to install and prove itself on any machine, the build step was a worse cost than the marginal speed.

**Rejected: an ORM (Prisma, Drizzle, TypeORM).** The entire isolation argument rests on there being one narrow, readable path to tenant data. The repository is about 230 lines I can read top to bottom and reason about. An ORM or generated query builder hides the `WHERE` clause the guarantee depends on, and that is the one place I want nothing hidden. I accepted worse query ergonomics in exchange for a guarantee I can point at. See [Repository Reference](Repository-Reference) and [Comparisons](Comparisons).

## A repository chokepoint as the primary isolation guard

**Decision:** the application-level repository is the primary tenant-isolation control; Postgres row-level security is documented as the backstop, not the reverse.

**Rejected: RLS as the primary mechanism.** RLS is genuinely good and I use it in production. But two things about feedback decided it. First, the project must run and prove itself with zero services, and an in-memory SQLite test cannot exercise an RLS policy. Second, an application-level guard fails loudly in a unit test on any database, whereas a misconfigured RLS policy fails silently until production. So the repository is the guard you can test on commit one, and RLS is the second layer beneath it. Both, with the loud one first. See [Security Model](Security-Model) and [Deployment](Deployment).

## Permissions at the call site, roles as bundles

**Decision:** routes assert a permission (`requirePermission(role, "billing:manage")`); roles are bundles of permissions in `src/lib/rbac.ts`.

**Rejected: direct role checks (`if (role === "admin")`).** Shorter, but it rots. Every new capability forces you to revisit every role comparison, and the meaning drifts as roles accumulate exceptions. Asserting a permission keeps the route readable and lets the role table grow without touching call sites. A permission absent from every bundle is held by nobody, which is the fail-closed default. See [Auth and RBAC](Auth-and-RBAC).

## Token bucket, not a fixed window or a sliding-window log

**Decision:** rate limiting is a token bucket, state `(tokens, lastRefill)`.

**Rejected: a fixed window.** It double-rates at the boundary: a client can spend a full window at the end of one and a full window at the start of the next, briefly doubling the intended rate.

**Rejected: a sliding-window log.** Accurate, but it needs a timestamp list per key, which is more memory and a heavier data structure. The bucket is two numbers, which is also why it ports to a Redis Lua script unchanged: the refill-and-take is trivial to make atomic. See [Rate Limiting](Rate-Limiting).

## scrypt from node:crypto, not bcrypt or argon2

**Decision:** passwords are hashed with scrypt from `node:crypto`, stored as a self-describing `scrypt$N$r$p$salt$hash` string.

**Rejected: bcrypt.** A native build, again the CI-breaking dependency. **Rejected: argon2** for the same build reason, despite being a fine choice. scrypt is memory-hard, ships with the runtime, and needs no compile. The self-describing format means the cost parameters travel with the hash, so they can be raised later without a data migration: old hashes verify with their stored parameters, new ones use the new. See [Configuration](Configuration) and [Performance](Performance).

## Hashed session tokens, server-side sessions

**Decision:** sessions are opaque random tokens; only a SHA-256 hash is stored, the plaintext is the cookie.

**Rejected: stateless JWTs.** A JWT avoids a session table but makes revocation hard and puts claims in a token the client holds. Server-side sessions are trivially revocable (delete the row), and storing only the hash means a database leak hands out no live sessions. The cost is a lookup per request, which is sub-millisecond. The seam for OAuth (`createSession`) is identical either way. See [Auth and RBAC](Auth-and-RBAC) and [Security Model](Security-Model).

## The authorisation decision lives in the route, not the middleware

**Decision:** the edge middleware does only a cheap cookie gate and a correlation id; the authoritative tenant-and-role decision is in `resolveContext` in the route.

**Rejected: deciding authorisation at the edge.** The edge runtime has no database connection, so it cannot read membership or role. Putting the authoritative decision next to the data avoids a class of bug where the edge believes one thing and the route another. The middleware is a fast gate, not a security boundary. See [Architecture](Architecture).

## Errors as types, mapped centrally

**Decision:** each failure is its own error class (`AuthError`, `TenantResolutionError`, `ForbiddenError`, `UsageLimitError`, `TenantScopeError`, `BillingError`) and `errorResponse` is the one place that maps them to status codes.

**Rejected: returning status codes from the service layer.** That scatters HTTP concerns through the domain and couples business logic to transport. Throwing a typed error keeps the domain HTTP-agnostic and unit-testable without a server, and keeps the status mapping in one auditable function. See [API Reference](API-Reference).

## A Stripe seam, not a bundled SDK

**Decision:** the Stripe adapter implements the security-critical webhook signature check for real and leaves the customer/subscription calls as marked stubs that throw.

**Rejected: bundling the Stripe SDK.** It forces a dependency and a vendor on every user of the starter, including those who will use a different provider or none yet. The genuinely hard, security-sensitive piece (the HMAC verification) is the part worth shipping for real; the API calls are a one-line SDK swap when you go live. See [Billing](Billing).

## Inject the awkward dependencies

**Decision:** the rate limiter takes a `now()` clock; the billing service takes a `BillingProvider`; services take the `Repository`.

This is the smaller decision that makes the larger ones testable. A clock you can freeze and a provider you can fake are what let the suite exercise refill behaviour and webhook handling deterministically, with no sleeping and no network. See [Testing Strategy](Testing-Strategy).

## What these choices add up to

Every decision above trades some convenience for a property that can be tested and reasoned about: a narrow data path, a loud failure, a hashed token, an injectable seam. That is the through-line. shipyard is small because each part is the minimum that still lets the guarantee be proved, and opinionated because the guarantees are the product. The [Roadmap](Roadmap) says what I will and will not add to keep it that way.

---
SarmaLinux . sarmalinux.com . [shipyard on GitHub](https://github.com/sarmakska/shipyard)
