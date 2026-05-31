import { describe, it, expect } from "vitest";
import { freshRepo } from "./helpers";
import { AuthService } from "@/lib/auth";
import { BillingService, UsageLimitError, BillingError } from "@/lib/billing/service";
import { FakeBillingProvider } from "@/lib/billing/provider-fake";
import { listAudit } from "@/lib/audit";

function setup() {
  const { repo } = freshRepo();
  const auth = new AuthService(repo);
  const org = auth.signup({
    email: "owner@acme.test",
    password: "pw-pw-pw-pw",
    organisationName: "Acme",
  });
  const provider = new FakeBillingProvider();
  const billing = new BillingService(repo, provider);
  return { repo, billing, provider, org };
}

describe("billing state machine", () => {
  it("subscribes a tenant to a paid plan in trialing state", async () => {
    const { billing, org } = setup();
    const sub = await billing.subscribe(
      org.organisationId,
      org.user.email,
      "pro",
      org.user.id,
    );
    expect(sub.plan).toBe("pro");
    expect(sub.status).toBe("trialing");
    expect(sub.providerCustomerId).toMatch(/^cus_/);
  });

  it("activates on a webhook event", async () => {
    const { billing, org } = setup();
    const sub = await billing.subscribe(
      org.organisationId,
      org.user.email,
      "pro",
      org.user.id,
    );
    const updated = billing.applyEvent(org.organisationId, {
      type: "subscription.activated",
      providerSubscriptionId: sub.providerSubscriptionId!,
    });
    expect(updated.status).toBe("active");
  });

  it("rejects an illegal transition (canceled is terminal)", async () => {
    const { billing, org } = setup();
    const sub = await billing.subscribe(
      org.organisationId,
      org.user.email,
      "pro",
      org.user.id,
    );
    await billing.cancel(org.organisationId, org.user.id);
    expect(() =>
      billing.applyEvent(org.organisationId, {
        type: "subscription.activated",
        providerSubscriptionId: sub.providerSubscriptionId!,
      }),
    ).toThrow(BillingError);
  });

  it("rejects an event for a different subscription id", async () => {
    const { billing, org } = setup();
    await billing.subscribe(org.organisationId, org.user.email, "pro", org.user.id);
    expect(() =>
      billing.applyEvent(org.organisationId, {
        type: "subscription.activated",
        providerSubscriptionId: "sub_someone_else",
      }),
    ).toThrow(/does not match/);
  });

  it("records audit entries for subscribe and cancel", async () => {
    const { billing, org, repo } = setup();
    await billing.subscribe(org.organisationId, org.user.email, "pro", org.user.id);
    await billing.cancel(org.organisationId, org.user.id);
    const actions = listAudit(repo, org.organisationId).map((e) => e.action);
    expect(actions).toContain("billing.subscribe");
    expect(actions).toContain("billing.cancel");
  });
});

describe("usage metering and plan budgets", () => {
  it("increments usage and reports the running total", () => {
    const { billing, org } = setup();
    expect(billing.incrementUsage(org.organisationId, "api_calls", 10)).toBe(10);
    expect(billing.incrementUsage(org.organisationId, "api_calls", 5)).toBe(15);
    expect(billing.getUsage(org.organisationId, "api_calls")).toBe(15);
  });

  it("blocks an increment that would exceed the free plan budget", () => {
    const { billing, org } = setup();
    // Free plan allows 3 seats.
    billing.incrementUsage(org.organisationId, "seats", 3);
    expect(() =>
      billing.incrementUsage(org.organisationId, "seats", 1),
    ).toThrow(UsageLimitError);
  });

  it("allows unlimited usage on the scale plan", async () => {
    const { billing, org } = setup();
    await billing.subscribe(org.organisationId, org.user.email, "scale", org.user.id);
    billing.applyEvent(org.organisationId, {
      type: "subscription.activated",
      providerSubscriptionId: billing.getSubscription(org.organisationId)!
        .providerSubscriptionId!,
    });
    expect(
      billing.incrementUsage(org.organisationId, "api_calls", 5_000_000),
    ).toBe(5_000_000);
  });

  it("keeps usage counters isolated per tenant", () => {
    const { billing, org, repo } = setup();
    const auth = new AuthService(repo);
    const other = auth.signup({
      email: "b@globex.test",
      password: "pw-pw-pw-pw",
      organisationName: "Globex",
    });
    billing.incrementUsage(org.organisationId, "api_calls", 10);
    expect(billing.getUsage(other.organisationId, "api_calls")).toBe(0);
  });
});
