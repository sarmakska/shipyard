import { describe, it, expect } from "vitest";
import { freshRepo } from "./helpers";
import { AuthService } from "@/lib/auth";
import { MembersService } from "@/lib/members";
import { resolveContext } from "@/lib/context";
import { listAudit, recordAudit } from "@/lib/audit";

describe("audit log", () => {
  it("records signup as a privileged action", () => {
    const { repo } = freshRepo();
    const auth = new AuthService(repo);
    const a = auth.signup({
      email: "a@acme.test",
      password: "pw-pw-pw-pw",
      organisationName: "Acme",
    });
    const entries = listAudit(repo, a.organisationId);
    expect(entries.some((e) => e.action === "auth.signup")).toBe(true);
    const signup = entries.find((e) => e.action === "auth.signup")!;
    expect(signup.actorUserId).toBe(a.user.id);
    expect(signup.organisationId).toBe(a.organisationId);
    expect(JSON.parse(signup.metadata).email).toBe("a@acme.test");
  });

  it("records member invitations with actor and metadata", () => {
    const { repo } = freshRepo();
    const auth = new AuthService(repo);
    const owner = auth.signup({
      email: "owner@acme.test",
      password: "pw-pw-pw-pw",
      organisationName: "Acme",
    });
    const ctx = resolveContext(repo, owner.token);
    new MembersService(repo).invite(ctx, "new@acme.test", "member");

    const entries = listAudit(repo, owner.organisationId);
    const invite = entries.find((e) => e.action === "members.invite");
    expect(invite).toBeDefined();
    expect(invite!.actorUserId).toBe(owner.user.id);
    expect(JSON.parse(invite!.metadata)).toMatchObject({
      email: "new@acme.test",
      role: "member",
    });
  });

  it("orders entries newest first", () => {
    const { repo } = freshRepo();
    const auth = new AuthService(repo);
    const a = auth.signup({
      email: "a@acme.test",
      password: "pw-pw-pw-pw",
      organisationName: "Acme",
    });
    recordAudit(repo, {
      organisationId: a.organisationId,
      actorUserId: a.user.id,
      action: "test.later",
      metadata: {},
    });
    const entries = listAudit(repo, a.organisationId);
    expect(entries[0].createdAt).toBeGreaterThanOrEqual(
      entries[entries.length - 1].createdAt,
    );
  });
});
