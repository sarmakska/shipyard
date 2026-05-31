import { DatabaseSync } from "node:sqlite";
import { TABLES, type ColumnDef, type TableDef } from "./schema";

/**
 * A thin connection wrapper over node:sqlite.
 *
 * I deliberately avoid a heavyweight ORM. node:sqlite ships with Node 22.5+ and
 * needs no native build step, which keeps `pnpm install` fast and the test run
 * hermetic with no external Postgres. The production path swaps this module for
 * a Postgres pool behind the same query interface (see db/index.ts and the
 * Deployment wiki page).
 */

function sqlType(col: ColumnDef): string {
  switch (col.type) {
    case "text":
      return "TEXT";
    case "integer":
    case "boolean":
      return "INTEGER";
  }
}

function columnClause(name: string, col: ColumnDef): string {
  const parts = [`"${name}"`, sqlType(col)];
  if (col.primaryKey) parts.push("PRIMARY KEY");
  if (col.notNull) parts.push("NOT NULL");
  if (col.unique) parts.push("UNIQUE");
  if (col.default !== undefined) {
    const value =
      typeof col.default === "string" ? `'${col.default}'` : col.default;
    parts.push(`DEFAULT ${value}`);
  }
  if (col.references) {
    parts.push(
      `REFERENCES "${col.references.table}"("${col.references.column}")`,
    );
  }
  return parts.join(" ");
}

function createTableSql(table: TableDef): string[] {
  const cols = Object.entries(table.columns).map(([name, def]) =>
    columnClause(name, def),
  );
  const statements = [
    `CREATE TABLE IF NOT EXISTS "${table.name}" (\n  ${cols.join(",\n  ")}\n);`,
  ];
  for (const index of table.indexes ?? []) {
    const unique = index.unique ? "UNIQUE " : "";
    const cols = index.columns.map((c) => `"${c}"`).join(", ");
    statements.push(
      `CREATE ${unique}INDEX IF NOT EXISTS "${index.name}" ON "${table.name}" (${cols});`,
    );
  }
  return statements;
}

export class Database {
  readonly raw: DatabaseSync;

  constructor(location = ":memory:") {
    this.raw = new DatabaseSync(location);
    this.raw.exec("PRAGMA foreign_keys = ON;");
    this.raw.exec("PRAGMA journal_mode = WAL;");
  }

  /** Apply the schema. Idempotent: safe to call on every boot. */
  migrate(): void {
    for (const table of TABLES) {
      for (const statement of createTableSql(table)) {
        this.raw.exec(statement);
      }
    }
  }

  close(): void {
    this.raw.close();
  }
}

let singleton: Database | null = null;

/**
 * Process-wide connection used by the application. Tests construct their own
 * isolated Database directly so they never touch this one.
 */
export function getDatabase(): Database {
  if (singleton) return singleton;
  const location = process.env.SHIPYARD_DB_PATH ?? ":memory:";
  singleton = new Database(location);
  singleton.migrate();
  return singleton;
}

export function resetDatabaseSingleton(): void {
  singleton?.close();
  singleton = null;
}
