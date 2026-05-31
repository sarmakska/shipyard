import type { Repository } from "@/db";
import type { Membership, Role, User } from "@/db/schema";
import { newId, hashPassword } from "./crypto";
import { recordAudit } from "./audit";
import { guard, type RequestContext } from "./context";

/**
 * Membership management.
 *
 * These are privileged actions: every one is gated by an RBAC permission and
 * writes an audit entry. They also demonstrate the tenant-scoped repository in
 * anger; a member can only ever be added to or changed within ctx.organisationId.
 */

export class MembersService {
  constructor(private readonly repo: Repository) {}

  list(ctx: RequestContext): Membership[] {
    guard(ctx, "members:read");
    return this.repo.selectScoped<Membership>(
      ctx.organisationId,
      "memberships",
    );
  }

  /**
   * Invite a user to the active tenant. If the user does not exist yet they are
   * created with a holding password hash (a real flow would email an invite
   * link); the point here is the scoping and the audit trail.
   */
  invite(ctx: RequestContext, email: string, role: Role): Membership {
    guard(ctx, "members:invite");
    const normalised = email.trim().toLowerCase();
    let user = this.repo.selectOneGlobal<User>("users", { email: normalised });
    if (!user) {
      user = {
        id: newId(),
        email: normalised,
        passwordHash: hashPassword(newId()),
        createdAt: Date.now(),
      };
      this.repo.insertGlobal("users", user);
    }

    const existing = this.repo.selectOneScoped<Membership>(
      ctx.organisationId,
      "memberships",
      { userId: user.id },
    );
    if (existing) return existing;

    const membership: Membership = {
      id: newId(),
      organisationId: ctx.organisationId,
      userId: user.id,
      role,
      createdAt: Date.now(),
    };
    this.repo.insertScoped(ctx.organisationId, "memberships", {
      id: membership.id,
      userId: membership.userId,
      role: membership.role,
      createdAt: membership.createdAt,
    });
    recordAudit(this.repo, {
      organisationId: ctx.organisationId,
      actorUserId: ctx.user.id,
      action: "members.invite",
      metadata: { email: normalised, role },
    });
    return membership;
  }

  setRole(ctx: RequestContext, userId: string, role: Role): void {
    guard(ctx, "members:set_role");
    const changed = this.repo.updateScoped(
      ctx.organisationId,
      "memberships",
      { role },
      { userId },
    );
    if (changed === 0) throw new Error("membership not found in this tenant");
    recordAudit(this.repo, {
      organisationId: ctx.organisationId,
      actorUserId: ctx.user.id,
      action: "members.set_role",
      metadata: { userId, role },
    });
  }
}
