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

describe.skipIf(!integrationEnabled)("Self-service account deletion PostgreSQL integration", () => {
  let app: Express;
  const userIds = new Set<string>();

  beforeAll(() => {
    app = createApp({ checkDatabase: async () => undefined });
  });

  afterAll(async () => {
    if (userIds.size) await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
    await prisma.$disconnect();
  });

  it("requires password and explicit confirmation, removes the session, and leaves only an anonymous tombstone", async () => {
    const user = await prisma.user.create({
      data: {
        email: `account-deletion-${randomUUID()}@example.com`,
        passwordHash: await argon2.hash(password, {
          type: argon2.argon2id,
          memoryCost: 19_456,
          timeCost: 2,
          parallelism: 1,
        }),
        displayName: "Deletion Integration",
        emailVerifiedAt: new Date(),
      },
      select: { id: true, email: true },
    });
    userIds.add(user.id);

    const agent = request.agent(app);
    const csrf = (await agent.get("/api/v1/auth/csrf").expect(200)).body.csrfToken as string;
    const login = await agent
      .post("/api/v1/auth/login")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrf)
      .send({ email: user.email, password })
      .expect(200);
    expect(login.headers["set-cookie"]).toBeDefined();

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

    const response = await agent
      .delete("/api/v1/account")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrf)
      .send({ currentPassword: password, confirmation: "DELETE" })
      .expect(204);

    expect(response.headers["set-cookie"]).toBeDefined();
    const tombstone = await prisma.user.findUnique({ where: { id: user.id } });
    expect(tombstone).toMatchObject({ accountStatus: "deleted", displayName: "Account eliminato" });
    expect(tombstone?.email).toBe(`deleted+${user.id}@accounts-deleted.invalid`);
    expect(tombstone?.deletedAt).toBeInstanceOf(Date);
    expect(await prisma.userSession.count({ where: { userId: user.id } })).toBe(0);
  }, 45_000);
});
