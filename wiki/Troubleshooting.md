# Troubleshooting

The issues you are most likely to hit, and how to resolve them.

## `Cannot find module 'node:sqlite'` or `ERR_UNKNOWN_BUILTIN_MODULE`

`node:sqlite` was added in Node 22.5 and is stable from Node 24. Check your version:

```bash
node --version
```

Use Node 22.5 or newer, ideally 24. The CI workflow pins Node 24 for this reason. If you are on an older Node from a system package, install a current one with a version manager.

## `pnpm build` fails the TypeScript check on a repository call

The repository generics are intentionally permissive (`<T>`) so your domain interfaces do not need an index signature, and values are normalised through `toBind` before binding. If you add a column whose value is not a string, number, bigint, boolean or `Uint8Array`, extend `toBind` in `src/db/repository.ts` rather than casting at the call site.

## `pnpm lint` errors with "Converting circular structure to JSON"

That happens if ESLint is fed the Next config through the old `FlatCompat` wrapper. `eslint-config-next` 16 ships native flat config, so `eslint.config.mjs` imports it directly and spreads it. Do not wrap it in `FlatCompat`.

## A protected route returns 401 when I expect 403, or vice versa

The mapping is deliberate and lives in `errorResponse` (`src/lib/http.ts`):

- 401 means no valid session (`AuthError`). Check the session cookie is present and not expired.
- 403 means authenticated but not allowed: either the user has no membership in the active tenant (`TenantResolutionError`) or the role lacks the permission (`ForbiddenError`).

If you see 403 where you expected success, check the role-to-permission table in [Auth and RBAC](Auth-and-RBAC); the role probably does not hold the permission the route asserts.

## A `selectScoped` returns nothing for data I know exists

It is almost certainly a tenant mismatch. `selectScoped` only ever returns rows for the `organisationId` you pass, and that id comes from the session in `resolveContext`. Confirm the session's active organisation is the one the data belongs to. This is the isolation guarantee working as intended, not a bug.

## `TenantScopeError: table "..." is tenant-scoped` (or "is not tenant-scoped")

You used the wrong repository family. Tenant tables (memberships, audit_log, subscriptions, usage_counters) go through the `*Scoped` methods; global tables (users, organisations, sessions) go through the `*Global` methods. The lists are in `TENANT_SCOPED_TABLES` in `src/db/schema.ts`.

## A 429 on the auth routes during local testing

The `auth` rate limit is intentionally tight: five attempts, refilling slowly. It is keyed by IP for unauthenticated routes. Wait for the bucket to refill, or raise `RATE_LIMITS.auth` in `src/lib/rate-limit.ts` for local work. Do not loosen it in production.

## A billing webhook is rejected with "verification failed"

The Stripe adapter verifies the signature with HMAC-SHA256 over `timestamp.payload`. The usual causes are the wrong `STRIPE_WEBHOOK_SECRET`, or a proxy that reformats the request body so the bytes no longer match what was signed. Verify against the raw body, not a re-serialised object.

## `pnpm seed` fails to resolve `@/` imports

The seed runs through `tsx`, which reads the `paths` alias from `tsconfig.json`. Run it with the provided script (`pnpm seed`), not bare `node`, because plain Node does not resolve the `@/` alias.

## Tests pass locally but I want to inspect the seeded data

Seed to a file and open it:

```bash
SHIPYARD_DB_PATH=shipyard.db pnpm seed
```

Then run `pnpm dev` with the same `SHIPYARD_DB_PATH` and sign in as `owner@acme.test` / `password-acme-123`.
