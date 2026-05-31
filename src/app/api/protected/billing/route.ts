import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { BillingService } from "@/lib/billing/service";
import { FakeBillingProvider } from "@/lib/billing/provider-fake";
import { StripeBillingProvider } from "@/lib/billing/provider-stripe";
import { withGuard, errorResponse } from "@/lib/http";
import { PLAN_CATALOGUE } from "@/lib/billing/plans";
import type { BillingProvider } from "@/lib/billing/provider";
import type { Plan } from "@/db/schema";

/**
 * The provider is chosen by environment. Tests and local development use the
 * fake; setting BILLING_PROVIDER=stripe selects the real adapter.
 */
function provider(): BillingProvider {
  return process.env.BILLING_PROVIDER === "stripe"
    ? new StripeBillingProvider()
    : new FakeBillingProvider();
}

export async function GET(req: NextRequest) {
  return withGuard(
    { permission: "billing:read" },
    (ctx) => {
      const billing = new BillingService(db(), provider());
      const subscription = billing.getSubscription(ctx.organisationId);
      const usage = {
        api_calls: billing.getUsage(ctx.organisationId, "api_calls"),
        seats: billing.getUsage(ctx.organisationId, "seats"),
      };
      return NextResponse.json({
        subscription,
        usage,
        plans: Object.values(PLAN_CATALOGUE),
      });
    },
    req,
  );
}

export async function POST(req: NextRequest) {
  return withGuard(
    { permission: "billing:manage" },
    async (ctx, request) => {
      try {
        const body = (await request.json()) as { plan?: Plan };
        if (!body.plan || !(body.plan in PLAN_CATALOGUE)) {
          return NextResponse.json(
            { error: "valid plan is required" },
            { status: 400 },
          );
        }
        const billing = new BillingService(db(), provider());
        const subscription = await billing.subscribe(
          ctx.organisationId,
          ctx.user.email,
          body.plan,
          ctx.user.id,
        );
        return NextResponse.json({ subscription });
      } catch (error) {
        return errorResponse(error);
      }
    },
    req,
  );
}
