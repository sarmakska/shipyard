# Auth and RBAC

Authentication answers "who are you", authorisation answers "what may you do". shipyard keeps them separate and enforces both on the server.

## Authentication

### Sessions

Sessions are opaque random tokens, generated with 32 bytes of entropy from `node:crypto`. The plaintext token goes into an httpOnly cookie; only a SHA-256 hash of it is stored in the `sessions` table:

```ts
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
```

This matters: a database leak does not hand an attacker live sessions, because the stored hash cannot be presented as a cookie. Sessions carry the user id, the active `organisationId` and an expiry. `resolveSession` deletes expired sessions on read so they cannot be replayed.

The cookie is set in `src/lib/http.ts` with `httpOnly`, `sameSite=lax`, `path=/` and `secure` in production:

```ts
response.cookies.set(SESSION_COOKIE, token, {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 60 * 24 * 7,
});
```

### Password hashing

Passwords are hashed with scrypt from `node:crypto`, which is memory-hard and ships with the runtime, so there is no native bcrypt build to fail in CI. The stored format carries its own parameters:

```
scrypt$N$r$p$salt$hash
```

Because the cost parameters travel with the hash, they can be raised later without a data migration: old hashes still verify with their stored parameters, new hashes use the new ones. Verification is constant-time via `timingSafeEqual`.

### The OAuth seam

OAuth slots in cleanly. An OAuth callback resolves the provider profile to a local `User` (creating one if needed), then calls `AuthService.createSession(userId, organisationId)`. Everything downstream, tenant resolution and RBAC, is identical because it only ever sees a session.

## Authorisation (RBAC)

### Permissions, not roles, at the call site

Routes assert a **permission**, not a role. Roles are bundles of permissions defined in `src/lib/rbac.ts`:

```ts
export const PERMISSIONS = [
  "org:read", "org:manage",
  "members:read", "members:invite", "members:remove", "members:set_role",
  "billing:read", "billing:manage",
  "audit:read", "usage:write",
] as const;
```

| Permission | owner | admin | member | viewer |
| --- | --- | --- | --- | --- |
| org:read | yes | yes | yes | yes |
| org:manage | yes | yes | no | no |
| members:invite | yes | yes | no | no |
| members:set_role | yes | yes | no | no |
| billing:read | yes | yes | yes | yes |
| billing:manage | yes | no | no | no |
| audit:read | yes | yes | no | no |
| usage:write | yes | yes | yes | no |

Asserting permissions rather than roles keeps the call sites readable and lets the role table grow without touching every route.

### The guard

`requirePermission` throws `ForbiddenError` (mapped to 403) when the role lacks the permission, so a check that is forgotten fails by raising rather than by silently allowing:

```ts
export function requirePermission(role: Role, permission: Permission): void {
  if (!roleHasPermission(role, permission)) {
    throw new ForbiddenError(permission);
  }
}
```

In a route this is one line via `withGuard({ permission: "members:invite" }, handler, req)`; in a service it is `guard(ctx, "members:set_role")`.

### Server-side, every time

Authorisation runs on the server inside the route or service, never in the client. The settings dashboard resolves the context server-side and renders only what the role permits. There is no client-trusted role anywhere in the request path.

## Tests

`tests/rbac.test.ts` covers:

- The role-to-permission mapping.
- `guard` raising `ForbiddenError` for a missing permission and passing for a held one.
- A viewer being refused `members:invite` while an owner succeeds.
- `resolveContext` failing closed for a user with no membership in the active tenant.
