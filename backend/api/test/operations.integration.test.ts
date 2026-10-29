import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const integrationEnabled = process.env.RUN_DB_INTEGRATION === "true";
const origin = "http://localhost:5173";
const password = "Correct-Horse-Battery-42!";

function localDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function addDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

describe.skipIf(!integrationEnabled)("Operations, reminders, Today and calendar PostgreSQL integration", () => {
  const userIds: string[] = [];
  let app: Express;

  beforeAll(() => {
    app = createApp({ checkDatabase: async () => undefined });
  });

  afterAll(async () => {
    if (userIds.length) {
      const inUsers = { in: userIds };
      await prisma.task.deleteMany({ where: { userId: inUsers } });
      await prisma.reminderRule.deleteMany({ where: { userId: inUsers } });
      await prisma.reproductiveEvent.deleteMany({ where: { cycle: { is: { userId: inUsers } } } });
      await prisma.clutch.deleteMany({ where: { cycle: { is: { userId: inUsers } } } });
      await prisma.reproductionCycle.deleteMany({ where: { userId: inUsers } });
      await prisma.auditEvent.deleteMany({ where: { userId: inUsers } });
      await prisma.animal.deleteMany({ where: { userId: inUsers } });
      await prisma.user.deleteMany({ where: { id: inUsers } });
    }
    await prisma.$disconnect();
  });

  async function account() {
    const email = `operations-${randomUUID()}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(password, {
          type: argon2.argon2id,
          memoryCost: 19_456,
          timeCost: 2,
          parallelism: 1,
        }),
        displayName: "Operations Integration",
        emailVerifiedAt: new Date(),
        timezone: "Europe/Rome",
      },
    });
    userIds.push(user.id);
    const agent = request.agent(app);
    const csrf = (await agent.get("/api/v1/auth/csrf")).body.csrfToken as string;
    const login = await agent
      .post("/api/v1/auth/login")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrf)
      .send({ email, password });
    expect(login.status).toBe(200);
    return { userId: user.id, agent, csrf };
  }

  function task(
    context: Awaited<ReturnType<typeof account>>,
    payload: Record<string, unknown> = {},
  ) {
    return context.agent
      .post("/api/v1/tasks")
      .set("Origin", origin)
      .set("X-CSRF-Token", context.csrf)
      .send({
        title: "Check animal enclosure",
        category: "cleaning",
        dueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        ...payload,
      });
  }

  async function animal(context: Awaited<ReturnType<typeof account>>, name: string) {
    return prisma.animal.create({
      data: {
        userId: context.userId,
        name,
        species: "Python regius",
        sex: "unknown",
      },
    });
  }

  it("creates, filters, updates and completes tasks with ownership isolation", async () => {
    const owner = await account();
    const other = await account();
    const pet = await animal(owner, "Task animal");
    const created = await task(owner, { animalId: pet.id }).expect(201);
    expect(created.body.task.status).toBe("open");
    expect(created.body.task.animalId).toBe(pet.id);

    const list = await owner.agent.get("/api/v1/tasks?status=open&category=cleaning").expect(200);
    expect(list.body.tasks.some((item: { id: string }) => item.id === created.body.task.id)).toBe(true);

    const hidden = await other.agent.get(`/api/v1/tasks/${created.body.task.id}`).expect(404);
    expect(hidden.body.code).toBe("TASK_NOT_FOUND");

    const invalid = await task(owner, { category: "not-a-category" }).expect(400);
    expect(invalid.body.code).toBe("VALIDATION_ERROR");

    const updated = await owner.agent
      .patch(`/api/v1/tasks/${created.body.task.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", owner.csrf)
      .send({ title: "Clean the terrarium" })
      .expect(200);
    expect(updated.body.task.title).toBe("Clean the terrarium");

    await owner.agent
      .post(`/api/v1/tasks/${created.body.task.id}/complete`)
      .set("Origin", origin)
      .set("X-CSRF-Token", owner.csrf)
      .send({})
      .expect(200);
    const completed = await owner.agent.get("/api/v1/tasks?status=completed").expect(200);
    expect(completed.body.tasks.some((item: { id: string }) => item.id === created.body.task.id)).toBe(true);
    const secondCompletion = await owner.agent
      .post(`/api/v1/tasks/${created.body.task.id}/complete`)
      .set("Origin", origin)
      .set("X-CSRF-Token", owner.csrf)
      .send({})
      .expect(409);
    expect(secondCompletion.body.code).toBe("TASK_NOT_OPEN");
  });

  it("creates recurring rules, materializes occurrences, and preserves completed history", async () => {
    const owner = await account();
    const pet = await animal(owner, "Recurring snake");
    // A decades-old due date must advance without iterating once per missed occurrence.
    const dueAt = new Date("2000-01-01T10:00:00.000Z");
    const created = await owner.agent
      .post("/api/v1/tasks/reminder-rules")
      .set("Origin", origin)
      .set("X-CSRF-Token", owner.csrf)
      .send({
        title: "Weigh snake",
        category: "weighing",
        intervalDays: 2,
        nextDueAt: dueAt.toISOString(),
        animalId: pet.id,
      })
      .expect(201);
    expect(created.body.task).toBeTruthy();
    expect(created.body.rule.intervalDays).toBe(2);

    const done = await owner.agent
      .post(`/api/v1/tasks/${created.body.task.id}/complete`)
      .set("Origin", origin)
      .set("X-CSRF-Token", owner.csrf)
      .send({})
      .expect(200);
    expect(done.body.task.status).toBe("completed");
    expect(done.body.nextTask.status).toBe("open");
    expect(new Date(done.body.nextDueAt).getTime()).toBeGreaterThan(Date.now());

    const rules = await owner.agent.get("/api/v1/tasks/reminder-rules?enabled=true").expect(200);
    expect(rules.body.reminderRules.some((rule: { id: string }) => rule.id === created.body.rule.id)).toBe(true);
    const history = await owner.agent.get("/api/v1/tasks?status=completed").expect(200);
    expect(history.body.tasks.some((item: { id: string }) => item.id === created.body.task.id)).toBe(true);

    await owner.agent
      .delete(`/api/v1/tasks/reminder-rules/${created.body.rule.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", owner.csrf)
      .expect(200);
    const disabled = await owner.agent.get("/api/v1/tasks/reminder-rules?enabled=false").expect(200);
    expect(disabled.body.reminderRules.some((rule: { id: string }) => rule.id === created.body.rule.id)).toBe(true);
  });

  it("builds Today and calendar data in the account timezone and does not leak other accounts' events", async () => {
    const owner = await account();
    const other = await account();
    const now = new Date();
    const today = localDate(now);
    const tomorrow = addDate(today, 1);
    const dueTodayAt = new Date(now.getTime() + 30 * 60 * 1000);
    const expectedInToday = localDate(dueTodayAt) === today;
    const dueToday = await task(owner, { title: "Due later today", dueAt: dueTodayAt.toISOString() }).expect(201);
    const overdue = await task(owner, { title: "Overdue action", dueAt: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString() }).expect(201);

    const cycle = await prisma.reproductionCycle.create({
      data: {
        userId: owner.userId,
        name: "Calendar cycle",
        startedOn: new Date(`${today}T00:00:00.000Z`),
        status: "active",
      },
    });
    const ownEvent = await prisma.reproductiveEvent.create({
      data: { cycleId: cycle.id, eventType: "laying", occurredAt: new Date(now.getTime() + 2 * 60 * 60 * 1000), details: "Calendar test" },
    });
    // 23:30 UTC is already the following calendar day in Europe/Rome.
    const midnightEvent = await prisma.reproductiveEvent.create({
      data: { cycleId: cycle.id, eventType: "laying", occurredAt: new Date(`${today}T23:30:00.000Z`), details: "Timezone de-duplication test" },
    });
    const midnightClutch = await prisma.clutch.create({
      data: { cycleId: cycle.id, laidOn: new Date(`${tomorrow}T00:00:00.000Z`), eggCount: 1, status: "active" },
    });
    const otherCycle = await prisma.reproductionCycle.create({
      data: {
        userId: other.userId,
        name: "Private cycle",
        startedOn: new Date(`${today}T00:00:00.000Z`),
        status: "active",
      },
    });
    await prisma.reproductiveEvent.create({
      data: { cycleId: otherCycle.id, eventType: "hatch", occurredAt: new Date(now.getTime() + 2 * 60 * 60 * 1000), details: "Should not appear" },
    });

    const home = await owner.agent.get("/api/v1/home/today").expect(200);
    expect(home.body.timezone).toBe("Europe/Rome");
    expect(home.body.tasks.dueToday.some((item: { id: string }) => item.id === dueToday.body.task.id)).toBe(expectedInToday);
    expect(home.body.tasks.overdue.some((item: { id: string }) => item.id === overdue.body.task.id)).toBe(true);
    expect(home.body.quickActions.some((item: { key: string }) => item.key === "bulk-feeding")).toBe(true);

    const calendar = await owner.agent
      .get(`/api/v1/calendar?from=${today}&to=${tomorrow}&view=week`)
      .expect(200);
    expect(calendar.body.items.some((item: { id: string }) => item.id === ownEvent.id)).toBe(true);
    expect(calendar.body.items.some((item: { id: string }) => item.id === midnightEvent.id)).toBe(true);
    expect(calendar.body.items.some((item: { id: string }) => item.id === midnightClutch.id)).toBe(false);
    expect(calendar.body.items.some((item: { id: string }) => item.title === "Should not appear")).toBe(false);
    expect(calendar.body.items.some((item: { id: string }) => item.id === dueToday.body.task.id)).toBe(true);
  });

  it("validates reminder intervals and prevents attaching an animal from another account", async () => {
    const owner = await account();
    const other = await account();
    const foreignAnimal = await animal(other, "Foreign task animal");

    const invalid = await owner.agent
      .post("/api/v1/tasks/reminder-rules")
      .set("Origin", origin)
      .set("X-CSRF-Token", owner.csrf)
      .send({
        title: "Bad interval",
        category: "feeding",
        intervalDays: 0,
        nextDueAt: new Date().toISOString(),
      })
      .expect(400);
    expect(invalid.body.code).toBe("VALIDATION_ERROR");

    const forbidden = await task(owner, { animalId: foreignAnimal.id }).expect(404);
    expect(forbidden.body.code).toBe("ANIMAL_NOT_FOUND");
  });
});
