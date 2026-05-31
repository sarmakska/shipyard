import type { Repository } from "@/db";
import type {
  Plan,
  Subscription,
  SubscriptionStatus,
  UsageCounter,
} from "@/db/schema";
import { newId } from "../crypto";
import { recordAudit } from "../audit";
import { budgetFor } from "./plans";
import type { BillingProvider, ProviderEvent } from "./provider";

/**
 * Billing service.
 *
 * Owns the subscription state machine and the usage counters, and delegates all
 * money-moving operations to the injected provider. State transitions are
 * validated here so an out-of-order webhook cannot, for example, reactivate a
 * canceled subscription.
 */

export class BillingError extends Error {}
export class UsageLimitError extends Error {
  readonly status = 402;
  constructor(public readonly metric: string) {
    super(`usage limit reached for metric: ${metric}`);
    this.name = "UsageLimitError";
  }
}

// Allowed transitions for the subscription status machine.
const TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  trialing: ["active", "past_due", "canceled"],
  active: ["past_due", "canceled"],
  past_due: ["active", "canceled"],
  canceled: [], // terminal
};

function canTransition(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

function currentPeriod(now = Date.now()): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export class BillingService {
  constructor(
    private readonly repo: Repository,
    private readonly provider: BillingProvider,
  ) {}

  getSubscription(organisationId: string): Subscription | null {
    return this.repo.selectOneScoped<Subscription>(
      organisationId,
      "subscriptions",
    );
  }

  /** Create or replace the subscription for a tenant on a given plan. */
  async subscribe(
    organisationId: string,
    email: string,
    plan: Plan,
    actorUserId: string | null,
  ): Promise<Subscription> {
    const { customerId } = await this.provider.createCustomer({
      organisationId,
      email,
    });
    const providerSub = await this.provider.createSubscription({
      customerId,
      plan,
    });
    const now = Date.now();
    const existing = this.getSubscription(organisationId);
    const record: Subscription = {
      id: existing?.id ?? newId(),
      organisationId,
      plan,
      status: providerSub.status,
      providerCustomerId: customerId,
      providerSubscriptionId: providerSub.id,
      currentPeriodEnd: providerSub.currentPeriodEnd,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (existing) {
      this.repo.updateScoped(
        organisationId,
        "subscriptions",
        {
          plan: record.plan,
          status: record.status,
          providerCustomerId: record.providerCustomerId,
          providerSubscriptionId: record.providerSubscriptionId,
          currentPeriodEnd: record.currentPeriodEnd,
          updatedAt: record.updatedAt,
        },
        { id: existing.id },
      );
    } else {
      this.repo.insertScoped(organisationId, "subscriptions", {
        id: record.id,
        plan: record.plan,
        status: record.status,
        providerCustomerId: record.providerCustomerId,
        providerSubscriptionId: record.providerSubscriptionId,
        currentPeriodEnd: record.currentPeriodEnd,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
    }

    recordAudit(this.repo, {
      organisationId,
      actorUserId,
      action: "billing.subscribe",
      metadata: { plan, status: record.status },
    });
    return record;
  }

  /** Apply a normalised provider webhook event to the stored subscription. */
  applyEvent(organisationId: string, event: ProviderEvent): Subscription {
    const sub = this.getSubscription(organisationId);
    if (!sub) throw new BillingError("no subscription for organisation");
    if (sub.providerSubscriptionId !== event.providerSubscriptionId) {
      throw new BillingError("event does not match stored subscription");
    }
    const target: SubscriptionStatus =
      event.type === "subscription.activated"
        ? "active"
        : event.type === "subscription.past_due"
          ? "past_due"
          : "canceled";

    if (!canTransition(sub.status, target)) {
      throw new BillingError(
        `illegal transition ${sub.status} -> ${target}`,
      );
    }

    const patch: Record<string, unknown> = {
      status: target,
      updatedAt: Date.now(),
    };
    if (event.plan) patch.plan = event.plan;
    if (event.currentPeriodEnd) patch.currentPeriodEnd = event.currentPeriodEnd;

    this.repo.updateScoped(organisationId, "subscriptions", patch, {
      id: sub.id,
    });
    recordAudit(this.repo, {
      organisationId,
      actorUserId: null,
      action: "billing.webhook",
      metadata: { from: sub.status, to: target },
    });
    return this.getSubscription(organisationId) as Subscription;
  }

  async cancel(
    organisationId: string,
    actorUserId: string | null,
  ): Promise<Subscription> {
    const sub = this.getSubscription(organisationId);
    if (!sub) throw new BillingError("no subscription for organisation");
    if (sub.providerSubscriptionId) {
      await this.provider.cancelSubscription(sub.providerSubscriptionId);
    }
    if (!canTransition(sub.status, "canceled")) {
      throw new BillingError(`cannot cancel from ${sub.status}`);
    }
    this.repo.updateScoped(
      organisationId,
      "subscriptions",
      { status: "canceled", updatedAt: Date.now() },
      { id: sub.id },
    );
    recordAudit(this.repo, {
      organisationId,
      actorUserId,
      action: "billing.cancel",
      metadata: { plan: sub.plan },
    });
    return this.getSubscription(organisationId) as Subscription;
  }

  // --- Usage metering -------------------------------------------------------

  getUsage(
    organisationId: string,
    metric: string,
    now = Date.now(),
  ): number {
    const period = currentPeriod(now);
    const row = this.repo.selectOneScoped<UsageCounter>(
      organisationId,
      "usage_counters",
      { metric, period },
    );
    return row?.count ?? 0;
  }

  /**
   * Increment a usage counter, enforcing the plan budget. Throws
   * UsageLimitError if the increment would exceed the budget, which lets the
   * caller return a 402 rather than silently overrun.
   */
  incrementUsage(
    organisationId: string,
    metric: string,
    amount = 1,
    now = Date.now(),
  ): number {
    const sub = this.getSubscription(organisationId);
    const plan: Plan = sub?.plan ?? "free";
    const budget = budgetFor(plan, metric);
    const period = currentPeriod(now);
    const existing = this.repo.selectOneScoped<UsageCounter>(
      organisationId,
      "usage_counters",
      { metric, period },
    );
    const next = (existing?.count ?? 0) + amount;

    if (budget !== null && next > budget) {
      throw new UsageLimitError(metric);
    }

    if (existing) {
      this.repo.updateScoped(
        organisationId,
        "usage_counters",
        { count: next, updatedAt: now },
        { id: existing.id },
      );
    } else {
      this.repo.insertScoped(organisationId, "usage_counters", {
        id: newId(),
        metric,
        period,
        count: next,
        updatedAt: now,
      });
    }
    return next;
  }
}
