import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const enabled = process.env.RUN_DB_INTEGRATION === "true";
const origin = "http://localhost:5173";
const password = "Correct-Horse-Battery-42!";

describe.skipIf(!enabled)("Aquarium and aviary PostgreSQL integration", () => {
  const userIds: string[] = [];
  let app: Express;
  beforeAll(() => { app = createApp({ checkDatabase: async () => undefined }); });
  afterAll(async () => {
    await prisma.companionCareRecord.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.aquarium.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.aviary.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.animal.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.accountConfiguration.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });
  async function account(categories: string[]) {
    const email = `ecosystems-${randomUUID()}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 }),
        displayName: "Ecosystem integration",
        emailVerifiedAt: new Date(),
        accountConfiguration: { create: { animalCategories: categories } },
      },
    });
    userIds.push(user.id);
    const agent = request.agent(app);
    const csrf = (await agent.get("/api/v1/auth/csrf")).body.csrfToken as string;
    await agent.post("/api/v1/auth/login").set("Origin", origin).set("X-CSRF-Token", csrf).send({ email, password }).expect(200);
    return { userId: user.id, agent, csrf };
  }

  it("enforces account categories on module API routes", async () => {
    const birdsOnly = await account(["birds"]);
    await birdsOnly.agent.get("/api/v1/aquariums").expect(403).expect((res) => expect(res.body.error?.code ?? res.body.code).toBe("ANIMAL_CATEGORY_NOT_ENABLED"));
    await birdsOnly.agent.get("/api/v1/aviaries").expect(200);
  });
  it("records aquarium water parameters and prevents cross-account access", async () => {
    const owner = await account(["fish"]);
    const other = await account(["fish"]);
    const aquarium = await owner.agent.post("/api/v1/aquariums").set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ name: "Tropical", waterType: "freshwater", volumeLiters: 120 }).expect(201);
    const id = aquarium.body.aquarium.id as string;
    await owner.agent.post(`/api/v1/aquariums/${id}/readings`).set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ measuredAt: new Date().toISOString(), temperatureC: 25.5, ph: 6.8, ammoniaMgL: 0, nitriteMgL: 0, nitrateMgL: 15 }).expect(201);
    await owner.agent.get(`/api/v1/aquariums/${id}/readings`).expect(200).expect((res) => {
      expect(res.body.readings).toHaveLength(1);
      expect(Number(res.body.readings[0].ph)).toBeCloseTo(6.8);
    });
    await other.agent.get(`/api/v1/aquariums/${id}/readings`).expect(404);
  });

  it("records dog and cat health events with account isolation", async () => {
    const owner = await account(["dogs_cats"]);
    const other = await account(["dogs_cats"]);
    const animal = await prisma.animal.create({ data: {
      userId: owner.userId, name: "Milo", species: "Gatto europeo", category: "dogs_cats",
      domainProfile: { microchip: "380260000000001", sterilized: true },
    } });
    const created = await owner.agent.post("/api/v1/companion-care").set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ animalId: animal.id, kind: "vaccination", title: "Richiamo annuale", occurredAt: new Date().toISOString(), nextDueAt: new Date(Date.now() + 365 * 86400000).toISOString(), provider: "Ambulatorio test" }).expect(201);
    const recordId = created.body.record.id as string;
    await owner.agent.get(`/api/v1/companion-care?animalId=${animal.id}`).expect(200).expect((res) => expect(res.body.records).toHaveLength(1));
    await other.agent.get(`/api/v1/companion-care?animalId=${animal.id}`).expect(404);
    await other.agent.patch(`/api/v1/companion-care/${recordId}`).set("Origin", origin).set("X-CSRF-Token", other.csrf)
      .send({ title: "Tentativo cross-account" }).expect(404);
  });
  it("assigns only birds owned by the account to an aviary", async () => {
    const owner = await account(["birds"]);
    const aviary = await owner.agent.post("/api/v1/aviaries").set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ name: "Voliere esterna", environment: "outdoor", capacity: 12 }).expect(201);
    const bird = await prisma.animal.create({ data: { userId: owner.userId, name: "Cocorita", species: "Melopsittacus undulatus", category: "birds" } });
    await owner.agent.put(`/api/v1/aviaries/${aviary.body.aviary.id}/birds`).set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ animalIds: [bird.id] }).expect(200).expect((res) => expect(res.body.assignedCount).toBe(1));
  });
});
