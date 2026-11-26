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
      .send({ name: "Tropical", waterType: "freshwater", volumeLiters: 120, setupDate: "2026-01-01" }).expect(201);
    const id = aquarium.body.aquarium.id as string;
    await owner.agent.post(`/api/v1/aquariums/${id}/readings`).set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ measuredAt: new Date().toISOString(), temperatureC: 25.5, ph: 6.8, ghDkh: null, khDkh: null, ammoniaMgL: 0, nitriteMgL: 0, nitrateMgL: null }).expect(201);
    await owner.agent.get(`/api/v1/aquariums/${id}/readings`).expect(200).expect((res) => {
      expect(res.body.readings).toHaveLength(1);
      expect(Number(res.body.readings[0].ph)).toBeCloseTo(6.8);
      expect(res.body.readings[0].ghDkh).toBeNull();
      expect(res.body.readings[0].khDkh).toBeNull();
      expect(res.body.readings[0].nitrateMgL).toBeNull();
    });
    await owner.agent.put(`/api/v1/aquariums/${id}/ranges`).set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ ranges: [{ parameter: "ph", minValue: 6.5, maxValue: 7.2 }, { parameter: "temperatureC", minValue: 24, maxValue: 28 }] }).expect(200)
      .expect((res) => expect(res.body.ranges).toHaveLength(2));
    await owner.agent.get(`/api/v1/aquariums/${id}/ranges`).expect(200).expect((res) => expect(res.body.ranges).toHaveLength(2));
    await owner.agent.put(`/api/v1/aquariums/${id}/ranges`).set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ ranges: [{ parameter: "ph", minValue: 8, maxValue: 6 }] }).expect(400);
    await owner.agent.get(`/api/v1/aquariums/${id}/export.csv`).expect(200).expect("Content-Type", new RegExp("text/csv")).expect((res) => expect(res.text).toContain("temperatureC"));
    await other.agent.get(`/api/v1/aquariums/${id}/readings`).expect(404);
    await owner.agent.patch(`/api/v1/aquariums/${id}`).set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ name: "Tropical updated", location: "Living room" }).expect(200);
    await owner.agent.patch(`/api/v1/aquariums/${id}/readings/${(await owner.agent.get(`/api/v1/aquariums/${id}/readings`)).body.readings[0].id}`)
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf).send({ ph: 7.1, ghDkh: null, khDkh: null }).expect(200)
      .expect((res) => { expect(res.body.reading.ghDkh).toBeNull(); expect(res.body.reading.khDkh).toBeNull(); });
    await owner.agent.delete(`/api/v1/aquariums/${id}`).set("Origin", origin).set("X-CSRF-Token", owner.csrf).expect(204);
    await owner.agent.get("/api/v1/aquariums").expect(200).expect((res) => expect(res.body.aquariums).toHaveLength(0));
    await owner.agent.get("/api/v1/aquariums?archived=true").expect(200).expect((res) => expect(res.body.aquariums).toHaveLength(1));
    await owner.agent.post(`/api/v1/aquariums/${id}/restore`).set("Origin", origin).set("X-CSRF-Token", owner.csrf).send({}).expect(200);
    await owner.agent.get(`/api/v1/aquariums/${id}/readings`).expect(200).expect((res) => expect(res.body.readings).toHaveLength(1));
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
    const linkedTask = await prisma.task.findFirstOrThrow({ where: { companionCareRecordId: recordId, userId: owner.userId } });
    expect(linkedTask.category).toBe("health");
    await owner.agent.get(`/api/v1/companion-care?animalId=${animal.id}`).expect(200).expect((res) => expect(res.body.records).toHaveLength(1));
    await owner.agent.post(`/api/v1/tasks/${linkedTask.id}/complete`).set("Origin", origin).set("X-CSRF-Token", owner.csrf).send({}).expect(200);
    await owner.agent.get(`/api/v1/companion-care?animalId=${animal.id}&status=completed`).expect(200).expect((res) => {
      expect(res.body.records).toHaveLength(1);
      expect(res.body.records[0].dueStatus).toBe("completed");
    });
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
    await owner.agent.post(`/api/v1/aviaries/${aviary.body.aviary.id}/notes`).set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ title: "Pulizia", body: "Pulizia e disinfezione settimanale" }).expect(201);
    await owner.agent.get(`/api/v1/aviaries/${aviary.body.aviary.id}/history`).expect(200).expect((res) => {
      expect(res.body.movements).toHaveLength(1);
      expect(res.body.notes).toHaveLength(1);
    });
    await owner.agent.get("/api/v1/home/today/collection").expect(200).expect((res) => {
      expect(res.body.totals.active).toBe(1);
      expect(res.body.categories.find((item: { category: string }) => item.category === "birds").active).toBe(1);
    });
    await owner.agent.get("/api/v1/home/today/recent").expect(200).expect((res) => {
      expect(res.body.events.some((item: { type: string }) => item.type === "aviary_movement")).toBe(true);
      expect(res.body.events.some((item: { type: string }) => item.type === "aviary_note")).toBe(true);
    });
    await owner.agent.get("/api/v1/aviaries").expect(200).expect((res) => expect(res.body.aviaries[0].capacityRemaining).toBe(11));
    await owner.agent.patch(`/api/v1/aviaries/${aviary.body.aviary.id}`).set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ name: "Voliera aggiornata", capacity: 15 }).expect(200);
    const aviaryId = aviary.body.aviary.id as string;
    await owner.agent.delete(`/api/v1/aviaries/${aviaryId}`).set("Origin", origin).set("X-CSRF-Token", owner.csrf).expect(204);
    await owner.agent.get("/api/v1/aviaries").expect(200).expect((res) => expect(res.body.aviaries).toHaveLength(0));
    expect(await prisma.aviaryBird.count({ where: { aviaryId, animalId: bird.id } })).toBe(1);
    await owner.agent.get("/api/v1/aviaries?archived=true").expect(200).expect((res) => expect(res.body.aviaries).toHaveLength(1));
    await owner.agent.post(`/api/v1/aviaries/${aviaryId}/restore`).set("Origin", origin).set("X-CSRF-Token", owner.csrf).send({}).expect(200);
    await owner.agent.get(`/api/v1/aviaries/${aviaryId}/birds`).expect(200).expect((res) => expect(res.body.birds.map((item: { id: string }) => item.id)).toContain(bird.id));
  });
});
