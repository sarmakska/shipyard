import type { Role } from "@/db/schema";

/**
 * Role-based access control.
 *
 * Permissions are the unit of authorisation, not roles. Routes assert a
 * permission; roles are merely bundles of permissions. This keeps the server
 * checks readable (`requirePermission(ctx, "billing:manage")`) and lets the role
 * table grow without touching every call site.
 */

export const PERMISSIONS = [
  "org:read",
  "org:manage",
  "members:read",
  "members:invite",
  "members:remove",
  "members:set_role",
  "billing:read",
  "billing:manage",
  "audit:read",
  "usage:write",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: [...PERMISSIONS],
  admin: [
    "org:read",
    "org:manage",
    "members:read",
    "members:invite",
    "members:remove",
    "members:set_role",
    "billing:read",
    "audit:read",
    "usage:write",
  ],
  member: ["org:read", "members:read", "billing:read", "usage:write"],
  viewer: ["org:read", "members:read", "billing:read"],
};

export function permissionsForRole(role: Role): Set<Permission> {
  return new Set(ROLE_PERMISSIONS[role]);
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return permissionsForRole(role).has(permission);
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(public readonly permission: Permission) {
    super(`missing permission: ${permission}`);
    this.name = "ForbiddenError";
  }
}

/**
 * The guard used on every protected server action and route. It throws a
 * ForbiddenError that the route layer maps to a 403, so a missing permission
 * fails closed rather than falling through.
 */
export function requirePermission(role: Role, permission: Permission): void {
  if (!roleHasPermission(role, permission)) {
    throw new ForbiddenError(permission);
  }
}
