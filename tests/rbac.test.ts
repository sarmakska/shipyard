import { describe, it, expect } from "vitest";
import { freshRepo } from "./helpers";
import { AuthService } from "@/lib/auth";
import { MembersService } from "@/lib/members";
import { resolveContext, guard } from "@/lib/context";
import { ForbiddenError, roleHasPermission } from "@/lib/rbac";
import type { RequestContext } from "@/lib/context";

describe("RBAC enforcement", () => {
  it("maps roles to the expected permissions", () => {
    expect(roleHasPermission("owner", "billing:manage")).toBe(true);
    expect(roleHasPermission("admin", "billing:manage")).toBe(false);
    expect(roleHasPermission("admin", "members:invite")).toBe(true);
    expect(roleHasPermission("viewer", "members:invite")).toBe(false);
    expect(roleHasPermission("member", "org:read")).toBe(true);
  });

  it("guard throws ForbiddenError for a missing permission", () => {
    const ctx: RequestContext = {
      user: { id: "u", email: "v@test", passwordHash: "", createdAt: 0 },
      organisationId: "o",
      role: "viewer",
    };
    expect(() => guard(ctx, "billing:manage")).toThrow(ForbiddenError);
    expect(() => guard(ctx, "org:read")).not.toThrow();
  });

  it("a viewer cannot invite members but an owner can", () => {
    const { repo } = freshRepo();
    const auth = new AuthService(repo);
    const owner = auth.signup({
      email: "owner@acme.test",
      password: "pw-pw-pw-pw",
      organisationName: "Acme",
    });
    const ownerCtx = resolveContext(repo, owner.token);
    const members = new MembersService(repo);

    // Owner invites a viewer.
    const viewer = members.invite(ownerCtx, "viewer@acme.test", "viewer");
    expect(viewer.role).toBe("viewer");

    // The viewer logs in and tries to invite. RBAC must refuse.
    auth.createSession(viewer.userId, owner.organisationId);
    const viewerCtx: RequestContext = {
      user: { id: viewer.userId, email: "viewer@acme.test", passwordHash: "", createdAt: 0 },
      organisationId: owner.organisationId,
      role: "viewer",
    };
    expect(() => members.invite(viewerCtx, "x@acme.test", "member")).toThrow(
      ForbiddenError,
    );
  });

  it("resolveContext fails closed for a user with no membership in the tenant", () => {
    const { repo } = freshRepo();
    const auth = new AuthService(repo);
    const a = auth.signup({
      email: "a@acme.test",
      password: "pw-pw-pw-pw",
      organisationName: "Acme",
    });
    const b = auth.signup({
      email: "b@globex.test",
      password: "pw-pw-pw-pw",
      organisationName: "Globex",
    });

    // Forge a session for user A but pointed at Globex, which A does not belong to.
    const crossToken = auth.createSession(a.user.id, b.organisationId);
    expect(() => resolveContext(repo, crossToken)).toThrow(/no access to tenant/);
  });
});
