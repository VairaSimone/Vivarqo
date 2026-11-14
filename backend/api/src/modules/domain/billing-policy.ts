import type { BillingPlan } from "@vivarqo/contracts/settings";

export interface BillingSubscriptionState {
  status: string;
  stripePriceId?: string | null;
  currentPeriodEnd?: Date | null;
}
export interface BillingPolicy {
  accessMode: "unrestricted" | "subscription_required";
  pastDueGraceDays: number;
  freeMaxAnimals: number;
  freeMaxDocuments: number;
  freeMaxStorageBytes: number;
  expectedPriceIds?: readonly string[];
  expectedPriceId?: string;
  annualPriceId?: string;
}
export type QuotaResource = "animals" | "documents" | "storage";
export interface PlanLimitDetails {
  resource: QuotaResource;
  current: number | string;
  requested: number | string;
  limit: number | string;
  plan: BillingPlan;
}
export class PlanLimitExceededError extends Error {
  readonly code = "PLAN_LIMIT_REACHED";
  constructor(readonly details: PlanLimitDetails) {
    super(`The current plan limit for ${details.resource} has been reached`);
    this.name = "PlanLimitExceededError";
  }
}

export function resolveBillingEntitlements(
  subscription: BillingSubscriptionState | null,
  policy: BillingPolicy,
  now = new Date(),
) {
  const status = subscription?.status ?? null;
  const periodEnd = subscription?.currentPeriodEnd ?? null;
  // Fail closed: without a configured paid price there is no valid paid entitlement.
  const priceMatches = Boolean(subscription?.stripePriceId) && (
    Boolean(policy.expectedPriceIds?.includes(subscription!.stripePriceId!)) ||
    Boolean(policy.expectedPriceId && subscription?.stripePriceId === policy.expectedPriceId)
  );
  let paidSubscription = false;
  let gracePeriodEndsAt: Date | null = null;
  if (subscription && priceMatches) {
    if (status === "active" || status === "trialing") {
      // Fail closed until Stripe has synchronized a verifiable paid-through date.
      // In particular, checkout.session.completed does not contain subscription period dates.
      // A scheduled cancellation remains active through the already-paid period.
      paidSubscription = periodEnd !== null && periodEnd.getTime() > now.getTime();
    } else if (status === "past_due" && periodEnd) {
      gracePeriodEndsAt = new Date(periodEnd.getTime() + policy.pastDueGraceDays * 86_400_000);
      paidSubscription = now.getTime() <= gracePeriodEndsAt.getTime();
    }
  }
  const limit = (value: number): number | null => value > 0 ? value : null;
  return {
    plan: paidSubscription ? "paid" as const : "free" as const,
    billingInterval: paidSubscription && subscription?.stripePriceId === policy.annualPriceId ? "annual" as const
      : paidSubscription ? "monthly" as const : null,
    paidSubscription,
    accessMode: policy.accessMode,
    accessAllowed: policy.accessMode === "unrestricted" || paidSubscription,
    status,
    gracePeriodEndsAt: gracePeriodEndsAt?.toISOString() ?? null,
    maxAnimals: paidSubscription ? null : limit(policy.freeMaxAnimals),
    maxDocuments: paidSubscription ? null : limit(policy.freeMaxDocuments),
    maxStorageBytes: paidSubscription ? null : limit(policy.freeMaxStorageBytes),
    features: paidSubscription ? ["paidSubscription"] : [],
  };
}
export function assertQuotaWithinLimit(
  resource: QuotaResource,
  current: number,
  requested: number,
  max: number | null,
  plan: BillingPlan,
): void {
  if (max === null || current + requested <= max) return;
  throw new PlanLimitExceededError({ resource, current, requested, limit: max, plan });
}
export function assertStorageWithinLimit(current: bigint, requested: bigint, max: number | null, plan: BillingPlan): void {
  if (max === null || current + requested <= BigInt(max)) return;
  throw new PlanLimitExceededError({ resource: "storage", current: current.toString(), requested: requested.toString(), limit: String(max), plan });
}
