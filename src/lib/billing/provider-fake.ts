import { newId } from "../crypto";
import type {
  BillingProvider,
  CreateCustomerInput,
  CreateSubscriptionInput,
  ProviderEvent,
  ProviderSubscription,
} from "./provider";

/**
 * In-memory provider used for tests and local development.
 *
 * It keeps a record of customers and subscriptions so state transitions are
 * observable, and parses webhook payloads as plain JSON so tests can simulate a
 * provider callback without a network. The thirty-day period mirrors the shape
 * a real provider returns.
 */

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export class FakeBillingProvider implements BillingProvider {
  readonly customers = new Map<string, CreateCustomerInput>();
  readonly subscriptions = new Map<string, ProviderSubscription>();

  async createCustomer(
    input: CreateCustomerInput,
  ): Promise<{ customerId: string }> {
    const customerId = `cus_${newId()}`;
    this.customers.set(customerId, input);
    return { customerId };
  }

  async createSubscription(
    input: CreateSubscriptionInput,
  ): Promise<ProviderSubscription> {
    const sub: ProviderSubscription = {
      id: `sub_${newId()}`,
      customerId: input.customerId,
      plan: input.plan,
      // Paid plans begin in trialing and become active on the activation
      // webhook, mirroring a real checkout flow.
      status: input.plan === "free" ? "active" : "trialing",
      currentPeriodEnd: Date.now() + THIRTY_DAYS_MS,
    };
    this.subscriptions.set(sub.id, sub);
    return sub;
  }

  async cancelSubscription(
    subscriptionId: string,
  ): Promise<ProviderSubscription> {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) throw new Error(`unknown subscription: ${subscriptionId}`);
    const canceled = { ...sub, status: "canceled" as const };
    this.subscriptions.set(subscriptionId, canceled);
    return canceled;
  }

  parseWebhook(payload: string, _signature: string | null): ProviderEvent {
    const event = JSON.parse(payload) as ProviderEvent;
    if (!event.type || !event.providerSubscriptionId) {
      throw new Error("malformed webhook payload");
    }
    return event;
  }
}
