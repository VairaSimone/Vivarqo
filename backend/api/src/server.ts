import { env } from "./config/env.js";
import { initializeSentry } from "./monitoring/sentry.js";
import { logger } from "./logger.js";
import { prisma } from "./db/prisma.js";
import { ensureDatabaseSchema } from "./db/schema-integrity.js";
import { createApp } from "./app.js";
import { getVapidCredentials } from "./modules/domain/web-push.js";
import { startNotificationWorker } from "./modules/domain/notification-worker.js";
import { startRetentionWorker } from "./modules/domain/retention-worker.js";
import { startBackgroundJobs } from "./modules/domain/background-jobs.js";
import type { Server } from "node:http";

let server: Server | undefined;
let stopNotificationWorker: () => void = () => undefined;
let stopRetentionWorker: () => void = () => undefined;
let stopBackgroundJobs: () => Promise<void> = async () => undefined;
let shuttingDown = false;

async function startServer(): Promise<void> {
  initializeSentry();
  if (env.NODE_ENV === "production") getVapidCredentials();

  // Never accept HTTP traffic before pending migrations and schema verification finish.
  await ensureDatabaseSchema();
  if (shuttingDown) return;

  stopBackgroundJobs = await startBackgroundJobs();
  if (shuttingDown) {
    await stopBackgroundJobs();
    return;
  }

  const app = createApp();
  stopNotificationWorker = startNotificationWorker();
  stopRetentionWorker = startRetentionWorker();
  server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, apiOrigin: env.API_ORIGIN }, "Vivarqo API listening");
  });
}

async function finishShutdown(signal: string, serverError?: Error): Promise<void> {
  try {
    await stopBackgroundJobs();
    await prisma.$disconnect();
    if (serverError) {
      logger.error({ signal, errorName: serverError.name }, "HTTP server close failed");
      process.exitCode = 1;
    } else {
      logger.info({ signal }, "Graceful shutdown completed");
    }
  } catch (error) {
    logger.error({
      signal,
      errorName: error instanceof Error ? error.name : "UnknownError",
    }, "Shutdown cleanup failed");
    process.exitCode = 1;
  }
}

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Graceful shutdown started");
  stopNotificationWorker();
  stopRetentionWorker();

  const forcedExit = setTimeout(() => {
    logger.error({ signal }, "Graceful shutdown timed out");
    process.exit(1);
  }, 10_000);
  forcedExit.unref();

  if (!server) {
    void finishShutdown(signal).finally(() => clearTimeout(forcedExit));
    return;
  }

  server.close((error) => {
    void finishShutdown(signal, error).finally(() => clearTimeout(forcedExit));
  });
}

void startServer().catch(async (error: unknown) => {
  if (shuttingDown) return;
  // Startup exceptions can embed connection URLs or provider diagnostics. Keep
  // raw messages out of logs; the error class and failed start are enough to triage.
  logger.fatal({
    errorName: error instanceof Error ? error.name : "UnknownError",
  }, "Vivarqo API startup failed; no HTTP listener was started");
  try {
    await prisma.$disconnect();
  } catch {
    // Preserve the original startup failure as the process exit reason.
  }
  process.exitCode = 1;
});

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
