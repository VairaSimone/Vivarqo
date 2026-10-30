import { logger } from "../../logger.js";
import { captureException } from "../../middleware/observability.js";
import { prisma } from "../../db/prisma.js";
import { processQueuedAnimalImport } from "../animals/import.routes.js";
import { processQueuedCareImport } from "./care-import.routes.js";
import { processQueuedDomainImport } from "./domain-import.routes.js";
import { processQueuedExportJob } from "./exports.routes.js";

const POLL_INTERVAL_MS = 2_000;
const LEASE_MS = 5 * 60_000;
const HEARTBEAT_INTERVAL_MS = 60_000;
const MAX_ATTEMPTS = 3;

type ClaimedImport = { id: string; userId: string; entityType: string; attempts: number; leaseToken: string };
type ClaimedExport = { id: string; userId: string; attempts: number; leaseToken: string };

async function claimImport(jobId?: string): Promise<ClaimedImport | null> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - LEASE_MS);
  await prisma.importJob.updateMany({
    where: { status: "processing", processingStartedAt: { lte: staleBefore }, attempts: { gte: MAX_ATTEMPTS } },
    data: { status: "failed", processingStartedAt: null, leaseToken: null, lastErrorCode: "JOB_ATTEMPTS_EXHAUSTED" },
  });
  await prisma.importJob.updateMany({
    where: { status: "queued", expiresAt: { lte: now } },
    data: { status: "failed", processingStartedAt: null, leaseToken: null, lastErrorCode: "JOB_EXPIRED" },
  });
  await prisma.importJob.updateMany({
    where: { status: "processing", expiresAt: { lte: now }, processingStartedAt: { lte: staleBefore } },
    data: { status: "failed", processingStartedAt: null, leaseToken: null, lastErrorCode: "JOB_EXPIRED" },
  });

  const rows = await prisma.$queryRawUnsafe<ClaimedImport[]>(
    "WITH candidate AS (" +
    " SELECT id FROM import_jobs WHERE expires_at > $1 AND attempts < $2 " +
    " AND (status = 'queued' OR (status = 'processing' AND processing_started_at <= $3)) " +
    " AND ($4::uuid IS NULL OR id = $4::uuid) " +
    " ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED" +
    ") UPDATE import_jobs AS job SET status = 'processing', processing_started_at = $1, " +
    " attempts = job.attempts + 1, lease_token = gen_random_uuid(), last_error_code = NULL, updated_at = $1 " +
    " FROM candidate WHERE job.id = candidate.id " +
    " RETURNING job.id::text AS id, job.user_id::text AS \"userId\", job.entity_type AS \"entityType\", " +
    " job.attempts AS attempts, job.lease_token::text AS \"leaseToken\"",
    now, MAX_ATTEMPTS, staleBefore, jobId ?? null,
  );
  return rows[0] ?? null;
}

async function claimExport(jobId?: string): Promise<ClaimedExport | null> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - LEASE_MS);
  await prisma.exportJob.updateMany({
    where: { status: "processing", processingStartedAt: { lte: staleBefore }, attempts: { gte: MAX_ATTEMPTS } },
    data: { status: "failed", processingStartedAt: null, leaseToken: null, lastErrorCode: "JOB_ATTEMPTS_EXHAUSTED" },
  });
  await prisma.exportJob.updateMany({
    where: { status: "pending", expiresAt: { lte: now } },
    data: { status: "failed", processingStartedAt: null, leaseToken: null, lastErrorCode: "JOB_EXPIRED" },
  });
  await prisma.exportJob.updateMany({
    where: { status: "processing", expiresAt: { lte: now }, processingStartedAt: { lte: staleBefore } },
    data: { status: "failed", processingStartedAt: null, leaseToken: null, lastErrorCode: "JOB_EXPIRED" },
  });

  const rows = await prisma.$queryRawUnsafe<ClaimedExport[]>(
    "WITH candidate AS (" +
    " SELECT id FROM export_jobs WHERE expires_at > $1 AND attempts < $2 " +
    " AND (status = 'pending' OR (status = 'processing' AND processing_started_at <= $3)) " +
    " AND ($4::uuid IS NULL OR id = $4::uuid) " +
    " ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED" +
    ") UPDATE export_jobs AS job SET status = 'processing', processing_started_at = $1, " +
    " attempts = job.attempts + 1, lease_token = gen_random_uuid(), last_error_code = NULL, updated_at = $1 " +
    " FROM candidate WHERE job.id = candidate.id " +
    " RETURNING job.id::text AS id, job.user_id::text AS \"userId\", job.attempts AS attempts, " +
    " job.lease_token::text AS \"leaseToken\"",
    now, MAX_ATTEMPTS, staleBefore, jobId ?? null,
  );
  return rows[0] ?? null;
}

function startLeaseHeartbeat(kind: "import" | "export", job: ClaimedImport | ClaimedExport): NodeJS.Timeout {
  const timer = setInterval(() => {
    const now = new Date();
    const update = kind === "import"
      ? prisma.importJob.updateMany({
          where: { id: job.id, status: "processing", leaseToken: job.leaseToken },
          data: { processingStartedAt: now },
        })
      : prisma.exportJob.updateMany({
          where: { id: job.id, status: "processing", leaseToken: job.leaseToken },
          data: { processingStartedAt: now },
        });
    void update.catch((error: unknown) => {
      logger.warn({ jobId: job.id, kind, errorName: error instanceof Error ? error.name : "UnknownError" }, "Data job lease heartbeat failed");
    });
  }, HEARTBEAT_INTERVAL_MS);
  timer.unref();
  return timer;
}

async function failOrRetryImport(job: ClaimedImport): Promise<void> {
  const terminal = job.attempts >= MAX_ATTEMPTS;
  await prisma.importJob.updateMany({
    where: { id: job.id, userId: job.userId, status: "processing", leaseToken: job.leaseToken },
    data: {
      status: terminal ? "failed" : "queued",
      processingStartedAt: null,
      leaseToken: null,
      lastErrorCode: terminal ? "IMPORT_PROCESSING_FAILED" : "IMPORT_RETRY_SCHEDULED",
    },
  });
}

async function failOrRetryExport(job: ClaimedExport): Promise<void> {
  const terminal = job.attempts >= MAX_ATTEMPTS;
  await prisma.exportJob.updateMany({
    where: { id: job.id, userId: job.userId, status: "processing", leaseToken: job.leaseToken },
    data: {
      status: terminal ? "failed" : "pending",
      processingStartedAt: null,
      leaseToken: null,
      lastErrorCode: terminal ? "EXPORT_PROCESSING_FAILED" : "EXPORT_RETRY_SCHEDULED",
    },
  });
}

/** Atomically claims and processes one import. Optional ID is used by deterministic integration tests. */
export async function dispatchImportJob(jobId?: string): Promise<boolean> {
  const job = await claimImport(jobId);
  if (!job) return false;
  const heartbeat = startLeaseHeartbeat("import", job);
  try {
    if (job.entityType === "animals") await processQueuedAnimalImport(job.id, job.userId, job.leaseToken);
    else if (["weights", "sheds", "notes", "feedings"].includes(job.entityType)) {
      await processQueuedCareImport(job.id, job.userId, job.leaseToken);
    } else {
      await processQueuedDomainImport(job.id, job.userId, job.leaseToken);
    }
    const completed = await prisma.importJob.findFirst({
      where: { id: job.id, userId: job.userId, status: "completed" },
      select: { id: true },
    });
    if (!completed) throw new Error("Import processor returned without completing the claimed job");
  } catch (error) {
    logger.warn({ importId: job.id, entityType: job.entityType, errorName: error instanceof Error ? error.name : "UnknownError" }, "Import job failed");
    captureException(error, { worker: "data-jobs", code: "import_failed" });
    await failOrRetryImport(job);
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}

/** Atomically claims and processes one export. Optional ID is used by deterministic integration tests. */
export async function dispatchExportJob(jobId?: string): Promise<boolean> {
  const job = await claimExport(jobId);
  if (!job) return false;
  const heartbeat = startLeaseHeartbeat("export", job);
  try {
    await processQueuedExportJob(job.id, job.userId, job.leaseToken);
    const completed = await prisma.exportJob.findFirst({
      where: { id: job.id, userId: job.userId, status: "completed" },
      select: { id: true },
    });
    if (!completed) throw new Error("Export processor returned without completing the claimed job");
  } catch (error) {
    logger.warn({ exportId: job.id, errorName: error instanceof Error ? error.name : "UnknownError" }, "Export job failed");
    captureException(error, { worker: "data-jobs", code: "export_failed" });
    await failOrRetryExport(job);
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}

export async function dispatchDataJobsBatch(): Promise<{ imports: number; exports: number }> {
  let imports = 0;
  let exports = 0;
  if (await dispatchImportJob()) imports = 1;
  if (await dispatchExportJob()) exports = 1;
  return { imports, exports };
}

let timer: NodeJS.Timeout | null = null;
let inFlight = false;

export function startDataJobsWorker(): () => void {
  if (timer) return () => stopDataJobsWorker();
  const run = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const result = await dispatchDataJobsBatch();
      if (result.imports > 0 || result.exports > 0) logger.info(result, "Asynchronous import/export jobs processed");
    } catch (error) {
      logger.warn({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Data jobs worker failed");
      captureException(error, { worker: "data-jobs" });
    } finally {
      inFlight = false;
    }
  };
  void run();
  timer = setInterval(() => void run(), POLL_INTERVAL_MS);
  timer.unref();
  return () => stopDataJobsWorker();
}

export function stopDataJobsWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
