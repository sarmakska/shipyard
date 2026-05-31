import type { Plan } from "@/db/schema";

/**
 * Plan catalogue and per-plan usage budgets.
 *
 * Budgets are expressed per metric per billing period. The billing service
 * enforces them when a usage counter is incremented, which is how a plan limit
 * turns into a hard stop rather than a billing surprise.
 */

export interface PlanDefinition {
  id: Plan;
  name: string;
  pricePerMonth: number; // in minor units (pence)
  // metric -> maximum count per period. null means unlimited.
  budgets: Record<string, number | null>;
}

export const PLAN_CATALOGUE: Record<Plan, PlanDefinition> = {
  free: {
    id: "free",
    name: "Free",
    pricePerMonth: 0,
    budgets: { api_calls: 1000, seats: 3 },
  },
  pro: {
    id: "pro",
    name: "Pro",
    pricePerMonth: 4900,
    budgets: { api_calls: 100000, seats: 25 },
  },
  scale: {
    id: "scale",
    name: "Scale",
    pricePerMonth: 29900,
    budgets: { api_calls: null, seats: null },
  },
};

export function budgetFor(plan: Plan, metric: string): number | null {
  const def = PLAN_CATALOGUE[plan];
  return metric in def.budgets ? def.budgets[metric] : 0;
}
