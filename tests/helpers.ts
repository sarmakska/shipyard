import { Database } from "@/db/client";
import { Repository } from "@/db/repository";

/**
 * Build a fresh, fully isolated in-memory database and repository for a test.
 * Every test gets its own connection so there is no shared state to leak.
 */
export function freshRepo(): { db: Database; repo: Repository } {
  const db = new Database(":memory:");
  db.migrate();
  return { db, repo: new Repository(db) };
}
