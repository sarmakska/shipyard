import type { Database } from "./client";
import { TENANT_SCOPED_TABLES } from "./schema";

/**
 * The tenant-scoped repository.
 *
 * This is the single chokepoint through which application code touches
 * tenant data. Every read and write on a tenant-scoped table is forced to carry
 * an organisationId, and that id is injected into the WHERE clause and the
 * inserted row by the repository itself rather than trusted from the caller's
 * query. A caller therefore cannot construct a statement that reads or mutates
 * another tenant's rows, even by mistake. This is the spine of the isolation
 * guarantee described in the Multi-Tenancy wiki page.
 */

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantScopeError";
  }
}

type Row = Record<string, unknown>;

/**
 * The value types node:sqlite accepts as bound parameters. Booleans are coerced
 * to integers, which is how SQLite stores them.
 */
type BindValue = null | number | bigint | string | Uint8Array;
type BindParams = Record<string, BindValue>;

function toBind(row: Row): BindParams {
  const out: BindParams = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === undefined || value === null) {
      out[key] = null;
    } else if (typeof value === "boolean") {
      out[key] = value ? 1 : 0;
    } else if (
      typeof value === "number" ||
      typeof value === "bigint" ||
      typeof value === "string" ||
      value instanceof Uint8Array
    ) {
      out[key] = value;
    } else {
      out[key] = String(value);
    }
  }
  return out;
}

export class Repository {
  constructor(private readonly db: Database) {}

  private assertScoped(table: string): void {
    if (!TENANT_SCOPED_TABLES.has(table)) {
      throw new TenantScopeError(
        `table "${table}" is not tenant-scoped; use the global helpers instead`,
      );
    }
  }

  // --- Tenant-scoped operations ---------------------------------------------

  /**
   * Insert a row into a tenant-scoped table. The organisationId is stamped onto
   * the row by the repository. If the caller smuggles in a different
   * organisationId in the payload it is overwritten, never honoured.
   */
  insertScoped<T>(
    organisationId: string,
    table: string,
    row: T,
  ): void {
    this.assertScoped(table);
    const scoped = { ...(row as Row), organisationId };
    const columns = Object.keys(scoped);
    const placeholders = columns.map((c) => `@${c}`).join(", ");
    const sql = `INSERT INTO "${table}" (${columns
      .map((c) => `"${c}"`)
      .join(", ")}) VALUES (${placeholders})`;
    this.db.raw.prepare(sql).run(toBind(scoped));
  }

  /**
   * Select rows from a tenant-scoped table. The organisationId predicate is
   * always ANDed in and cannot be removed by the caller.
   */
  selectScoped<T>(
    organisationId: string,
    table: string,
    where: Record<string, unknown> = {},
  ): T[] {
    this.assertScoped(table);
    const conditions = ["organisationId = @organisationId"];
    const params: Row = { organisationId };
    for (const [key, value] of Object.entries(where)) {
      if (key === "organisationId") continue; // never overridable
      conditions.push(`"${key}" = @${key}`);
      params[key] = value;
    }
    const sql = `SELECT * FROM "${table}" WHERE ${conditions.join(" AND ")}`;
    return this.db.raw
      .prepare(sql)
      .all(toBind(params)) as T[];
  }

  selectOneScoped<T>(
    organisationId: string,
    table: string,
    where: Record<string, unknown> = {},
  ): T | null {
    const rows = this.selectScoped<T>(organisationId, table, where);
    return rows[0] ?? null;
  }

  /**
   * Update rows in a tenant-scoped table. The organisationId predicate is
   * forced into the WHERE clause so an update can never reach across tenants.
   */
  updateScoped(
    organisationId: string,
    table: string,
    patch: Row,
    where: Record<string, unknown> = {},
  ): number {
    this.assertScoped(table);
    const setClauses = Object.keys(patch).map((c) => `"${c}" = @set_${c}`);
    const params: Row = { organisationId };
    for (const [key, value] of Object.entries(patch)) {
      params[`set_${key}`] = value;
    }
    const conditions = ["organisationId = @organisationId"];
    for (const [key, value] of Object.entries(where)) {
      if (key === "organisationId") continue;
      conditions.push(`"${key}" = @where_${key}`);
      params[`where_${key}`] = value;
    }
    const sql = `UPDATE "${table}" SET ${setClauses.join(
      ", ",
    )} WHERE ${conditions.join(" AND ")}`;
    const result = this.db.raw
      .prepare(sql)
      .run(toBind(params));
    return Number(result.changes);
  }

  // --- Global (non tenant-scoped) operations --------------------------------
  // These touch tables that are not tenant data: users, organisations,
  // sessions. They are deliberately separate so the scoped path stays narrow.

  insertGlobal<T>(table: string, row: T): void {
    if (TENANT_SCOPED_TABLES.has(table)) {
      throw new TenantScopeError(
        `table "${table}" is tenant-scoped; use insertScoped`,
      );
    }
    const columns = Object.keys(row as Row);
    const placeholders = columns.map((c) => `@${c}`).join(", ");
    const sql = `INSERT INTO "${table}" (${columns
      .map((c) => `"${c}"`)
      .join(", ")}) VALUES (${placeholders})`;
    this.db.raw.prepare(sql).run(toBind(row as Row));
  }

  selectGlobal<T>(
    table: string,
    where: Record<string, unknown> = {},
  ): T[] {
    if (TENANT_SCOPED_TABLES.has(table)) {
      throw new TenantScopeError(
        `table "${table}" is tenant-scoped; use selectScoped`,
      );
    }
    const keys = Object.keys(where);
    const clause = keys.length
      ? ` WHERE ${keys.map((k) => `"${k}" = @${k}`).join(" AND ")}`
      : "";
    const sql = `SELECT * FROM "${table}"${clause}`;
    return this.db.raw.prepare(sql).all(toBind(where)) as T[];
  }

  selectOneGlobal<T>(
    table: string,
    where: Record<string, unknown> = {},
  ): T | null {
    return this.selectGlobal<T>(table, where)[0] ?? null;
  }

  updateGlobal(
    table: string,
    patch: Row,
    where: Record<string, unknown>,
  ): number {
    if (TENANT_SCOPED_TABLES.has(table)) {
      throw new TenantScopeError(
        `table "${table}" is tenant-scoped; use updateScoped`,
      );
    }
    const setClauses = Object.keys(patch).map((c) => `"${c}" = @set_${c}`);
    const params: Row = {};
    for (const [key, value] of Object.entries(patch)) {
      params[`set_${key}`] = value;
    }
    const conditions = Object.keys(where).map((k) => {
      params[`where_${k}`] = where[k];
      return `"${k}" = @where_${k}`;
    });
    const sql = `UPDATE "${table}" SET ${setClauses.join(
      ", ",
    )} WHERE ${conditions.join(" AND ")}`;
    return Number(
      this.db.raw.prepare(sql).run(toBind(params)).changes,
    );
  }

  deleteGlobal(table: string, where: Record<string, unknown>): number {
    if (TENANT_SCOPED_TABLES.has(table)) {
      throw new TenantScopeError(
        `table "${table}" is tenant-scoped; deletes go through updateScoped`,
      );
    }
    const conditions = Object.keys(where).map((k) => `"${k}" = @${k}`);
    const sql = `DELETE FROM "${table}" WHERE ${conditions.join(" AND ")}`;
    return Number(
      this.db.raw.prepare(sql).run(toBind(where)).changes,
    );
  }
}
