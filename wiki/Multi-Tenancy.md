# Multi-Tenancy

The headline guarantee of shipyard is that one tenant can never read or write another tenant's data. This page explains how that guarantee is enforced and tested.

## The model

An **organisation** is a tenant. A **user** can belong to many organisations through a **membership**, which carries the user's role in that organisation. A **session** records which organisation is currently active. Tenant-scoped tables (memberships, audit log, subscriptions, usage counters) all carry `organisationId`; global tables (users, organisations, sessions) do not.

`src/db/schema.ts` declares which tables are tenant-scoped:

```ts
export const TENANT_SCOPED_TABLES = new Set([
  "memberships",
  "audit_log",
  "subscriptions",
  "usage_counters",
]);
```

## The chokepoint

All tenant data flows through one object: the `Repository` in `src/db/repository.ts`. It exposes two families of methods.

- `insertScoped`, `selectScoped`, `selectOneScoped`, `updateScoped` operate on tenant-scoped tables and **require** an `organisationId`.
- `insertGlobal`, `selectGlobal`, `updateGlobal`, `deleteGlobal` operate on global tables and **refuse** tenant-scoped ones.

Each family asserts the table is on the correct side of the line, so a developer cannot accidentally use the global path on tenant data or vice versa:

```ts
private assertScoped(table: string): void {
  if (!TENANT_SCOPED_TABLES.has(table)) {
    throw new TenantScopeError(
      `table "${table}" is not tenant-scoped; use the global helpers instead`,
    );
  }
}
```

## How isolation is enforced

Three properties hold for every scoped operation.

### 1. The tenant id is injected, never trusted

On insert, the repository stamps the tenant id onto the row itself. If the caller smuggles a different `organisationId` into the payload, the spread overwrites it:

```ts
const scoped = { ...(row as Row), organisationId };
```

So the row always lands under the scope the caller passed as the first argument, not whatever was in the body.

### 2. The tenant predicate cannot be removed

On read and update, the `organisationId = @organisationId` condition is added first and any `organisationId` key in the caller's `where` is ignored:

```ts
const conditions = ["organisationId = @organisationId"];
for (const [key, value] of Object.entries(where)) {
  if (key === "organisationId") continue; // never overridable
  conditions.push(`"${key}" = @${key}`);
}
```

A `selectScoped` for tenant B therefore returns only tenant B's rows, and an `updateScoped` for tenant B changes only tenant B's rows. A cross-tenant update simply matches nothing and reports zero changes.

### 3. Values are bound, never interpolated

Every value is passed as a named parameter to a prepared statement through `toBind`, so there is no string concatenation of caller-supplied data and no SQL injection surface.

## Where the active tenant comes from

The tenant id is not taken from a request body or a header. It is read from the session in `resolveContext` (`src/lib/context.ts`), and the caller's role is read from their membership in that tenant. A user authenticated against organisation A who somehow points a session at organisation B, where they have no membership, resolves with no role and is refused:

```ts
const role = auth.roleOf(user.id, session.organisationId);
if (!role) {
  throw new TenantResolutionError(); // fail closed
}
```

## Tests

`tests/tenant-isolation.test.ts` proves the guarantee directly:

- A scoped read for one tenant never returns another tenant's rows.
- Tenant A's audit entries are invisible under tenant B's scope.
- A smuggled `organisationId` in an insert payload lands under the real scope, not the smuggled one.
- A cross-tenant update changes zero rows and leaves the target untouched.
- Scoped operations on non-tenant tables throw `TenantScopeError`.

Each test runs against its own in-memory database, so there is no shared state.

## A worked attack, and why it fails

Suppose an attacker who is a legitimate owner of Globex wants to demote an Acme admin. They know Acme's `userId` (it leaked in a shared support thread) and they call the members route. The route resolves their context from the session, which pins `organisationId` to Globex, then runs:

```ts
repo.updateScoped(globexOrgId, "memberships", { role: "viewer" }, { userId: acmeUserId });
```

The repository builds:

```sql
UPDATE "memberships" SET "role" = @set_role
WHERE organisationId = @organisationId AND "userId" = @where_userId
```

with `@organisationId` bound to Globex. The row the attacker wants belongs to Acme, so the two predicates never both hold and the statement reports `0` changes. There is no argument the attacker can pass to remove the first predicate, because the `where` loop skips any `organisationId` key. This is exactly the case asserted in `tests/tenant-isolation.test.ts` under "an update cannot reach across tenants".

## Failure modes to know

- **`selectScoped` returns nothing for data you can see in the database.** Almost always a tenant mismatch: the `organisationId` you passed is not the one the rows belong to. That id comes from the session in `resolveContext`, so check the session's active organisation. This is the guarantee working, not a bug.
- **`TenantScopeError: table "x" is not tenant-scoped`.** You called a `*Scoped` method on a global table (or vice versa). The split is in `TENANT_SCOPED_TABLES` in `src/db/schema.ts`.
- **A new table holds tenant data but isolation does not apply.** You added the table but not its name to `TENANT_SCOPED_TABLES`. Without that entry the repository treats it as global and never injects the tenant predicate. Add the name and route all access through the scoped methods.

## Moving to Postgres

The same predicate-injection model maps onto Postgres row-level security as a defence in depth. You can keep the repository as the application-level guard and additionally enable an RLS policy keyed on a session variable, so even a raw query outside the repository is constrained by the database. See [Deployment](Deployment).

---
SarmaLinux . sarmalinux.com . [shipyard on GitHub](https://github.com/sarmakska/shipyard)
