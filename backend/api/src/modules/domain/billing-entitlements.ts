import type { RequestHandler } from "express";
import type { Prisma } from "../../generated/prisma/client.js";
import type { BillingEntitlementsDto } from "@vivarqo/contracts/settings";
import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { AppError } from "../../errors/app-error.js";
import { assertQuotaWithinLimit, assertStorageWithinLimit, PlanLimitExceededError, resolveBillingEntitlements } from "./billing-policy.js";

const subscriptionSelect = { status: true, stripePriceId: true, currentPeriodEnd: true } as const;
function policy(expectedPriceId = env.STRIPE_PRICE_ID) {
  return {
    accessMode: env.BILLING_ACCESS_MODE,
    pastDueGraceDays: env.BILLING_PAST_DUE_GRACE_DAYS,
    freeMaxAnimals: env.BILLING_FREE_MAX_ANIMALS,
    freeMaxDocuments: env.BILLING_FREE_MAX_DOCUMENTS,
    freeMaxStorageBytes: env.BILLING_FREE_MAX_STORAGE_BYTES,
    expectedPriceId,
  };
}

export async function getUserEntitlements(userId: string, expectedPriceId = env.STRIPE_PRICE_ID): Promise<BillingEntitlementsDto> {
  const [subscription, animalsUsed, documentsUsed, storage] = await Promise.all([
    prisma.subscription.findUnique({ where: { userId }, select: subscriptionSelect }),
    // Archived animals still consume a slot because their care history is retained.
    prisma.animal.count({ where: { userId } }),
    prisma.document.count({ where: { userId, deletedAt: null } }),
    prisma.document.aggregate({ where: { userId, deletedAt: null }, _sum: { sizeBytes: true } }),
  ]);
  return {
    ...resolveBillingEntitlements(subscription, policy(expectedPriceId)),
    animalsUsed, documentsUsed, storageBytesUsed: (storage._sum.sizeBytes ?? 0n).toString(),
  };
}
async function lockQuota(tx: Prisma.TransactionClient, userId: string) {
  // Row lock returns a UUID (not PostgreSQL void) and serializes quota checks for this account
  // across API and worker replicas until the surrounding write transaction commits.
  await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
}
async function transactionEntitlements(tx: Prisma.TransactionClient, userId: string) {
  const subscription = await tx.subscription.findUnique({ where: { userId }, select: subscriptionSelect });
  return resolveBillingEntitlements(subscription, policy());
}
function quotaError(check: () => void) {
  try { check(); } catch (error) {
    if (error instanceof PlanLimitExceededError) {
      throw new AppError(403, error.code, error.message, { ...error.details, upgradeRequired: true });
    }
    throw error;
  }
}
export async function assertAnimalCapacity(tx: Prisma.TransactionClient, userId: string, requested: number) {
  if (requested <= 0) return;
  await lockQuota(tx, userId);
  const entitlements = await transactionEntitlements(tx, userId);
  if (entitlements.maxAnimals === null) return;
  const current = await tx.animal.count({ where: { userId } });
  quotaError(() => assertQuotaWithinLimit("animals", current, requested, entitlements.maxAnimals, entitlements.plan));
}
export async function assertDocumentCapacity(tx: Prisma.TransactionClient, userId: string, requestedBytes: bigint) {
  await lockQuota(tx, userId);
  const entitlements = await transactionEntitlements(tx, userId);
  const where = { userId, deletedAt: null };
  if (entitlements.maxDocuments !== null) {
    const count = await tx.document.count({ where });
    quotaError(() => assertQuotaWithinLimit("documents", count, 1, entitlements.maxDocuments, entitlements.plan));
  }
  if (entitlements.maxStorageBytes !== null) {
    const usage = await tx.document.aggregate({ where, _sum: { sizeBytes: true } });
    quotaError(() => assertStorageWithinLimit(usage._sum.sizeBytes ?? 0n, requestedBytes, entitlements.maxStorageBytes, entitlements.plan));
  }
}
const accessExempt = (path: string) =>
  path.startsWith("/auth/") || path === "/account" || path.startsWith("/account/") ||
  path === "/billing" || path.startsWith("/billing/") || path === "/webhooks/stripe" ||
  path === "/push/public-key" || path.startsWith("/public/");
export const subscriptionAccessGuard: RequestHandler = async (req, res, next) => {
  if (env.BILLING_ACCESS_MODE !== "subscription_required" || accessExempt(req.path)) { next(); return; }
  const auth = res.locals.auth as { userId: string } | undefined;
  if (!auth) { next(); return; } // Individual private routes still return their normal 401 response.
  const subscription = await prisma.subscription.findUnique({ where: { userId: auth.userId }, select: subscriptionSelect });
  const entitlements = resolveBillingEntitlements(subscription, policy());
  if (!entitlements.accessAllowed) {
    next(new AppError(402, "SUBSCRIPTION_REQUIRED", "An active subscription is required to use this feature", {
      plan: entitlements.plan, subscriptionStatus: entitlements.status,
      gracePeriodEndsAt: entitlements.gracePeriodEndsAt, billingPath: "/billing",
    }));
    return;
  }
  next();
};
