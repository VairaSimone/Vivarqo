import { env } from "./config/env.js";
import { logger } from "./logger.js";
import { prisma } from "./db/prisma.js";
import { ensureDatabaseSchema } from "./db/schema-integrity.js";
import { createApp } from "./app.js";
import { getVapidCredentials } from "./modules/domain/web-push.js";
import { startNotificationWorker } from "./modules/domain/notification-worker.js";
import type { Server } from "node:http";

let server: Server | undefined;
let stopNotificationWorker: () => void = () => undefined;
let shuttingDown = false;

async function startServer(): Promise<void> {
  if (env.NODE_ENV === "production") getVapidCredentials();

  // Never accept HTTP traffic before pending migrations and schema verification finish.
  await ensureDatabaseSchema();
  if (shuttingDown) return;

  const app = createApp();
  stopNotificationWorker = startNotificationWorker();
  server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, apiOrigin: env.API_ORIGIN }, "Vivarqo API listening");
  });
}

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Graceful shutdown started");
  stopNotificationWorker();

  const forcedExit = setTimeout(() => {
    logger.error({ signal }, "Graceful shutdown timed out");
    process.exit(1);
  }, 10_000);
  forcedExit.unref();

  if (!server) {
    void prisma.$disconnect()
      .then(() => {
        clearTimeout(forcedExit);
        logger.info({ signal }, "Shutdown completed before the HTTP server started");
      })
      .catch((error: unknown) => {
        clearTimeout(forcedExit);
        logger.error({
          signal,
          errorName: error instanceof Error ? error.name : "UnknownError",
        }, "Database disconnect failed during shutdown");
        process.exitCode = 1;
      });
    return;
  }

  server.close((error) => {
    void prisma.$disconnect()
      .then(() => {
        clearTimeout(forcedExit);
        if (error) {
          logger.error({ signal, errorName: error.name }, "HTTP server close failed");
          process.exitCode = 1;
        } else {
          logger.info({ signal }, "Graceful shutdown completed");
        }
      })
      .catch((disconnectError: unknown) => {
        clearTimeout(forcedExit);
        logger.error({
          signal,
          errorName: disconnectError instanceof Error ? disconnectError.name : "UnknownError",
        }, "Database disconnect failed during shutdown");
        process.exitCode = 1;
      });
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
