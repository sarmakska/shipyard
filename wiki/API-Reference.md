# API Reference

shipyard exposes a small HTTP surface under the Next.js App Router in `src/app`. There are three public auth routes and three protected routes. This page documents each: method, path, body, response, status codes, the permission it asserts, and the rate-limit group it uses.

Every protected route is wrapped by `withGuard` in `src/lib/http.ts`, which resolves the request context, applies the rate limit, asserts the permission and maps errors to status codes. A handler therefore only ever runs once the caller is authenticated, scoped to a tenant, within budget and authorised. See [Architecture](Architecture) for the lifecycle.

## Conventions

- Bodies are JSON. Responses are JSON.
- The session is an httpOnly cookie named `shipyard_session`. The auth routes set it; protected routes read it. You do not pass it in a header.
- Errors are `{ "error": "<message>" }` with the status set by `errorResponse`.
- Every protected response carries the rate-limit budget: `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` (whole seconds). A `429` adds `Retry-After`. See [Rate Limiting](Rate-Limiting) for the header semantics.

### Status codes

| Status | Meaning | Source |
| --- | --- | --- |
| 400 | malformed request, or an unclassified error | route validation / fallback in `errorResponse` |
| 401 | no valid session | `AuthError` |
| 402 | usage budget exceeded | `UsageLimitError` |
| 403 | authenticated but not allowed (no membership, or missing permission) | `TenantResolutionError`, `ForbiddenError` |
| 429 | rate limited | the token-bucket limiter |

## Auth routes

These are public (no session required) and limited by IP, because there is no tenant yet. Each constructs its own `RateLimiter(RATE_LIMITS.auth)`.

### POST /api/auth/signup

Registers a user, creates their first organisation (owned by them), opens a session and sets the cookie.

Request:

```json
{ "email": "owner@acme.test", "password": "password-acme-123", "organisationName": "Acme" }
```

Response `200`:

```json
{ "userId": "<uuid>", "organisationId": "<uuid>" }
```

Errors: `400` if any field is missing; `400` `email already registered` if the email exists; `429` if the IP exceeded the auth bucket. The handler is `src/app/api/auth/signup/route.ts`; the logic is `AuthService.signup`.

### POST /api/auth/login

Verifies credentials and opens a session on the user's first organisation.

Request:

```json
{ "email": "owner@acme.test", "password": "password-acme-123" }
```

Response `200`: `{ "userId": "<uuid>", "organisationId": "<uuid>" }`, with the session cookie set. Errors: `400` if fields are missing; `401` `invalid credentials` on a bad email or password (the same message for both, so it does not reveal which); `429` on the auth bucket. Handler: `src/app/api/auth/login/route.ts`.

### POST /api/auth/logout

Deletes the session row for the current cookie and clears the cookie. Always returns `200 { "ok": true }`, even with no session, so logout is idempotent. Handler: `src/app/api/auth/logout/route.ts`.

## Protected routes

All under `/api/protected`. The edge middleware short-circuits these with `401` if there is no session cookie; the route then does the authoritative check via `withGuard`. The rate-limit group is `api` unless noted.

### GET /api/protected/members

Lists the active tenant's members. Permission: `members:read` (held by every role).

Response `200`:

```json
{ "members": [ { "id": "...", "organisationId": "...", "userId": "...", "role": "owner", "createdAt": 0 } ] }
```

### POST /api/protected/members

Invites a user to the active tenant by email and role, creating the user if they do not exist. Permission: `members:invite` (owner and admin only).

Request: `{ "email": "new@acme.test", "role": "member" }`. Response `200`: `{ "membership": { ... } }`. Errors: `400` if `email` or `role` is missing; `403` if the role lacks `members:invite`. The invite is idempotent: inviting an existing member returns the existing membership. Handler: `src/app/api/protected/members/route.ts`; logic: `MembersService.invite`.

### GET /api/protected/billing

Returns the tenant's subscription, current-period usage and the plan catalogue. Permission: `billing:read` (every role).

Response `200`:

```json
{
  "subscription": { "plan": "pro", "status": "active", ... } ,
  "usage": { "api_calls": 1234, "seats": 0 },
  "plans": [ { "id": "free", "name": "Free", "pricePerMonth": 0, "budgets": { "api_calls": 1000, "seats": 3 } }, ... ]
}
```

### POST /api/protected/billing

Subscribes the tenant to a plan. Permission: `billing:manage` (owner only).

Request: `{ "plan": "pro" }`. Response `200`: `{ "subscription": { ... } }`. Errors: `400` if `plan` is missing or not in the catalogue; `403` if not an owner. The provider is selected by `BILLING_PROVIDER`: the fake in dev and tests, the Stripe adapter when set to `stripe`. Handler: `src/app/api/protected/billing/route.ts`; logic: `BillingService.subscribe`. See [Billing](Billing).

### GET /api/protected/audit

Returns the tenant's audit entries, newest first. Permission: `audit:read` (owner and admin only).

Response `200`: `{ "entries": [ { "id", "organisationId", "actorUserId", "action", "metadata", "createdAt" } ] }`. `metadata` is a JSON string. Handler: `src/app/api/protected/audit/route.ts`; logic: `listAudit`.

## Permission map for the routes

| Route | Permission | owner | admin | member | viewer |
| --- | --- | --- | --- | --- | --- |
| GET members | `members:read` | yes | yes | yes | yes |
| POST members | `members:invite` | yes | yes | no | no |
| GET billing | `billing:read` | yes | yes | yes | yes |
| POST billing | `billing:manage` | yes | no | no | no |
| GET audit | `audit:read` | yes | yes | no | no |

The full role-to-permission table is in [Auth and RBAC](Auth-and-RBAC).

## The webhook path

There is no shipped HTTP route for provider webhooks, because the verification and mapping live in the provider and the application logic in `BillingService.applyEvent`. To wire a live Stripe webhook you add a route that reads the raw body and the `Stripe-Signature` header, calls `provider.parseWebhook(rawBody, signature)`, then `billing.applyEvent(organisationId, event)`. The signature check is already real in `StripeBillingProvider.parseWebhook`. See [Billing](Billing) and [Security Model](Security-Model).

## Server components

The settings dashboard at `/app/settings` (`src/app/app/settings/page.tsx`) is a server component, not an API route. It resolves the context once with `resolveContext`, then reads members, subscription, permissions and the last twenty audit entries directly through the services, all scoped to the active tenant. It is the readable proof that the same context-and-scope machinery the API uses also drives the UI.

## Example session with curl

```bash
# sign up; -c saves the session cookie
curl -s -c jar.txt -X POST localhost:3000/api/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"o@acme.test","password":"password-acme-123","organisationName":"Acme"}'

# use the cookie on a protected route
curl -s -b jar.txt localhost:3000/api/protected/members

# subscribe to pro (owner only)
curl -s -b jar.txt -X POST localhost:3000/api/protected/billing \
  -H 'content-type: application/json' -d '{"plan":"pro"}'
```

More end-to-end flows are in [Examples and Recipes](Examples-and-Recipes).

---
SarmaLinux . sarmalinux.com . [shipyard on GitHub](https://github.com/sarmakska/shipyard)
