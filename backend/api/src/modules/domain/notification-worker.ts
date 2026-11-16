import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { logger } from "../../logger.js";
import { captureException } from "../../middleware/observability.js";

type DueTask = {
  id: string;
  userId: string;
  title: string;
  category: string;
  dueAt: Date;
  locale: string;
};

export interface ReminderDispatchSummary {
  scanned: number;
  created: number;
  pushAttempted: number;
  pushQueued: number;
  pushSent: number;
  pushFailed: number;
}

async function createDueNotification(task: DueTask, now: Date): Promise<{ id: string; queuedCount: number } | null> {
  return prisma.$transaction(async (tx) => {
    // Lock per task across replicas; notification and push outbox entries commit atomically.
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

    const english = task.locale === "en";
    const lateness = Math.max(0, now.getTime() - task.dueAt.getTime());
    const dueText = english
      ? (lateness < 60_000 ? "It is due now." : "It is overdue.")
      : (lateness < 60_000 ? "È in scadenza." : "È scaduta.");
    const notification = await tx.notification.create({
      data: {
        userId: task.userId,
        category: "task_due",
        title: (english ? `Task to complete: ${task.title}` : `Attività da completare: ${task.title}`).slice(0, 160),
        body: dueText,
        targetPath: path,
      },
      select: { id: true, title: true, body: true, category: true, targetPath: true },
    });

    let queuedCount = 0;
    if (pushEnabled && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT) {
      const subscriptions = await tx.pushSubscription.findMany({ where: { userId: task.userId }, select: { id: true } });
      if (subscriptions.length) {
        const queued = await tx.pushDeliveryAttempt.createMany({
          data: subscriptions.map((subscription) => ({
            userId: task.userId,
            notificationId: notification.id,
            pushSubscriptionId: subscription.id,
            deliveryKey: `${notification.id}:${subscription.id}`,
            attemptNumber: 1,
            status: "queued",
            scheduledAt: now,
          })),
          skipDuplicates: true,
        });
        queuedCount = queued.count;
      }
    }
    return { id: notification.id, queuedCount };
  });
}

/**
 * Idempotent worker entrypoint. Multiple app replicas can call it; PostgreSQL
 * advisory locks plus a unique logical notification check prevent duplicate alerts.
 */
export async function dispatchDueTaskNotifications(now = new Date()): Promise<ReminderDispatchSummary> {
  const tasks = await prisma.$queryRaw<DueTask[]>`
    SELECT t.id::text AS "id", t.user_id::text AS "userId", t.title, t.category, t.due_at AS "dueAt",
      u.locale AS "locale"
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

  const summary: ReminderDispatchSummary = { scanned: tasks.length, created: 0, pushAttempted: 0, pushQueued: 0, pushSent: 0, pushFailed: 0 };
  for (const task of tasks) {
    const created = await createDueNotification(task, now);
    if (!created) continue;
    summary.created += 1;
    summary.pushQueued += created.queuedCount;
    summary.pushAttempted += created.queuedCount;
  }
  return summary;
}


type InventoryAlert = { userId: string; locale: string; title: string; body: string; targetPath: string };

export async function dispatchInventoryNotifications(now = new Date()): Promise<{ scanned: number; created: number; pushQueued: number }> {
  const dayKey = now.toISOString().slice(0, 10);
  const [lowStock, lots] = await Promise.all([
    prisma.$queryRaw<Array<{ user_id: string; locale: string; id: string; name: string; quantity_on_hand: string; minimum_quantity: string; unit: string }>>`
      SELECT i.user_id::text, u.locale, i.id::text, i.name, i.quantity_on_hand::text,
        i.minimum_quantity::text, i.unit
      FROM inventory_items i JOIN users u ON u.id = i.user_id
      WHERE i.is_active = TRUE AND i.minimum_quantity IS NOT NULL
        AND i.quantity_on_hand <= i.minimum_quantity
        AND u.deleted_at IS NULL AND u.account_status = 'active'
      ORDER BY i.user_id, i.id LIMIT 500
    `,
    prisma.$queryRaw<Array<{ user_id: string; locale: string; id: string; item_name: string; lot_code: string | null; expires_at: Date; quantity_remaining: string; unit: string }>>`
      SELECT i.user_id::text, u.locale, l.id::text, i.name AS item_name, l.lot_code,
        l.expires_at, l.quantity_remaining::text, i.unit
      FROM inventory_lots l JOIN inventory_items i ON i.id = l.item_id
      JOIN users u ON u.id = i.user_id
      WHERE l.quantity_remaining > 0 AND l.expires_at IS NOT NULL
        AND l.expires_at <= ${new Date(now.getTime() + 30 * 86400000)}
        AND u.deleted_at IS NULL AND u.account_status = 'active'
      ORDER BY i.user_id, l.expires_at, l.id LIMIT 500
    `,
  ]);
  const alerts: InventoryAlert[] = [
    ...lowStock.map((item) => ({
      userId: item.user_id, locale: item.locale,
      title: item.locale === "en" ? "Low inventory stock" : "Scorta inventario bassa",
      body: item.locale === "en"
        ? `${item.name}: ${item.quantity_on_hand} ${item.unit} remaining (minimum ${item.minimum_quantity}).`
        : `${item.name}: restano ${item.quantity_on_hand} ${item.unit} (minimo ${item.minimum_quantity}).`,
      targetPath: `/inventory?alert=low-stock&item=${item.id}&day=${dayKey}`,
    })),
    ...lots.map((lot) => {
      const expired = new Date(lot.expires_at).getTime() < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      const date = new Date(lot.expires_at).toISOString().slice(0, 10);
      return {
        userId: lot.user_id, locale: lot.locale,
        title: expired
          ? (lot.locale === "en" ? "Expired inventory lot" : "Lotto inventario scaduto")
          : (lot.locale === "en" ? "Inventory lot expiring soon" : "Lotto inventario in scadenza"),
        body: lot.locale === "en"
          ? `${lot.item_name}${lot.lot_code ? " · " + lot.lot_code : ""}: ${lot.quantity_remaining} ${lot.unit}, expiry ${date}.`
          : `${lot.item_name}${lot.lot_code ? " · " + lot.lot_code : ""}: ${lot.quantity_remaining} ${lot.unit}, scadenza ${date}.`,
        targetPath: `/inventory?alert=expiry&lot=${lot.id}&day=${dayKey}`,
      };
    }),
  ];
  let created = 0, pushQueued = 0;
  for (const alert of alerts) {
    const result = await prisma.$transaction(async (tx) => {
      const lock = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${"vivarqo:inventory-alert:" + alert.targetPath}, 0)) AS locked
      `;
      if (!lock[0]?.locked) return null;
      const prefs = await tx.notificationPreferences.findUnique({
        where: { userId: alert.userId }, select: { inAppEnabled: true, pushEnabled: true, categories: true },
      });
      const categories = prefs?.categories as Record<string, unknown> | null;
      const inApp = prefs?.inAppEnabled ?? true, push = prefs?.pushEnabled ?? false;
      if ((!inApp && !push) || categories?.inventory === false) return null;
      const existing = await tx.notification.findFirst({
        where: { userId: alert.userId, category: "inventory", targetPath: alert.targetPath }, select: { id: true },
      });
      if (existing) return null;
      const notification = await tx.notification.create({ data: {
        userId: alert.userId, category: "inventory", title: alert.title.slice(0, 160),
        body: alert.body, targetPath: alert.targetPath,
      }, select: { id: true } });
      let queued = 0;
      if (push && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT) {
        const subscriptions = await tx.pushSubscription.findMany({ where: { userId: alert.userId }, select: { id: true } });
        if (subscriptions.length) {
          const batch = await tx.pushDeliveryAttempt.createMany({
            data: subscriptions.map((subscription) => ({
              userId: alert.userId, notificationId: notification.id, pushSubscriptionId: subscription.id,
              deliveryKey: `${notification.id}:${subscription.id}`, attemptNumber: 1, status: "queued", scheduledAt: now,
            })), skipDuplicates: true,
          });
          queued = batch.count;
        }
      }
      return queued;
    });
    if (result !== null) { created += 1; pushQueued += result; }
  }
  return { scanned: alerts.length, created, pushQueued };
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
      const inventory = await dispatchInventoryNotifications();
      if (result.created || result.pushFailed || inventory.created) logger.info({ tasks: result, inventory }, "Notification worker finished");
    } catch (error) {
      logger.warn({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Task reminder notification worker failed");
      captureException(error, { worker: "notifications" });
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
