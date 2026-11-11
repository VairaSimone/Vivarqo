import { describe, expect, it } from "vitest";
import {
  assertQuotaWithinLimit,
  assertStorageWithinLimit,
  PlanLimitExceededError,
  resolveBillingEntitlements,
  type BillingPolicy,
} from "../src/modules/domain/billing-policy.js";

const now = new Date("2026-11-11T12:00:00.000Z");
const policy: BillingPolicy = {
  accessMode: "subscription_required",
  pastDueGraceDays: 7,
  freeMaxAnimals: 10,
  freeMaxDocuments: 25,
  freeMaxStorageBytes: 1_000_000,
  expectedPriceId: "price_vivarqo_paid",
};

describe("billing entitlement policy", () => {
  it("grants paid access to active and trialing subscriptions until their period ends", () => {
    for (const status of ["active", "trialing"]) {
      const result = resolveBillingEntitlements({
        status, stripePriceId: policy.expectedPriceId, currentPeriodEnd: new Date("2026-12-01T00:00:00.000Z"),
      }, policy, now);
      expect(result).toMatchObject({ plan: "paid", paidSubscription: true, accessAllowed: true });
      expect(result.maxAnimals).toBeNull();
    }
  });

  it("fails closed for active or trialing subscriptions without a synchronized period end", () => {
    for (const status of ["active", "trialing"]) {
      const result = resolveBillingEntitlements({
        status, stripePriceId: policy.expectedPriceId, currentPeriodEnd: null,
      }, policy, now);
      expect(result).toMatchObject({
        plan: "free", paidSubscription: false, accessAllowed: false,
      });
    }
  });

  it("keeps scheduled cancellation active through the paid period, then revokes access", () => {
    const active = resolveBillingEntitlements({
      status: "active", stripePriceId: policy.expectedPriceId, currentPeriodEnd: new Date("2026-11-12T00:00:00.000Z"),
    }, policy, now);
    const expired = resolveBillingEntitlements({
      status: "active", stripePriceId: policy.expectedPriceId, currentPeriodEnd: new Date("2026-11-10T00:00:00.000Z"),
    }, policy, now);
    expect(active.paidSubscription).toBe(true);
    expect(expired).toMatchObject({ plan: "free", paidSubscription: false, accessAllowed: false });
  });

  it("grants past-due grace through its inclusive deadline and revokes it afterwards", () => {
    const subscription = {
      status: "past_due",
      stripePriceId: policy.expectedPriceId,
      currentPeriodEnd: new Date("2026-11-10T12:00:00.000Z"),
    };
    const inside = resolveBillingEntitlements(subscription, policy, now);
    const after = resolveBillingEntitlements(subscription, policy, new Date("2026-11-17T12:00:00.001Z"));
    expect(inside).toMatchObject({ plan: "paid", paidSubscription: true, accessAllowed: true });
    expect(inside.gracePeriodEndsAt).toBe("2026-11-17T12:00:00.000Z");
    expect(after).toMatchObject({ plan: "free", paidSubscription: false, accessAllowed: false });
  });

  it("does not grant paid access for canceled, unpaid, paused or incomplete states", () => {
    for (const status of ["canceled", "unpaid", "paused", "incomplete", "incomplete_expired"]) {
      const result = resolveBillingEntitlements({
        status, stripePriceId: policy.expectedPriceId, currentPeriodEnd: new Date("2026-12-01T00:00:00.000Z"),
      }, policy, now);
      expect(result.paidSubscription, status).toBe(false);
      expect(result.accessAllowed, status).toBe(false);
    }
  });

  it("rejects a subscription whose Stripe price does not match the configured paid plan", () => {
    const result = resolveBillingEntitlements({
      status: "active", stripePriceId: "price_unexpected", currentPeriodEnd: new Date("2026-12-01T00:00:00.000Z"),
    }, policy, now);
    expect(result).toMatchObject({
      plan: "free", paidSubscription: false, accessAllowed: false,
      maxAnimals: 10, maxDocuments: 25, maxStorageBytes: 1_000_000,
    });
  });

  it("treats zero limits as unlimited and supports the initial free-first access mode", () => {
    const result = resolveBillingEntitlements(null, {
      ...policy, accessMode: "unrestricted", freeMaxAnimals: 0, freeMaxDocuments: 0, freeMaxStorageBytes: 0,
    }, now);
    expect(result).toMatchObject({
      plan: "free", paidSubscription: false, accessAllowed: true,
      maxAnimals: null, maxDocuments: null, maxStorageBytes: null,
    });
  });
});

describe("plan quotas", () => {
  it("allows writes at the limit and blocks writes that exceed it", () => {
    expect(() => assertQuotaWithinLimit("animals", 9, 1, 10, "free")).not.toThrow();
    expect(() => assertQuotaWithinLimit("animals", 10, 1, 10, "free")).toThrow(PlanLimitExceededError);
    try {
      assertQuotaWithinLimit("documents", 25, 1, 25, "free");
    } catch (error) {
      expect(error).toBeInstanceOf(PlanLimitExceededError);
      expect((error as PlanLimitExceededError).details).toMatchObject({
        resource: "documents", current: 25, requested: 1, limit: 25, plan: "free",
      });
    }
  });

  it("compares document storage using bigint without precision loss", () => {
    const current = 9_007_199_254_740_000n;
    const max = 9_007_199_254_741_000;
    expect(() => assertStorageWithinLimit(current, 1n, max, "free")).not.toThrow();
    expect(() => assertStorageWithinLimit(current, 1_001n, max, "free")).toThrow(PlanLimitExceededError);
  });

  it("treats a null limit as unlimited", () => {
    expect(() => assertQuotaWithinLimit("animals", 100, 100, null, "free")).not.toThrow();
    expect(() => assertStorageWithinLimit(99n, 100n, null, "free")).not.toThrow();
  });
});
