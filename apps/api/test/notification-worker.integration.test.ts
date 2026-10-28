import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { dispatchDueTaskNotifications } from "../src/modules/domain/notification-worker.js";

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
