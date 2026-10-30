import { createHash, randomUUID } from "node:crypto";
import { env } from "./config/env.js";
import { logger } from "./logger.js";
import { prisma } from "./db/prisma.js";
import { ensureDatabaseSchema } from "./db/schema-integrity.js";
import { getVapidCredentials } from "./modules/domain/web-push.js";
import { startNotificationWorker } from "./modules/domain/notification-worker.js";
import { startRetentionWorker } from "./modules/domain/retention-worker.js";
import { startPushDeliveryWorker } from "./modules/domain/push-delivery-worker.js";
import { startDataJobsWorker } from "./modules/domain/data-jobs-worker.js";

const workerId = randomUUID();
const heartbeatKey = createHash("sha256").update(workerId).digest("hex");
const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TTL_MS = 45_000;
let heartbeatTimer: NodeJS.Timeout | undefined;
let stopNotificationWorker: () => void = () => undefined;
let stopRetentionWorker: () => void = () => undefined;
let stopPushDeliveryWorker: () => void = () => undefined;
let stopDataJobsWorker: () => void = () => undefined;
let shuttingDown = false;

async function writeHeartbeat(): Promise<void> {
  const now = new Date();
  await prisma.$executeRaw`
    INSERT INTO api_rate_limit_buckets (namespace, key_hash, hits, reset_at, updated_at)
    VALUES ('worker-heartbeat', ${heartbeatKey}, 1, ${new Date(now.getTime() + HEARTBEAT_TTL_MS)}, ${now})
    ON CONFLICT (namespace, key_hash) DO UPDATE SET
      hits = 1,
      reset_at = EXCLUDED.reset_at,
      updated_at = EXCLUDED.updated_at
  `;
}

async function start(): Promise<void> {
  await ensureDatabaseSchema();
  if (env.NODE_ENV === "production") getVapidCredentials();
  await writeHeartbeat();
  stopNotificationWorker = startNotificationWorker();
  stopRetentionWorker = startRetentionWorker();
  stopPushDeliveryWorker = startPushDeliveryWorker();
  stopDataJobsWorker = startDataJobsWorker();
  heartbeatTimer = setInterval(() => {
    void writeHeartbeat().catch((error: unknown) => {
      logger.error({ workerId, errorName: error instanceof Error ? error.name : "UnknownError" }, "Background worker heartbeat failed");
    });
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();
  logger.info({ workerId, heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS }, "Vivarqo background worker started");
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal, workerId }, "Background worker shutdown started");
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  stopNotificationWorker();
  stopRetentionWorker();
  stopPushDeliveryWorker();
  stopDataJobsWorker();

  const forcedExit = setTimeout(() => {
    logger.error({ signal, workerId }, "Background worker shutdown timed out");
    process.exit(1);
  }, 10_000);
  forcedExit.unref();

  try {
    await prisma.$executeRaw`
      DELETE FROM api_rate_limit_buckets
      WHERE namespace = 'worker-heartbeat' AND key_hash = ${heartbeatKey}
    `;
    await prisma.$disconnect();
    clearTimeout(forcedExit);
    logger.info({ signal, workerId }, "Background worker shutdown completed");
  } catch (error) {
    clearTimeout(forcedExit);
    logger.error({ signal, workerId, errorName: error instanceof Error ? error.name : "UnknownError" }, "Background worker shutdown failed");
    process.exitCode = 1;
  }
}

void start().catch(async (error: unknown) => {
  logger.fatal({ workerId, errorName: error instanceof Error ? error.name : "UnknownError" }, "Vivarqo background worker startup failed");
  try { await prisma.$disconnect(); } catch { /* Preserve the original startup failure. */ }
  process.exitCode = 1;
});

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
