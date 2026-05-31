import type { Plan, SubscriptionStatus } from "@/db/schema";

/**
 * Billing provider interface.
 *
 * The application never talks to Stripe directly. It talks to this interface,
 * which a concrete provider implements. The FakeProvider drives the tests and
 * local development; the Stripe-shaped adapter (see provider-stripe.ts) maps the
 * same calls onto the Stripe API. Swapping providers is a one-line change in the
 * billing service wiring.
 */

export interface CreateCustomerInput {
  organisationId: string;
  email: string;
}

export interface CreateSubscriptionInput {
  customerId: string;
  plan: Plan;
}

export interface ProviderSubscription {
  id: string;
  customerId: string;
  plan: Plan;
  status: SubscriptionStatus;
  currentPeriodEnd: number;
}

/** A normalised webhook event the application understands. */
export interface ProviderEvent {
  type:
    | "subscription.activated"
    | "subscription.past_due"
    | "subscription.canceled";
  providerSubscriptionId: string;
  plan?: Plan;
  currentPeriodEnd?: number;
}

export interface BillingProvider {
  createCustomer(input: CreateCustomerInput): Promise<{ customerId: string }>;
  createSubscription(
    input: CreateSubscriptionInput,
  ): Promise<ProviderSubscription>;
  cancelSubscription(subscriptionId: string): Promise<ProviderSubscription>;
  /**
   * Verify and parse a raw webhook payload into a normalised event. The real
   * adapter checks the signature here; the fake one trusts its own JSON.
   */
  parseWebhook(payload: string, signature: string | null): ProviderEvent;
}
