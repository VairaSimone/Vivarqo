import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { startBackgroundJobs, stopBackgroundJobs } from "../src/modules/domain/background-jobs.js";

const integrationEnabled = process.env.RUN_DB_INTEGRATION === "true";
const origin = "http://localhost:5173";
const password = "Correct-Horse-Battery-42!";

describe.skipIf(!integrationEnabled)("Self-service account deletion and persistent queue PostgreSQL integration", () => {
  let app: Express;

  beforeAll(async () => {
    await startBackgroundJobs();
    app = createApp({ checkDatabase: async () => undefined });
  }, 45_000);

  afterAll(async () => {
    await stopBackgroundJobs();
    await prisma.$disconnect();
  }, 30_000);

  it("requires current password and explicit confirmation, revokes session and deletes account via pg-boss", async () => {
    const email = `account-deletion-${randomUUID()}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(password, {
          type: argon2.argon2id,
          memoryCost: 19_456,
          timeCost: 2,
          parallelism: 1,
        }),
        displayName: "Deletion Integration",
        emailVerifiedAt: new Date(),
      },
      select: { id: true },
    });

    const agent = request.agent(app);
    const csrf = (await agent.get("/api/v1/auth/csrf").expect(200)).body.csrfToken as string;
    await agent
      .post("/api/v1/auth/login")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrf)
      .send({ email, password })
      .expect(200);

    await agent
      .delete("/api/v1/account")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrf)
      .send({ confirmation: "DELETE" })
      .expect(400);
    expect(await prisma.user.count({ where: { id: user.id, accountStatus: "active", deletedAt: null } })).toBe(1);

    await agent
      .delete("/api/v1/account")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrf)
      .send({ currentPassword: "not-the-password", confirmation: "DELETE" })
      .expect(401);
    expect(await prisma.user.count({ where: { id: user.id, accountStatus: "active", deletedAt: null } })).toBe(1);

    const accepted = await agent
      .delete("/api/v1/account")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrf)
      .send({ currentPassword: password, confirmation: "DELETE" })
      .expect(202);
    expect(accepted.body.status).toBe("deletion_pending");

    const deadline = Date.now() + 25_000;
    let remaining = 1;
    while (Date.now() < deadline && remaining > 0) {
      remaining = await prisma.user.count({ where: { id: user.id } });
      if (remaining === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(remaining).toBe(0);
    expect(await prisma.userSession.count({ where: { userId: user.id } })).toBe(0);
  }, 45_000);
});
