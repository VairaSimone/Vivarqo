import { prisma } from "../../db/prisma.js";
import { logger } from "../../logger.js";
import { deletePrivateObject } from "./private-storage.js";

const DB_CLEANUP_BATCH_SIZE = 500;
const MAX_DB_CLEANUP_BATCHES_PER_RUN = 5;
const MAX_EXPORT_CLEANUPS_PER_RUN = 25;
const DEFAULT_MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

export interface ExpiredDataCleanupSummary {
  expiredSessions: number;
  expiredTokens: number;
  expiredImportJobs: number;
  expiredExportJobs: number;
  failedExportDeletes: number;
}

async function deleteExpiredSessions(now: Date): Promise<number> {
  let removedTotal = 0;
  for (let batch = 0; batch < MAX_DB_CLEANUP_BATCHES_PER_RUN; batch += 1) {
    const candidates = await prisma.userSession.findMany({
      where: { expiresAt: { lte: now } },
      select: { id: true },
      orderBy: { expiresAt: "asc" },
      take: DB_CLEANUP_BATCH_SIZE,
    });
    if (candidates.length === 0) break;
    const removed = await prisma.userSession.deleteMany({
      where: { id: { in: candidates.map((row) => row.id) }, expiresAt: { lte: now } },
    });
    removedTotal += removed.count;
  }
  return removedTotal;
}

async function deleteExpiredTokens(now: Date): Promise<number> {
  let removedTotal = 0;
  for (let batch = 0; batch < MAX_DB_CLEANUP_BATCHES_PER_RUN; batch += 1) {
    const candidates = await prisma.authToken.findMany({
      where: { expiresAt: { lte: now } },
      select: { id: true },
      orderBy: { expiresAt: "asc" },
      take: DB_CLEANUP_BATCH_SIZE,
    });
    if (candidates.length === 0) break;
    const removed = await prisma.authToken.deleteMany({
      where: { id: { in: candidates.map((row) => row.id) }, expiresAt: { lte: now } },
    });
    removedTotal += removed.count;
  }
  return removedTotal;
}

async function deleteExpiredImportJobs(now: Date): Promise<number> {
  let removedTotal = 0;
  for (let batch = 0; batch < MAX_DB_CLEANUP_BATCHES_PER_RUN; batch += 1) {
    const candidates = await prisma.importJob.findMany({
      where: { expiresAt: { lte: now }, status: { not: "processing" } },
      select: { id: true },
      orderBy: { expiresAt: "asc" },
      take: DB_CLEANUP_BATCH_SIZE,
    });
    if (candidates.length === 0) break;
    const removed = await prisma.importJob.deleteMany({
      where: {
        id: { in: candidates.map((row) => row.id) },
        expiresAt: { lte: now },
        status: { not: "processing" },
      },
    });
    removedTotal += removed.count;
  }
  return removedTotal;
}

/**
 * Removes expired artifacts in small batches. Export objects are claimed in
 * the database before deletion; a failed delete remains retryable and never
 * leaves a completed download pointing at a missing object.
 */
export async function cleanupExpiredData(now = new Date()): Promise<ExpiredDataCleanupSummary> {
  const [expiredSessions, expiredTokens, expiredImportJobs] = await Promise.all([
    deleteExpiredSessions(now),
    deleteExpiredTokens(now),
    deleteExpiredImportJobs(now),
  ]);

  const exports = await prisma.exportJob.findMany({
    where: { expiresAt: { lte: now }, status: { not: "expired" } },
    select: { id: true, status: true, storageKey: true },
    orderBy: { expiresAt: "asc" },
    take: MAX_EXPORT_CLEANUPS_PER_RUN,
  });

  let expiredExportJobs = 0;
  let failedExportDeletes = 0;
  for (const job of exports) {
    if (!job.storageKey) {
      const expired = await prisma.exportJob.updateMany({
        where: { id: job.id, status: job.status, storageKey: null, expiresAt: { lte: now } },
        data: { status: "expired" },
      });
      expiredExportJobs += expired.count;
      continue;
    }

    if (job.status !== "cleanup_pending") {
      const claimed = await prisma.exportJob.updateMany({
        where: {
          id: job.id,
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
          status: "cleanup_pending",
          storageKey: job.storageKey,
          expiresAt: { lte: now },
        },
        data: { status: "expired", storageKey: null },
      });
      expiredExportJobs += expired.count;
    } catch (error) {
      failedExportDeletes += 1;
      logger.warn({
        exportId: job.id,
        errorName: error instanceof Error ? error.name : "UnknownError",
      }, "Expired export cleanup failed; it will be retried");
    }
  }

  return { expiredSessions, expiredTokens, expiredImportJobs, expiredExportJobs, failedExportDeletes };
}

let maintenanceTimer: NodeJS.Timeout | null = null;
let maintenanceInFlight = false;

export function startMaintenanceWorker(intervalMs = DEFAULT_MAINTENANCE_INTERVAL_MS): () => void {
  if (maintenanceTimer) return () => stopMaintenanceWorker();

  const run = async () => {
    if (maintenanceInFlight) return;
    maintenanceInFlight = true;
    try {
      const summary = await cleanupExpiredData();
      if (Object.values(summary).some((value) => value > 0)) {
        logger.info(summary, "Expired data cleanup finished");
      }
    } catch (error) {
      logger.warn({
        errorName: error instanceof Error ? error.name : "UnknownError",
      }, "Expired data cleanup failed");
    } finally {
      maintenanceInFlight = false;
    }
  };

  void run();
  maintenanceTimer = setInterval(() => void run(), intervalMs);
  maintenanceTimer.unref();
  return () => stopMaintenanceWorker();
}

export function stopMaintenanceWorker(): void {
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  maintenanceTimer = null;
}
