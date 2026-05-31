import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { StripeBillingProvider } from "@/lib/billing/provider-stripe";

/**
 * The Stripe adapter cannot make live API calls without the SDK, but its
 * webhook signature verification is real and security-critical, so it is tested
 * directly. A forged or tampered payload must be rejected.
 */
describe("Stripe webhook signature verification", () => {
  const secret = "whsec_test_secret";
  const provider = new StripeBillingProvider("sk_test", secret);

  function sign(payload: string, timestamp = "1700000000"): string {
    const sig = createHmac("sha256", secret)
      .update(`${timestamp}.${payload}`)
      .digest("hex");
    return `t=${timestamp},v1=${sig}`;
  }

  it("accepts a correctly signed payload and maps the event", () => {
    const payload = JSON.stringify({
      type: "customer.subscription.created",
      data: { object: { id: "sub_123", current_period_end: 1700100000 } },
    });
    const event = provider.parseWebhook(payload, sign(payload));
    expect(event.type).toBe("subscription.activated");
    expect(event.providerSubscriptionId).toBe("sub_123");
    expect(event.currentPeriodEnd).toBe(1700100000 * 1000);
  });

  it("rejects a tampered payload", () => {
    const payload = JSON.stringify({
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_123" } },
    });
    const header = sign(payload);
    const tampered = payload.replace("sub_123", "sub_evil");
    expect(() => provider.parseWebhook(tampered, header)).toThrow(
      /verification failed/,
    );
  });

  it("rejects a missing signature", () => {
    expect(() => provider.parseWebhook("{}", null)).toThrow(/missing/);
  });
});
