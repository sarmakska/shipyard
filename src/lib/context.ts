import type { Repository } from "@/db";
import type { Role, User } from "@/db/schema";
import { AuthService, AuthError } from "./auth";
import { requirePermission, type Permission } from "./rbac";

/**
 * The request context.
 *
 * A protected route resolves a RequestContext once at the top, then asserts the
 * permissions it needs. The context carries the authenticated user, the active
 * tenant and the caller's role within that tenant. Because the role is read
 * from the membership table (scoped to the tenant), a user with no membership
 * in the active organisation resolves with no role and fails every permission
 * check. This is where tenant resolution, authentication and RBAC meet.
 */

export interface RequestContext {
  user: User;
  organisationId: string;
  role: Role;
}

export class TenantResolutionError extends Error {
  readonly status = 403;
  constructor(message = "no access to tenant") {
    super(message);
    this.name = "TenantResolutionError";
  }
}

/**
 * Resolve a request context from a session token. Throws AuthError (401) if the
 * session is missing or expired, and TenantResolutionError (403) if the user
 * has no membership in the session's active organisation.
 */
export function resolveContext(
  repo: Repository,
  token: string | undefined,
  now = Date.now(),
): RequestContext {
  if (!token) throw new AuthError();
  const auth = new AuthService(repo);
  const session = auth.resolveSession(token, now);
  if (!session) throw new AuthError();

  const user = repo.selectOneGlobal<User>("users", { id: session.userId });
  if (!user) throw new AuthError();

  if (!session.organisationId) {
    throw new TenantResolutionError("session has no active organisation");
  }

  const role = auth.roleOf(user.id, session.organisationId);
  if (!role) {
    // The user is authenticated but is not a member of this tenant. Fail closed.
    throw new TenantResolutionError();
  }

  return { user, organisationId: session.organisationId, role };
}

/** The guard helper called on every protected route after resolveContext. */
export function guard(ctx: RequestContext, permission: Permission): void {
  requirePermission(ctx.role, permission);
}
