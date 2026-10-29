import { PgBoss } from "pg-boss";
import { z } from "zod";
import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { logger } from "../../logger.js";
import { sendPushToUser } from "./web-push.js";

const EXPORT_QUEUE = "vivarqo-export";
const PUSH_QUEUE = "vivarqo-push-delivery";
const ACCOUNT_DELETION_QUEUE = "vivarqo-account-deletion";
const MAX_RETRIES = 8;

const exportJobSchema = z.object({
  exportId: z.string().uuid(),
  userId: z.string().uuid(),
  includeDocuments: z.boolean(),
}).strict();

const pushJobSchema = z.object({
  notificationId: z.string().uuid(),
  userId: z.string().uuid(),
}).strict();

const accountDeletionSchema = z.object({
  userId: z.string().uuid(),
}).strict();

let boss: PgBoss | undefined;
let startup: Promise<PgBoss> | undefined;

function queueUnavailable(): Error {
  return new Error("The persistent PostgreSQL job queue is not running");
}

async function getBoss(): Promise<PgBoss> {
  if (!boss) throw queueUnavailable();
  return boss;
}

function retryOptions(singletonKey: string) {
  return {
    retryLimit: MAX_RETRIES,
    retryDelay: 15,
    retryBackoff: true,
    retryDelayMax: 60 * 60,
    expireInSeconds: 60 * 60,
    heartbeatSeconds: 30,
    retentionSeconds: 14 * 24 * 60 * 60,
    deleteAfterSeconds: 7 * 24 * 60 * 60,
    singletonKey,
    singletonSeconds: 24 * 60 * 60,
  };
}

/**
 * One PostgreSQL-backed queue per process. pg-boss owns its tables and state
 * transitions, so jobs remain available across process restarts and replicas.
 */
export async function startBackgroundJobs(): Promise<() => Promise<void>> {
  if (boss) return async () => stopBackgroundJobs();
  if (startup) {
    await startup;
    return async () => stopBackgroundJobs();
  }

  startup = (async () => {
    const instance = new PgBoss({
      connectionString: env.DATABASE_URL,
      schema: "pgboss",
      application_name: "vivarqo-background-jobs",
    });
    instance.on("error", (error: Error) => {
      logger.error({ errorName: error.name }, "pg-boss reported a queue error");
    });
    instance.on("warning", (warning: { message?: string; name?: string }) => {
      logger.warn({ warning: warning.name ?? "pg-boss-warning" }, "pg-boss warning");
    });
    await instance.start();
    await Promise.all([
      instance.createQueue(EXPORT_QUEUE),
      instance.createQueue(PUSH_QUEUE),
      instance.createQueue(ACCOUNT_DELETION_QUEUE),
    ]);

    await instance.work(EXPORT_QUEUE, async ([job]) => {
      const parsed = exportJobSchema.safeParse(job?.data);
      if (!parsed.success || !job) throw new Error("Invalid export job payload");
      try {
        const { processExportJob } = await import("./exports.routes.js");
        await processExportJob(parsed.data.exportId, parsed.data.userId, parsed.data.includeDocuments);
      } catch (error) {
        if (job.retryCount >= MAX_RETRIES) {
          await prisma.exportJob.updateMany({
            where: { id: parsed.data.exportId, userId: parsed.data.userId, status: { not: "completed" } },
            data: { status: "failed", storageKey: null },
          }).catch(() => undefined);
        }
        throw error;
      }
    });

    await instance.work(PUSH_QUEUE, async ([job]) => {
      const parsed = pushJobSchema.safeParse(job?.data);
      if (!parsed.success || !job) throw new Error("Invalid push delivery job payload");
      const notification = await prisma.notification.findFirst({
        where: { id: parsed.data.notificationId, userId: parsed.data.userId },
        select: { id: true, title: true, body: true, targetPath: true, category: true },
      });
      // Deleting an account or its notification while a job is queued is a
      // legitimate cancellation, not a failed delivery.
      if (!notification) return;
      const delivery = await sendPushToUser(parsed.data.userId, {
        title: notification.title,
        body: notification.body,
        url: notification.targetPath ?? "/",
        category: notification.category,
      }, notification.id, job.retryCount + 1);
      if (delivery.failed > 0) {
        throw new Error("One or more push subscriptions could not be reached");
      }
    });

    await instance.work(ACCOUNT_DELETION_QUEUE, async ([job]) => {
      const parsed = accountDeletionSchema.safeParse(job?.data);
      if (!parsed.success || !job) throw new Error("Invalid account deletion job payload");
      try {
        const { processAccountDeletion } = await import("../account/account-deletion.service.js");
        await processAccountDeletion(parsed.data.userId);
      } catch (error) {
        if (job.retryCount >= MAX_RETRIES) {
          logger.error({ userId: parsed.data.userId }, "Account deletion job exhausted its retry budget");
        }
        throw error;
      }
    });

    boss = instance;
    logger.info({ queues: 3 }, "Persistent background job queues started");
    return instance;
  })();

  try {
    await startup;
    return async () => stopBackgroundJobs();
  } catch (error) {
    startup = undefined;
    throw error;
  }
}

export async function stopBackgroundJobs(): Promise<void> {
  const current = boss;
  boss = undefined;
  startup = undefined;
  if (current) await current.stop();
}

export async function enqueueExportJob(payload: z.input<typeof exportJobSchema>): Promise<void> {
  const data = exportJobSchema.parse(payload);
  const queue = await getBoss();
  await queue.send(EXPORT_QUEUE, data, retryOptions("export:" + data.exportId));
}

export async function enqueuePushDelivery(payload: z.input<typeof pushJobSchema>): Promise<void> {
  const data = pushJobSchema.parse(payload);
  const queue = await getBoss();
  await queue.send(PUSH_QUEUE, data, retryOptions("push:" + data.notificationId));
}

export async function enqueueAccountDeletion(userId: string): Promise<void> {
  const data = accountDeletionSchema.parse({ userId });
  const queue = await getBoss();
  await queue.send(ACCOUNT_DELETION_QUEUE, data, retryOptions("account-deletion:" + userId));
}
