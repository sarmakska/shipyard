import { describe, it, expect } from "vitest";
import { freshRepo } from "./helpers";
import { AuthService } from "@/lib/auth";
import { TenantScopeError } from "@/db/repository";

/**
 * Tenant isolation is the headline guarantee. These tests prove that data
 * written under one organisation is invisible to a query scoped to another, and
 * that the repository refuses to operate on tenant tables without a scope.
 */
describe("tenant isolation", () => {
  it("never returns another tenant's rows from a scoped read", () => {
    const { repo } = freshRepo();
    const auth = new AuthService(repo);

    const a = auth.signup({
      email: "a@acme.test",
      password: "correct horse battery staple",
      organisationName: "Acme",
    });
    const b = auth.signup({
      email: "b@globex.test",
      password: "correct horse battery staple",
      organisationName: "Globex",
    });

    // Each owner sees exactly one membership: their own.
    const acmeMembers = repo.selectScoped(a.organisationId, "memberships");
    const globexMembers = repo.selectScoped(b.organisationId, "memberships");
    expect(acmeMembers).toHaveLength(1);
    expect(globexMembers).toHaveLength(1);
    expect(acmeMembers[0]).not.toEqual(globexMembers[0]);
  });

  it("cannot read tenant A's audit entries through tenant B's scope", () => {
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

    // Acme has a signup audit entry. Reading it under Globex's scope yields none.
    const underB = repo.selectScoped(b.organisationId, "audit_log");
    expect(
      underB.some((row) => (row as { actorUserId: string }).actorUserId === a.user.id),
    ).toBe(false);
  });

  it("a smuggled organisationId in an insert payload is overwritten", () => {
    const { repo } = freshRepo();
    const auth = new AuthService(repo);
    const a = auth.signup({
      email: "a@acme.test",
      password: "pw-pw-pw-pw",
      organisationName: "Acme",
    });
    const victimOrg = "victim-org-id";

    repo.insertScoped(a.organisationId, "audit_log", {
      id: "entry-1",
      // Attempt to attribute this entry to a different tenant.
      organisationId: victimOrg,
      actorUserId: a.user.id,
      action: "test.smuggle",
      metadata: "{}",
      createdAt: Date.now(),
    });

    // It lands under the real scope, not the smuggled one.
    expect(repo.selectScoped(a.organisationId, "audit_log").length).toBe(2);
    expect(repo.selectScoped(victimOrg, "audit_log").length).toBe(0);
  });

  it("an update cannot reach across tenants", () => {
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

    const acmeMembership = repo.selectScoped(a.organisationId, "memberships")[0] as {
      userId: string;
    };
    // Globex tries to demote an Acme member. The scoped update matches nothing.
    const changed = repo.updateScoped(
      b.organisationId,
      "memberships",
      { role: "viewer" },
      { userId: acmeMembership.userId },
    );
    expect(changed).toBe(0);
    expect(
      (repo.selectScoped(a.organisationId, "memberships")[0] as { role: string })
        .role,
    ).toBe("owner");
  });

  it("refuses scoped operations on non-tenant tables", () => {
    const { repo } = freshRepo();
    expect(() => repo.selectScoped("org", "users")).toThrow(TenantScopeError);
    expect(() => repo.insertGlobal("audit_log", { id: "x" })).toThrow(
      TenantScopeError,
    );
  });
});
