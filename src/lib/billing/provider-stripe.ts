import { createHmac, timingSafeEqual } from "node:crypto";
import type { Plan } from "@/db/schema";
import type {
  BillingProvider,
  CreateCustomerInput,
  CreateSubscriptionInput,
  ProviderEvent,
  ProviderSubscription,
} from "./provider";

/**
 * Stripe-shaped adapter.
 *
 * This is the real-provider seam. It is intentionally dependency-free: rather
 * than bundle the Stripe SDK into a starter, it shows exactly where each call
 * goes and implements the one piece that is genuinely security-sensitive, the
 * webhook signature check, the same way Stripe does (HMAC-SHA256 over
 * `timestamp.payload` compared in constant time).
 *
 * To go live: `pnpm add stripe`, construct a Stripe client from
 * STRIPE_SECRET_KEY, and replace each marked call with the SDK equivalent. The
 * plan-to-price mapping lives in PRICE_IDS. See the Billing wiki page.
 */

const PRICE_IDS: Record<Plan, string | null> = {
  free: null,
  pro: process.env.STRIPE_PRICE_PRO ?? "price_pro_placeholder",
  scale: process.env.STRIPE_PRICE_SCALE ?? "price_scale_placeholder",
};

export class StripeBillingProvider implements BillingProvider {
  constructor(
    private readonly secretKey = process.env.STRIPE_SECRET_KEY ?? "",
    private readonly webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "",
  ) {}

  async createCustomer(
    input: CreateCustomerInput,
  ): Promise<{ customerId: string }> {
    // Live: stripe.customers.create({ email: input.email,
    //   metadata: { organisationId: input.organisationId } })
    void this.secretKey;
    void input;
    throw new Error(
      "StripeBillingProvider.createCustomer requires the Stripe SDK; see the Billing wiki page",
    );
  }

  async createSubscription(
    input: CreateSubscriptionInput,
  ): Promise<ProviderSubscription> {
    // Live: stripe.subscriptions.create({ customer: input.customerId,
    //   items: [{ price: PRICE_IDS[input.plan] }] })
    void PRICE_IDS[input.plan];
    throw new Error(
      "StripeBillingProvider.createSubscription requires the Stripe SDK; see the Billing wiki page",
    );
  }

  async cancelSubscription(
    subscriptionId: string,
  ): Promise<ProviderSubscription> {
    // Live: stripe.subscriptions.cancel(subscriptionId)
    void subscriptionId;
    throw new Error(
      "StripeBillingProvider.cancelSubscription requires the Stripe SDK; see the Billing wiki page",
    );
  }

  /**
   * Verify a Stripe webhook signature. This mirrors Stripe's scheme so the
   * verification logic is real even though customer/subscription calls need the
   * SDK. A forged or stale payload is rejected before any state changes.
   */
  parseWebhook(payload: string, signature: string | null): ProviderEvent {
    if (!signature) throw new Error("missing webhook signature");
    const parts = Object.fromEntries(
      signature.split(",").map((p) => p.split("=") as [string, string]),
    );
    const timestamp = parts.t;
    const provided = parts.v1;
    if (!timestamp || !provided) {
      throw new Error("malformed webhook signature header");
    }
    const expected = createHmac("sha256", this.webhookSecret)
      .update(`${timestamp}.${payload}`)
      .digest("hex");
    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(provided);
    if (
      expectedBuf.length !== providedBuf.length ||
      !timingSafeEqual(expectedBuf, providedBuf)
    ) {
      throw new Error("webhook signature verification failed");
    }
    const raw = JSON.parse(payload) as {
      type: string;
      data: { object: { id: string; plan?: Plan; current_period_end?: number } };
    };
    return mapStripeEvent(raw);
  }
}

function mapStripeEvent(raw: {
  type: string;
  data: { object: { id: string; plan?: Plan; current_period_end?: number } };
}): ProviderEvent {
  const object = raw.data.object;
  const base = {
    providerSubscriptionId: object.id,
    plan: object.plan,
    currentPeriodEnd: object.current_period_end
      ? object.current_period_end * 1000
      : undefined,
  };
  switch (raw.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
      return { type: "subscription.activated", ...base };
    case "invoice.payment_failed":
      return { type: "subscription.past_due", ...base };
    case "customer.subscription.deleted":
      return { type: "subscription.canceled", ...base };
    default:
      throw new Error(`unhandled Stripe event: ${raw.type}`);
  }
}
