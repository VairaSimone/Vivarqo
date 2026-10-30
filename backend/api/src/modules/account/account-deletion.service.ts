import argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { AppError } from "../../errors/app-error.js";
import { deletePrivateObject } from "../domain/private-storage.js";

function providerError(): AppError {
  return new AppError(503, "ACCOUNT_DELETION_BILLING_UNAVAILABLE", "The subscription could not be safely cancelled. Contact support before deleting the account.");
}

async function cancelStripeSubscription(userId: string): Promise<void> {
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
    select: { stripeSubscriptionId: true, status: true },
  });
  if (!subscription?.stripeSubscriptionId || subscription.status === "canceled") return;
  if (!env.STRIPE_SECRET_KEY) throw providerError();

  let response: Response;
  try {
    response = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscription.stripeSubscriptionId)}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Idempotency-Key": `vivarqo-account-delete-${userId}`,
      },
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
  } catch {
    throw providerError();
  }
  if (!response.ok && response.status !== 404) {
    await response.body?.cancel().catch(() => undefined);
    throw providerError();
  }
  await response.body?.cancel().catch(() => undefined);
}

export async function deleteUserAccount(userId: string, currentPassword: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, accountStatus: "active" },
    select: { id: true, email: true, passwordHash: true },
  });
  if (!user) throw new AppError(404, "ACCOUNT_NOT_FOUND", "Account not found");

  let validPassword = false;
  try {
    validPassword = await argon2.verify(user.passwordHash, currentPassword);
  } catch {
    validPassword = false;
  }
  if (!validPassword) throw new AppError(401, "INVALID_CREDENTIALS", "The current password is incorrect");

  // Stop recurring charges before removing the local customer association.
  await cancelStripeSubscription(userId);

  const [animals, cycles, documents, exports, imports] = await Promise.all([
    prisma.animal.findMany({ where: { userId }, select: { id: true } }),
    prisma.reproductionCycle.findMany({ where: { userId }, select: { id: true } }),
    prisma.document.findMany({ where: { userId }, select: { storageKey: true } }),
    prisma.exportJob.findMany({ where: { userId, storageKey: { not: null } }, select: { storageKey: true } }),
    prisma.importJob.findMany({ where: { userId }, select: { storageKey: true } }),
  ]);
  const animalIds = animals.map((animal) => animal.id);
  const cycleIds = cycles.map((cycle) => cycle.id);
  const storageKeys = [
    ...documents.map((document) => document.storageKey),
    ...exports.flatMap((job) => job.storageKey ? [job.storageKey] : []),
    ...imports.map((job) => job.storageKey),
  ];

  // Do not erase database references if private-object deletion fails. Retrying is safe:
  // deleting an already-removed local/S3 object is idempotent.
  try {
    for (const key of storageKeys) await deletePrivateObject(key);
  } catch {
    throw new AppError(503, "ACCOUNT_DELETION_STORAGE_FAILED", "Private files could not all be removed. The account has not yet been erased; retry the request or contact support.");
  }

  const anonymizedEmail = `deleted+${userId}@accounts-deleted.invalid`;
  const unusablePasswordHash = await argon2.hash(randomBytes(64).toString("hex"), {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // Remove restrictive references before their parent records. Historical business
    // data is erased as a group; no animal/care/reproduction record is retained.
    await tx.publicShare.deleteMany({ where: { userId } });
    await tx.financeEntry.deleteMany({ where: { userId } });
    await tx.document.deleteMany({ where: { userId } });
    if (animalIds.length) {
      await tx.animalGeneticTrait.deleteMany({
        where: { OR: [{ animalId: { in: animalIds } }, { sourceAnimalId: { in: animalIds } }] },
      });
      await tx.reproductiveEvent.deleteMany({ where: { animalId: { in: animalIds } } });
      await tx.feedingEntry.deleteMany({ where: { animalId: { in: animalIds } } });
      await tx.weightMeasurement.deleteMany({ where: { animalId: { in: animalIds } } });
      await tx.shedRecord.deleteMany({ where: { animalId: { in: animalIds } } });
      await tx.animalNote.deleteMany({ where: { animalId: { in: animalIds } } });
      await tx.animal.updateMany({
        where: { id: { in: animalIds } },
        data: { originClutchId: null, originOffspringBatchId: null },
      });
    }
    if (cycleIds.length) {
      await tx.reproductiveEvent.deleteMany({ where: { cycleId: { in: cycleIds } } });
      await tx.incubationLog.deleteMany({ where: { clutch: { is: { cycleId: { in: cycleIds } } } } });
      await tx.egg.deleteMany({ where: { clutch: { is: { cycleId: { in: cycleIds } } } } });
      await tx.offspringBatch.deleteMany({ where: { cycleId: { in: cycleIds } } });
      await tx.clutch.deleteMany({ where: { cycleId: { in: cycleIds } } });
      await tx.reproductionCycle.deleteMany({ where: { id: { in: cycleIds } } });
    }
    await tx.feedingEntry.deleteMany({ where: { session: { is: { userId } } } });
    await tx.feedingSession.deleteMany({ where: { userId } });
    await tx.task.deleteMany({ where: { userId } });
    await tx.reminderRule.deleteMany({ where: { userId } });
    await tx.stockMovement.deleteMany({ where: { item: { is: { userId } } } });
    await tx.inventoryItem.deleteMany({ where: { userId } });
    await tx.animal.deleteMany({ where: { userId } });
    await tx.notification.deleteMany({ where: { userId } });
    await tx.notificationPreferences.deleteMany({ where: { userId } });
    await tx.userPreference.deleteMany({ where: { userId } });
    await tx.pushSubscription.deleteMany({ where: { userId } });
    await tx.importJob.deleteMany({ where: { userId } });
    await tx.exportJob.deleteMany({ where: { userId } });
    await tx.auditEvent.deleteMany({ where: { userId } });
    await tx.subscription.deleteMany({ where: { userId } });
    await tx.authToken.deleteMany({ where: { userId } });
    await tx.userSession.deleteMany({ where: { userId } });

    const updated = await tx.user.updateMany({
      where: { id: userId, deletedAt: null },
      data: {
        email: anonymizedEmail,
        displayName: "Account eliminato",
        passwordHash: unusablePasswordHash,
        locale: "it",
        timezone: "Europe/Rome",
        emailVerifiedAt: null,
        accountStatus: "deleted",
        deletedAt: now,
      },
    });
    if (updated.count !== 1) throw new AppError(409, "ACCOUNT_DELETION_CONFLICT", "Account deletion could not be completed because the account changed concurrently");
  });
}
