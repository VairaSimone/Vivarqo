import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { dispatchDueTaskNotifications } from "../src/modules/domain/notification-worker.js";
import { dispatchPushDeliveryBatch } from "../src/modules/domain/push-delivery-worker.js";

const enabled = process.env.RUN_DB_INTEGRATION === "true";
const userIds: string[] = [];

describe.skipIf(!enabled)("Due-task notification worker", () => {
  afterAll(async () => {
    if (userIds.length) {
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.task.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  it("defers queued push during quiet hours and suppresses it after push is disabled", async () => {
    const user = await prisma.user.create({
      data: {
        email: "notification-quiet-hours-" + randomUUID() + "@example.com",
        passwordHash: await argon2.hash("Test-Password-42!", { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 }),
        displayName: "Quiet Hours Worker",
        emailVerifiedAt: new Date(),
        timezone: "Europe/Rome",
      },
    });
    userIds.push(user.id);
    const subscription = await prisma.pushSubscription.create({
      data: {
        userId: user.id,
        endpoint: "https://fcm.googleapis.com/wp/" + randomUUID(),
        p256dh: Buffer.alloc(65, 1).toString("base64url"),
        authSecret: Buffer.alloc(16, 2).toString("base64url"),
      },
    });
    const notification = await prisma.notification.create({
      data: { userId: user.id, category: "task_due", title: "Reminder", body: "Due", targetPath: "/tasks/" + randomUUID() },
    });
    const quietStart = new Date("1970-01-01T22:00:00.000Z");
    const quietEnd = new Date("1970-01-01T07:00:00.000Z");
    await prisma.notificationPreferences.create({
      data: { userId: user.id, pushEnabled: true, quietHoursStart: quietStart, quietHoursEnd: quietEnd },
    });
    const quietNow = new Date("2026-01-15T22:30:00+01:00");
    const attempt = await prisma.pushDeliveryAttempt.create({
      data: {
        userId: user.id,
        notificationId: notification.id,
        pushSubscriptionId: subscription.id,
        deliveryKey: notification.id + ":" + subscription.id,
        attemptNumber: 1,
        status: "queued",
        scheduledAt: quietNow,
      },
    });

    await dispatchPushDeliveryBatch(quietNow);
    const deferred = await prisma.pushDeliveryAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(deferred.status).toBe("queued");
    expect(deferred.errorCode).toBe("quiet_hours");
    expect(deferred.scheduledAt.getTime()).toBe(quietNow.getTime() + 15 * 60_000);

    await prisma.notificationPreferences.update({
      where: { userId: user.id },
      data: { pushEnabled: false },
    });
    await dispatchPushDeliveryBatch(new Date("2026-01-16T10:00:00+01:00"));
    const suppressed = await prisma.pushDeliveryAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(suppressed.status).toBe("failed");
    expect(suppressed.errorCode).toBe("notifications_disabled");
  });

  it("creates one in-app alert for an overdue task and remains idempotent across repeated runs", async () => {
    const user = await prisma.user.create({
      data: {
        email: "notification-worker-" + randomUUID() + "@example.com",
        passwordHash: await argon2.hash("Test-Password-42!", { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 }),
        displayName: "Notification Worker",
        emailVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    const task = await prisma.task.create({
      data: {
        userId: user.id,
        title: "Check incubator",
        category: "reproduction",
        dueAt: new Date(Date.now() - 10 * 60_000),
      },
    });

    const first = await dispatchDueTaskNotifications(new Date());
    expect(first.created).toBe(1);
    const alert = await prisma.notification.findFirstOrThrow({
      where: { userId: user.id, category: "task_due", targetPath: "/tasks/" + task.id },
    });
    expect(alert.title).toContain("Check incubator");
    expect(alert.body).toBe("È scaduta.");

    const second = await dispatchDueTaskNotifications(new Date());
    expect(second.created).toBe(0);
    expect(await prisma.notification.count({ where: { userId: user.id, category: "task_due" } })).toBe(1);
  });
});
