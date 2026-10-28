import { prisma } from "../../db/prisma.js";
import { logger } from "../../logger.js";
import { deletePrivateObject } from "./private-storage.js";

const DEFAULT_RETENTION_INTERVAL_MS = 60 * 60 * 1000;

export interface RetentionCleanupSummary {
  expiredSessions: number;
  expiredTokens: number;
  expiredImports: number;
  expiredExports: number;
  failedExportDeletes: number;
}

/**
 * Removes transient records and private export artifacts after their documented
 * expiry. A failed object deletion leaves the export row in place so the next
 * run can retry instead of silently orphaning an object in storage.
 */
export async function cleanupExpiredPrivateData(now = new Date()): Promise<RetentionCleanupSummary> {
  const summary: RetentionCleanupSummary = {
    expiredSessions: 0,
    expiredTokens: 0,
    expiredImports: 0,
    expiredExports: 0,
    failedExportDeletes: 0,
  };

  const sessions = await prisma.userSession.deleteMany({
    where: {
      OR: [
        { expiresAt: { lte: now } },
        { user: { is: { deletedAt: { not: null } } } },
      ],
    },
  });
  summary.expiredSessions = sessions.count;

  const tokens = await prisma.authToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lte: now } },
        { consumedAt: { not: null } },
        { user: { is: { deletedAt: { not: null } } } },
      ],
    },
  });
  summary.expiredTokens = tokens.count;

  const imports = await prisma.importJob.deleteMany({
    where: { expiresAt: { lte: now } },
  });
  summary.expiredImports = imports.count;

  const expiredExports = await prisma.exportJob.findMany({
    where: { expiresAt: { lte: now }, storageKey: { not: null } },
    select: { id: true, userId: true, storageKey: true },
    orderBy: { expiresAt: "asc" },
    take: 100,
  });

  for (const job of expiredExports) {
    if (!job.storageKey) continue;
    try {
      await deletePrivateObject(job.storageKey);
      const deleted = await prisma.exportJob.deleteMany({
        where: {
          id: job.id,
          userId: job.userId,
          storageKey: job.storageKey,
          expiresAt: { lte: now },
        },
      });
      summary.expiredExports += deleted.count;
    } catch (error) {
      summary.failedExportDeletes += 1;
      logger.warn({
        exportId: job.id,
        errorName: error instanceof Error ? error.name : "UnknownError",
      }, "Expired export cleanup failed; it will be retried");
    }
  }

  // Exports without a storage object need no external deletion.
  const metadataOnlyExports = await prisma.exportJob.deleteMany({
    where: { expiresAt: { lte: now }, storageKey: null },
  });
  summary.expiredExports += metadataOnlyExports.count;

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
