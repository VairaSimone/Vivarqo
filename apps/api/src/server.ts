import { env } from "./config/env.js";
import { logger } from "./logger.js";
import { prisma } from "./db/prisma.js";
import { createApp } from "./app.js";
import { getVapidCredentials } from "./modules/domain/web-push.js";
import { startNotificationWorker } from "./modules/domain/notification-worker.js";

if (env.NODE_ENV === "production") getVapidCredentials();

const app = createApp();
const stopNotificationWorker = startNotificationWorker();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, apiOrigin: env.API_ORIGIN }, "Vivarqo API listening");
});

let shuttingDown = false;

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

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
