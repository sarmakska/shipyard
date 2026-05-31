# Repository Reference

The `Repository` in `src/db/repository.ts` is the only object that touches tenant data, so it is the most important interface in the project to understand fully. This page documents every method, the SQL each one builds, the error it can throw, and the exact reason the tenant predicate cannot be removed.

The whole class is about 230 lines and has no dependencies beyond the `Database` connection it wraps. That smallness is intentional: the isolation guarantee rests on one narrow, readable path, and a path you can read top to bottom is a path you can reason about. See [Design Decisions](Design-Decisions) for why this is a hand-written repository and not an ORM.

## Construction

```ts
import { Repository } from "@/db";
import { Database } from "@/db/client";

const db = new Database(":memory:");
db.migrate();
const repo = new Repository(db);
```

In the application you never do this by hand. `db()` in `src/db/index.ts` returns a process-wide `Repository` bound to the singleton connection. Tests construct their own via `freshRepo()` so each gets an isolated in-memory database.

## The two families

The class splits its surface in two, and the split is enforced, not conventional.

| Family | Methods | First argument | Refuses |
| --- | --- | --- | --- |
| Scoped | `insertScoped`, `selectScoped`, `selectOneScoped`, `updateScoped` | `organisationId` | non-tenant tables |
| Global | `insertGlobal`, `selectGlobal`, `selectOneGlobal`, `updateGlobal`, `deleteGlobal` | `table` | tenant tables |

The guard is `assertScoped` for the scoped family, and an inline check for the global family. Both throw `TenantScopeError` when a table is used through the wrong family:

```ts
private assertScoped(table: string): void {
  if (!TENANT_SCOPED_TABLES.has(table)) {
    throw new TenantScopeError(
      `table "${table}" is not tenant-scoped; use the global helpers instead`,
    );
  }
}
```

Notice there is no method that takes a table and decides the family for you. The caller has to pick a family, and picking the wrong one throws rather than silently doing the wrong thing.

## Scoped methods

### insertScoped(organisationId, table, row): void

Stamps the tenant id onto the row, then inserts. The stamp happens after the spread, so a caller-supplied `organisationId` in the payload is overwritten, never honoured:

```ts
const scoped = { ...(row as Row), organisationId };
```

The row always lands under the scope passed as the first argument. This is the property proved by the "a smuggled organisationId in an insert payload is overwritten" case in `tests/tenant-isolation.test.ts`.

### selectScoped(organisationId, table, where = {}): T[]

Reads rows for one tenant. The tenant predicate is added first and any `organisationId` key in `where` is skipped, so it cannot be overridden:

```ts
const conditions = ["organisationId = @organisationId"];
for (const [key, value] of Object.entries(where)) {
  if (key === "organisationId") continue; // never overridable
  conditions.push(`"${key}" = @${key}`);
}
```

The statement it builds for `selectScoped(org, "memberships", { userId })`:

```sql
SELECT * FROM "memberships" WHERE organisationId = @organisationId AND "userId" = @userId
```

### selectOneScoped(organisationId, table, where = {}): T | null

`selectScoped(...)[0] ?? null`. A convenience for the common single-row lookup.

### updateScoped(organisationId, table, patch, where = {}): number

Updates rows for one tenant and returns the number changed. The tenant predicate is forced into the `WHERE` clause exactly as in `selectScoped`. The `SET` keys are prefixed `set_` and the `WHERE` keys `where_` so a column can appear in both without a parameter collision:

```sql
UPDATE "memberships" SET "role" = @set_role
WHERE organisationId = @organisationId AND "userId" = @where_userId
```

The return value is load-bearing. A cross-tenant update returns `0`, and callers such as `MembersService.setRole` treat `0` as "not found in this tenant" and refuse:

```ts
const changed = this.repo.updateScoped(ctx.organisationId, "memberships", { role }, { userId });
if (changed === 0) throw new Error("membership not found in this tenant");
```

There is deliberately no `deleteScoped`. Tenant data is mutated, not destroyed, through `updateScoped` (for example a soft status change). If you need a hard delete on a tenant table, add it to the scoped family with the same predicate injection rather than reaching for a global path.

## Global methods

These operate on `users`, `organisations` and `sessions`. They refuse tenant tables, so you cannot accidentally read tenant data without a scope.

- **insertGlobal(table, row)**: plain parameterised insert; throws if `table` is tenant-scoped.
- **selectGlobal(table, where = {})** and **selectOneGlobal(table, where = {})**: read with an optional `WHERE` built from the keys of `where`; with no `where` they select all rows.
- **updateGlobal(table, patch, where)**: like `updateScoped` minus the tenant predicate, with the same `set_`/`where_` prefixing.
- **deleteGlobal(table, where)**: the only delete in the repository, used for sessions (logout, expiry). It refuses tenant tables with a message that points you back to `updateScoped`.

## Value binding

Every value passes through `toBind` before it reaches a prepared statement, so nothing caller-supplied is ever interpolated into SQL:

```ts
type BindValue = null | number | bigint | string | Uint8Array;
```

`toBind` maps `undefined`/`null` to `NULL`, booleans to `0`/`1`, passes through numbers, bigints, strings and `Uint8Array`, and stringifies anything else. Column and table names are not values; they come from your own schema and the method arguments, never from request bodies, and they are quoted. The result is that there is no SQL injection surface in the repository.

## Errors

| Error | Thrown when | Class location |
| --- | --- | --- |
| `TenantScopeError` | a scoped method is used on a global table, or a global method on a tenant table | `src/db/repository.ts` |

`TenantScopeError` is exported from `@/db` for `instanceof` checks and is what `tests/tenant-isolation.test.ts` asserts on the "refuses scoped operations on non-tenant tables" case.

## Worked example: the full insert path

A signup writes a membership through the scoped path. Trace it:

```ts
this.repo.insertScoped(orgId, "memberships", {
  id: membership.id,
  userId: membership.userId,
  role: membership.role,
  createdAt: membership.createdAt,
});
```

1. `assertScoped("memberships")` passes because the table is in `TENANT_SCOPED_TABLES`.
2. `scoped = { id, userId, role, createdAt, organisationId: orgId }`. The tenant id is appended last.
3. Columns and `@name` placeholders are derived from `scoped`.
4. `toBind(scoped)` normalises the values.
5. The prepared `INSERT` runs once. The row is now readable only under `orgId`.

## Reimplementing against Postgres

The method shapes are the seam. To move to Postgres you keep the signatures and the predicate-injection logic and replace the statement execution with pool calls. The SQL the repository builds is already standard parameterised SQL; the named-parameter style (`@name`) maps to your driver's parameter style. See [Deployment](Deployment) for the full procedure and the row-level-security backstop.

---
SarmaLinux . sarmalinux.com . [shipyard on GitHub](https://github.com/sarmakska/shipyard)
