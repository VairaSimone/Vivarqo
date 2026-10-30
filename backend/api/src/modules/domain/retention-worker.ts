import { prisma } from "../../db/prisma.js";
import { logger } from "../../logger.js";
import { deletePrivateObject } from "./private-storage.js";

const DEFAULT_RETENTION_INTERVAL_MS = 60 * 60 * 1000;
const DB_CLEANUP_BATCH_SIZE = 500;
const MAX_DB_CLEANUP_BATCHES_PER_RUN = 5;
const MAX_EXPORT_CLEANUPS_PER_RUN = 25;

export interface RetentionCleanupSummary {
  expiredSessions: number;
  expiredTokens: number;
  expiredImports: number;
  expiredExports: number;
  expiredRateLimitBuckets: number;
  failedExportDeletes: number;
  oldPushAttempts: number;
}

const expiredOrDeletedUser = (now: Date) => ({
  OR: [
    { expiresAt: { lte: now } },
    { user: { is: { deletedAt: { not: null } } } },
  ],
});

async function deleteExpiredSessions(now: Date): Promise<number> {
  let removedTotal = 0;
  for (let batch = 0; batch < MAX_DB_CLEANUP_BATCHES_PER_RUN; batch += 1) {
    const candidates = await prisma.userSession.findMany({
      where: expiredOrDeletedUser(now),
      select: { id: true },
      orderBy: { expiresAt: "asc" },
      take: DB_CLEANUP_BATCH_SIZE,
    });
    if (candidates.length === 0) break;
    const removed = await prisma.userSession.deleteMany({
      where: {
        id: { in: candidates.map((row) => row.id) },
        ...expiredOrDeletedUser(now),
      },
    });
    removedTotal += removed.count;
  }
  return removedTotal;
}

async function deleteExpiredTokens(now: Date): Promise<number> {
  let removedTotal = 0;
  for (let batch = 0; batch < MAX_DB_CLEANUP_BATCHES_PER_RUN; batch += 1) {
    const where = {
      OR: [
        { expiresAt: { lte: now } },
        { consumedAt: { not: null } },
        { user: { is: { deletedAt: { not: null } } } },
      ],
    };
    const candidates = await prisma.authToken.findMany({
      where,
      select: { id: true },
      orderBy: { expiresAt: "asc" },
      take: DB_CLEANUP_BATCH_SIZE,
    });
    if (candidates.length === 0) break;
    const removed = await prisma.authToken.deleteMany({
      where: { id: { in: candidates.map((row) => row.id) }, ...where },
    });
    removedTotal += removed.count;
  }
  return removedTotal;
}

async function deleteExpiredImports(now: Date): Promise<number> {
  let removedTotal = 0;
  for (let batch = 0; batch < MAX_DB_CLEANUP_BATCHES_PER_RUN; batch += 1) {
    const where = { expiresAt: { lte: now }, status: { not: "processing" } };
    const candidates = await prisma.importJob.findMany({
      where,
      select: { id: true },
      orderBy: { expiresAt: "asc" },
      take: DB_CLEANUP_BATCH_SIZE,
    });
    if (candidates.length === 0) break;
    const removed = await prisma.importJob.deleteMany({
      where: { id: { in: candidates.map((row) => row.id) }, ...where },
    });
    removedTotal += removed.count;
  }
  return removedTotal;
}

async function deleteExpiredRateLimitBuckets(now: Date): Promise<number> {
  let removedTotal = 0;
  for (let batch = 0; batch < MAX_DB_CLEANUP_BATCHES_PER_RUN; batch += 1) {
    const candidates = await prisma.apiRateLimitBucket.findMany({
      where: { resetAt: { lte: now } },
      select: { namespace: true, keyHash: true },
      orderBy: { resetAt: "asc" },
      take: DB_CLEANUP_BATCH_SIZE,
    });
    if (candidates.length === 0) break;
    const removed = await prisma.apiRateLimitBucket.deleteMany({
      where: {
        resetAt: { lte: now },
        OR: candidates.map((row) => ({ namespace: row.namespace, keyHash: row.keyHash })),
      },
    });
    removedTotal += removed.count;
  }
  return removedTotal;
}

/**
 * Removes expired transient records in bounded batches. Expired export objects
 * are claimed before deletion; failed deletions remain retryable and a completed
 * download is not left pointing to an object that cleanup has already removed.
 */
export async function cleanupExpiredPrivateData(now = new Date()): Promise<RetentionCleanupSummary> {
  const [expiredSessions, expiredTokens, expiredImports, expiredRateLimitBuckets] = await Promise.all([
    deleteExpiredSessions(now),
    deleteExpiredTokens(now),
    deleteExpiredImports(now),
    deleteExpiredRateLimitBuckets(now),
  ]);

  const summary: RetentionCleanupSummary = {
    expiredSessions,
    expiredTokens,
    expiredImports,
    expiredExports: 0,
    expiredRateLimitBuckets,
    failedExportDeletes: 0,
    oldPushAttempts: 0,
  };

  // Delivery history is retained for 90 days and pruned in bounded batches.
  const pushHistoryCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  for (let batch = 0; batch < MAX_DB_CLEANUP_BATCHES_PER_RUN; batch += 1) {
    const candidates = await prisma.pushDeliveryAttempt.findMany({
      where: { createdAt: { lt: pushHistoryCutoff }, status: { in: ["sent", "failed", "subscription_gone"] } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: DB_CLEANUP_BATCH_SIZE,
    });
    if (candidates.length === 0) break;
    const removed = await prisma.pushDeliveryAttempt.deleteMany({
      where: { id: { in: candidates.map((row) => row.id) }, createdAt: { lt: pushHistoryCutoff }, status: { in: ["sent", "failed", "subscription_gone"] } },
    });
    summary.oldPushAttempts += removed.count;
  }

  const expiredExports = await prisma.exportJob.findMany({
    where: { expiresAt: { lte: now }, status: { not: "expired" } },
    select: { id: true, userId: true, status: true, storageKey: true },
    orderBy: { expiresAt: "asc" },
    take: MAX_EXPORT_CLEANUPS_PER_RUN,
  });

  for (const job of expiredExports) {
    if (!job.storageKey) {
      const deleted = await prisma.exportJob.deleteMany({
        where: {
          id: job.id,
          userId: job.userId,
          status: job.status,
          storageKey: null,
          expiresAt: { lte: now },
        },
      });
      summary.expiredExports += deleted.count;
      continue;
    }

    if (job.status !== "cleanup_pending") {
      const claimed = await prisma.exportJob.updateMany({
        where: {
          id: job.id,
          userId: job.userId,
          status: job.status,
          storageKey: job.storageKey,
          expiresAt: { lte: now },
        },
        data: { status: "cleanup_pending" },
      });
      if (claimed.count !== 1) continue;
    }

    try {
      await deletePrivateObject(job.storageKey);
      const expired = await prisma.exportJob.updateMany({
        where: {
          id: job.id,
          userId: job.userId,
          status: "cleanup_pending",
          storageKey: job.storageKey,
          expiresAt: { lte: now },
        },
        data: { status: "expired", storageKey: null },
      });
      summary.expiredExports += expired.count;
    } catch (error) {
      summary.failedExportDeletes += 1;
      logger.warn({
        exportId: job.id,
        errorName: error instanceof Error ? error.name : "UnknownError",
      }, "Expired export cleanup failed; it will be retried");
    }
  }

  return summary;
}

let retentionTimer: NodeJS.Timeout | null = null;
let retentionInFlight = false;

export function startRetentionWorker(intervalMs = DEFAULT_RETENTION_INTERVAL_MS): () => void {
  if (retentionTimer) return () => stopRetentionWorker();

  const run = async () => {
    if (retentionInFlight) return;
    retentionInFlight = true;
    try {
      const summary = await cleanupExpiredPrivateData();
      if (Object.values(summary).some((count) => count > 0)) {
        logger.info(summary, "Private data retention cleanup completed");
      }
    } catch (error) {
      logger.warn({
        errorName: error instanceof Error ? error.name : "UnknownError",
      }, "Private data retention cleanup failed");
    } finally {
      retentionInFlight = false;
    }
  };

  void run();
  retentionTimer = setInterval(() => void run(), intervalMs);
  retentionTimer.unref();
  return () => stopRetentionWorker();
}

export function stopRetentionWorker(): void {
  if (retentionTimer) clearInterval(retentionTimer);
  retentionTimer = null;
}
