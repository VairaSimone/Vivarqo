import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { logger } from "../../logger.js";
import { enqueuePushDelivery } from "./background-jobs.js";

type DueTask = {
  id: string;
  userId: string;
  title: string;
  category: string;
  dueAt: Date;
};

export interface ReminderDispatchSummary {
  scanned: number;
  created: number;
  pushAttempted: number;
  pushSent: number;
  pushFailed: number;
}

async function createDueNotification(task: DueTask, now: Date): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    // Lock per task across multiple API replicas. The in-transaction existence check
    // makes retries and overlapping schedulers idempotent.
    const locks = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${"vivarqo:task-due:" + task.id}, 0)) AS locked
    `;
    if (!locks[0]?.locked) return null;

    const path = `/tasks/${task.id}`;
    const existing = await tx.notification.findFirst({
      where: { userId: task.userId, category: "task_due", targetPath: path },
      select: { id: true },
    });
    if (existing) return null;

    const preferences = await tx.notificationPreferences.findUnique({
      where: { userId: task.userId },
      select: { inAppEnabled: true, pushEnabled: true, categories: true },
    });
    const inAppEnabled = preferences?.inAppEnabled ?? true;
    const pushEnabled = preferences?.pushEnabled ?? false;
    const categories = preferences?.categories as Record<string, unknown> | null;
    if ((!inAppEnabled && !pushEnabled) || categories?.task_due === false) return null;

    const lateness = Math.max(0, now.getTime() - task.dueAt.getTime());
    const dueText = lateness < 60_000 ? "È in scadenza." : "È scaduta.";
    const notification = await tx.notification.create({
      data: {
        userId: task.userId,
        category: "task_due",
        title: `Attività da completare: ${task.title}`.slice(0, 160),
        body: dueText,
        targetPath: path,
      },
      select: { id: true },
    });
    return notification.id;
  });
}

/**
 * Idempotent worker entrypoint. Multiple app replicas can call it; PostgreSQL
 * advisory locks plus a unique logical notification check prevent duplicate alerts.
 */
export async function dispatchDueTaskNotifications(now = new Date()): Promise<ReminderDispatchSummary> {
  const tasks = await prisma.$queryRaw<DueTask[]>`
    SELECT t.id::text AS "id", t.user_id::text AS "userId", t.title, t.category, t.due_at AS "dueAt"
    FROM tasks t
    JOIN users u ON u.id = t.user_id
    WHERE t.status = 'open'
      AND t.due_at <= ${now}
      AND u.deleted_at IS NULL
      AND u.account_status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.user_id = t.user_id AND n.category = 'task_due'
          AND n.target_path = '/tasks/' || t.id::text
      )
      AND NOT EXISTS (
        SELECT 1 FROM notification_preferences p
        WHERE p.user_id = t.user_id
          AND ((NOT p.in_app_enabled AND NOT p.push_enabled)
            OR p.categories -> 'task_due' = 'false'::jsonb)
      )
    ORDER BY t.due_at ASC, t.id ASC
    LIMIT 100
  `;

  const summary: ReminderDispatchSummary = { scanned: tasks.length, created: 0, pushAttempted: 0, pushSent: 0, pushFailed: 0 };
  for (const task of tasks) {
    const notificationId = await createDueNotification(task, now);
    if (!notificationId) continue;
    summary.created += 1;

    const preferences = await prisma.notificationPreferences.findUnique({
      where: { userId: task.userId },
      select: { pushEnabled: true },
    });
    if (!preferences?.pushEnabled || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) continue;

    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
      select: { id: true },
    });
    if (!notification) continue;
    try {
      await enqueuePushDelivery({ userId: task.userId, notificationId: notification.id });
      // This counts queued notification deliveries; the durable worker records
      // per-subscription attempts and outcomes separately.
      summary.pushAttempted += 1;
    } catch (error) {
      summary.pushFailed += 1;
      logger.warn({
        notificationId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      }, "Push delivery could not be queued");
    }
  }
  return summary;
}

let workerTimer: NodeJS.Timeout | null = null;
let workerInFlight = false;

export function startNotificationWorker(intervalMs = 60_000): () => void {
  if (workerTimer) return () => stopNotificationWorker();
  const run = async () => {
    if (workerInFlight) return;
    workerInFlight = true;
    try {
      const result = await dispatchDueTaskNotifications();
      if (result.created || result.pushFailed) logger.info(result, "Task reminder notification worker finished");
    } catch (error) {
      logger.warn({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Task reminder notification worker failed");
    } finally {
      workerInFlight = false;
    }
  };
  void run();
  workerTimer = setInterval(() => void run(), intervalMs);
  workerTimer.unref();
  return () => stopNotificationWorker();
}

export function stopNotificationWorker(): void {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
}
