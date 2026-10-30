import { logger } from "../../logger.js";
import { prisma } from "../../db/prisma.js";
import { getVapidCredentials, sendWebPush } from "./web-push.js";

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;
const POLL_INTERVAL_MS = 5_000;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;
const CLAIM_LEASE_MS = 2 * 60_000;

type ClaimedAttempt = { id: string };

async function claimAttempt(now: Date): Promise<string | null> {
  const claimed = await prisma.$queryRaw<ClaimedAttempt[]>`
    WITH candidate AS (
      SELECT id FROM push_delivery_attempts
      WHERE (status = 'queued' AND scheduled_at <= ${now})
         OR (status = 'processing' AND attempted_at <= ${new Date(now.getTime() - CLAIM_LEASE_MS)})
      ORDER BY scheduled_at ASC, created_at ASC
      FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE push_delivery_attempts AS attempt
    SET status = 'processing', attempted_at = ${now}, updated_at = ${now}
    FROM candidate
    WHERE attempt.id = candidate.id
    RETURNING attempt.id::text AS id
  `;
  return claimed[0]?.id ?? null;
}

type AttemptContext = {
  id: string; userId: string; deliveryKey: string; attemptNumber: number;
  pushSubscriptionId: string | null; notificationId: string | null;
};

async function scheduleRetry(
  attempt: AttemptContext,
  now: Date,
  details: { httpStatus: number | null; errorCode: string },
): Promise<void> {
  if (attempt.attemptNumber >= MAX_ATTEMPTS) {
    await prisma.pushDeliveryAttempt.updateMany({
      where: { id: attempt.id, status: "processing" },
      data: { status: "failed", httpStatus: details.httpStatus, errorCode: details.errorCode, nextAttemptAt: null },
    });
    return;
  }
  const nextNumber = attempt.attemptNumber + 1;
  const nextAttemptAt = new Date(now.getTime() + RETRY_DELAYS_MS[attempt.attemptNumber - 1]!);
  await prisma.$transaction(async (tx) => {
    const changed = await tx.pushDeliveryAttempt.updateMany({
      where: { id: attempt.id, status: "processing" },
      data: { status: "retry_scheduled", httpStatus: details.httpStatus, errorCode: details.errorCode, nextAttemptAt },
    });
    if (changed.count !== 1) return;
    await tx.pushDeliveryAttempt.createMany({
      data: [{
        userId: attempt.userId,
        notificationId: attempt.notificationId,
        pushSubscriptionId: attempt.pushSubscriptionId,
        deliveryKey: attempt.deliveryKey,
        attemptNumber: nextNumber,
        status: "queued",
        scheduledAt: nextAttemptAt,
      }],
      skipDuplicates: true,
    });
  });
}

async function processOne(now: Date): Promise<boolean> {
  const id = await claimAttempt(now);
  if (!id) return false;
  const attempt = await prisma.pushDeliveryAttempt.findUnique({
    where: { id },
    include: { pushSubscription: true, notification: true },
  });
  if (!attempt) return true;
  const context: AttemptContext = {
    id: attempt.id, userId: attempt.userId, deliveryKey: attempt.deliveryKey,
    attemptNumber: attempt.attemptNumber, pushSubscriptionId: attempt.pushSubscriptionId,
    notificationId: attempt.notificationId,
  };
  if (!attempt.pushSubscription || !attempt.notification) {
    await prisma.pushDeliveryAttempt.updateMany({
      where: { id, status: "processing" },
      data: { status: "failed", errorCode: "related_record_missing" },
    });
    return true;
  }

  try {
    const response = await sendWebPush({
      endpoint: attempt.pushSubscription.endpoint,
      p256dh: attempt.pushSubscription.p256dh,
      authSecret: attempt.pushSubscription.authSecret,
    }, {
      title: attempt.notification.title,
      body: attempt.notification.body,
      url: attempt.notification.targetPath ?? "/",
      category: attempt.notification.category,
    }, getVapidCredentials());
    const status = response.status;
    await response.body?.cancel().catch(() => undefined);
    if (status >= 200 && status < 300) {
      await prisma.$transaction(async (tx) => {
        await tx.pushDeliveryAttempt.updateMany({
          where: { id, status: "processing" },
          data: { status: "sent", httpStatus: status, sentAt: new Date(), nextAttemptAt: null, errorCode: null },
        });
        await tx.pushSubscription.updateMany({
          where: { id: attempt.pushSubscriptionId!, userId: attempt.userId },
          data: { lastSuccessAt: new Date() },
        });
      });
    } else if (status === 404 || status === 410) {
      await prisma.$transaction(async (tx) => {
        await tx.pushDeliveryAttempt.updateMany({
          where: { id, status: "processing" },
          data: { status: "subscription_gone", httpStatus: status, errorCode: "subscription_expired" },
        });
        await tx.pushSubscription.deleteMany({ where: { id: attempt.pushSubscriptionId!, userId: attempt.userId } });
      });
    } else if (status === 408 || status === 425 || status === 429 || status >= 500) {
      await scheduleRetry(context, now, { httpStatus: status, errorCode: "push_provider_retryable" });
    } else {
      await prisma.pushDeliveryAttempt.updateMany({
        where: { id, status: "processing" },
        data: { status: "failed", httpStatus: status, errorCode: "push_provider_rejected" },
      });
    }
  } catch (error) {
    await scheduleRetry(context, now, {
      httpStatus: null,
      errorCode: error instanceof Error ? error.name.slice(0, 80) : "network_error",
    });
  }
  return true;
}

let timer: NodeJS.Timeout | null = null;
let inFlight = false;

export async function dispatchPushDeliveryBatch(now = new Date()): Promise<number> {
  let processed = 0;
  for (let index = 0; index < BATCH_SIZE; index += 1) {
    if (!await processOne(now)) break;
    processed += 1;
  }
  return processed;
}

export function startPushDeliveryWorker(): () => void {
  if (timer) return () => stopPushDeliveryWorker();
  const run = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const processed = await dispatchPushDeliveryBatch();
      if (processed > 0) logger.info({ processed }, "Push delivery worker processed attempts");
    } catch (error) {
      logger.warn({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Push delivery worker failed");
    } finally {
      inFlight = false;
    }
  };
  void run();
  timer = setInterval(() => void run(), POLL_INTERVAL_MS);
  timer.unref();
  return () => stopPushDeliveryWorker();
}

export function stopPushDeliveryWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
