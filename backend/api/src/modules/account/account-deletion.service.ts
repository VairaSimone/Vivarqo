import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { deletePrivateObject } from "../domain/private-storage.js";

/**
 * Completes deletion for an account that has already been locked and whose
 * sessions/shares have been revoked. This processor is safe to retry: every
 * storage deletion is idempotent and all relational cleanup commits atomically.
 */
export async function processAccountDeletion(userId: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: userId, accountStatus: "deletion_pending", deletedAt: { not: null } },
    select: {
      id: true,
      subscription: {
        select: { stripeSubscriptionId: true, status: true },
      },
    },
  });
  if (!user) return;

  const stripeSubscriptionId = user.subscription?.stripeSubscriptionId;
  if (stripeSubscriptionId) {
    if (!env.STRIPE_SECRET_KEY) {
      throw new Error("Cannot erase an account with a Stripe subscription until billing credentials are configured");
    }
    let response: Response;
    try {
      response = await fetch(
        "https://api.stripe.com/v1/subscriptions/" + encodeURIComponent(stripeSubscriptionId),
        {
          method: "DELETE",
          headers: { Authorization: "Bearer " + env.STRIPE_SECRET_KEY },
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch {
      throw new Error("Stripe could not be reached to cancel the account subscription");
    }
    if (!response.ok && response.status !== 404) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("Stripe refused to cancel the account subscription");
    }
    await response.body?.cancel().catch(() => undefined);
  }

  // Collect private objects before deleting their database references. Failed
  // deletion leaves the account locked and the durable queue retries the job.
  const [documents, exports, imports] = await Promise.all([
    prisma.document.findMany({ where: { userId }, select: { storageKey: true } }),
    prisma.exportJob.findMany({ where: { userId }, select: { storageKey: true } }),
    prisma.importJob.findMany({ where: { userId }, select: { storageKey: true } }),
  ]);
  const objectKeys = new Set<string>([
    ...documents.map((row) => row.storageKey),
    ...exports.map((row) => row.storageKey).filter((key): key is string => Boolean(key)),
    ...imports.map((row) => row.storageKey),
  ]);
  for (const key of objectKeys) await deletePrivateObject(key);

  await prisma.$transaction(async (tx) => {
    const stillPending = await tx.user.findFirst({
      where: { id: userId, accountStatus: "deletion_pending", deletedAt: { not: null } },
      select: { id: true },
    });
    if (!stillPending) return;

    // Remove references first; several historical relationships intentionally
    // use RESTRICT so ordinary animal deletion cannot destroy breeding records.
    await tx.financeEntry.deleteMany({ where: { userId } });
    await tx.pushDeliveryAttempt.deleteMany({ where: { userId } });
    await tx.publicShare.deleteMany({ where: { userId } });
    await tx.feedingEntry.deleteMany({
      where: {
        OR: [
          { animal: { is: { userId } } },
          { session: { is: { userId } } },
        ],
      },
    });
    await tx.weightMeasurement.deleteMany({ where: { animal: { is: { userId } } } });
    await tx.shedRecord.deleteMany({ where: { animal: { is: { userId } } } });
    await tx.animalNote.deleteMany({ where: { animal: { is: { userId } } } });
    await tx.task.deleteMany({ where: { userId } });
    await tx.reminderRule.deleteMany({ where: { userId } });
    await tx.reproductiveEvent.deleteMany({
      where: {
        OR: [
          { cycle: { is: { userId } } },
          { animal: { is: { userId } } },
        ],
      },
    });
    await tx.egg.deleteMany({ where: { clutch: { is: { cycle: { is: { userId } } } } });
    await tx.incubationLog.deleteMany({ where: { clutch: { is: { cycle: { is: { userId } } } } });
    await tx.animal.updateMany({
      where: { userId },
      data: { originClutchId: null, originOffspringBatchId: null },
    });
    await tx.offspringBatch.deleteMany({ where: { cycle: { is: { userId } } });
    await tx.clutch.deleteMany({ where: { cycle: { is: { userId } } });
    await tx.reproductionCycle.deleteMany({ where: { userId } });
    await tx.animalGeneticTrait.deleteMany({
      where: {
        OR: [
          { animal: { is: { userId } } },
          { sourceAnimal: { is: { userId } } },
        ],
      },
    });
    await tx.stockMovement.deleteMany({ where: { item: { is: { userId } } });
    await tx.document.deleteMany({ where: { userId } });
    await tx.feedingSession.deleteMany({ where: { userId } });
    await tx.animal.deleteMany({ where: { userId } });
    await tx.inventoryItem.deleteMany({ where: { userId } });
    await tx.notification.deleteMany({ where: { userId } });
    await tx.notificationPreferences.deleteMany({ where: { userId } });
    await tx.pushSubscription.deleteMany({ where: { userId } });
    await tx.importJob.deleteMany({ where: { userId } });
    await tx.exportJob.deleteMany({ where: { userId } });
    await tx.userSession.deleteMany({ where: { userId } });
    await tx.authToken.deleteMany({ where: { userId } });
    // Audit events survive with user_id set to NULL, per the FK policy, so
    // the security trail can remain without retaining a directly linked account.
    await tx.user.delete({ where: { id: userId } });
  });
}
