import { getDatabase } from "./client";
import { Repository } from "./repository";

/**
 * The application-wide repository, bound to the process singleton connection.
 *
 * In production this module is where the Postgres pool would be wired in: the
 * Repository interface stays identical, only the underlying connection changes.
 * See the Deployment wiki page for the migration notes.
 */
let repo: Repository | null = null;

export function db(): Repository {
  if (!repo) {
    repo = new Repository(getDatabase());
  }
  return repo;
}

export function resetRepository(): void {
  repo = null;
}

export { Repository } from "./repository";
export { Database } from "./client";
export { TenantScopeError } from "./repository";
