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

describe.skipIf(!enabled)("Domain CSV/XLSX import integration", () => {
  let app: Express;
  const userIds: string[] = [];

  beforeAll(() => {
    app = createApp({ checkDatabase: async () => undefined });
  });

  afterAll(async () => {
    if (userIds.length) {
      const users = { in: userIds };
      const cycles = await prisma.reproductionCycle.findMany({ where: { userId: users }, select: { id: true } });
      const cycleIds = cycles.map((row) => row.id);
      const clutches = await prisma.clutch.findMany({ where: { cycleId: { in: cycleIds } }, select: { id: true } });
      const clutchIds = clutches.map((row) => row.id);
      const items = await prisma.inventoryItem.findMany({ where: { userId: users }, select: { id: true } });
      const itemIds = items.map((row) => row.id);
      const animals = await prisma.animal.findMany({ where: { userId: users }, select: { id: true } });
      const animalIds = animals.map((row) => row.id);
      await prisma.financeEntry.deleteMany({ where: { userId: users } });
      await prisma.stockMovement.deleteMany({ where: { itemId: { in: itemIds } } });
      await prisma.inventoryItem.deleteMany({ where: { userId: users } });
      await prisma.incubationLog.deleteMany({ where: { clutchId: { in: clutchIds } } });
      await prisma.egg.deleteMany({ where: { clutchId: { in: clutchIds } } });
      await prisma.offspringBatch.deleteMany({ where: { cycleId: { in: cycleIds } } });
      await prisma.clutch.deleteMany({ where: { id: { in: clutchIds } } });
      await prisma.reproductiveEvent.deleteMany({ where: { cycleId: { in: cycleIds } } });
      await prisma.reproductionCycle.deleteMany({ where: { id: { in: cycleIds } } });
      await prisma.animalNote.deleteMany({ where: { animalId: { in: animalIds } } });
      await prisma.weightMeasurement.deleteMany({ where: { animalId: { in: animalIds } } });
      await prisma.shedRecord.deleteMany({ where: { animalId: { in: animalIds } } });
      await prisma.feedingSession.deleteMany({ where: { userId: users } });
      await prisma.animalGeneticTrait.deleteMany({ where: { animalId: { in: animalIds } } });
      await prisma.animalGeneticTrait.deleteMany({ where: { sourceAnimalId: { in: animalIds } } });
      await prisma.animal.deleteMany({ where: { userId: users } });
      await prisma.importJob.deleteMany({ where: { userId: users } });
      await prisma.auditEvent.deleteMany({ where: { userId: users } });
      await prisma.user.deleteMany({ where: { id: users } });
    }
    await prisma.$disconnect();
  });

  async function account() {
    const email = "domain-import-" + randomUUID() + "@example.com";
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 }),
        displayName: "Domain Import",
        emailVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    const agent = request.agent(app);
    const csrf = (await agent.get("/api/v1/auth/csrf").expect(200)).body.csrfToken as string;
    await agent.post("/api/v1/auth/login").set("Origin", origin).set("X-CSRF-Token", csrf).send({ email, password }).expect(200);
    return { userId: user.id, agent, csrf };
  }

  async function importCsv(owner: Awaited<ReturnType<typeof account>>, entity: string, csv: string) {
    const preview = await owner.agent.post("/api/v1/imports?entity=" + entity)
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .set("Content-Type", "text/csv").send(Buffer.from(csv, "utf8")).expect(201);
    expect(preview.body.validRows).toBe(1);
    expect(preview.body.invalidRows).toBe(0);
    const confirmed = await owner.agent.post("/api/v1/imports/" + preview.body.importId + "/confirm")
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({}).expect(200);
    expect(confirmed.body.createdCount).toBe(1);
    return confirmed.body.report.createdRows[0].id as string;
  }

  it("imports inventory, reproduction relations and finance through preview and atomic confirmation", async () => {
    const owner = await account();
    const parent = await prisma.animal.create({
      data: { userId: owner.userId, name: "Import parent", identifier: "P-IMPORT-1", species: "Python regius" },
    });

    await importCsv(owner, "inventory", "name,category,unit,quantityOnHand,minimumQuantity,notes\nFrozen mice,food,pcs,12,3,Opening stock\n");
    const inventory = await owner.agent.get("/api/v1/inventory/items?q=Frozen%20mice").expect(200);
    expect(inventory.body.items).toHaveLength(1);
    expect(Number(inventory.body.items[0].quantityOnHand)).toBe(12);
    const stockMovement = await prisma.stockMovement.findMany({ where: { itemId: inventory.body.items[0].id } });
    expect(stockMovement).toHaveLength(1);
    expect(stockMovement[0].movementType).toBe("in");

    const cycleId = await importCsv(owner, "reproductionCycles", "name,startedOn,status,parentAAnimalIdentifier\nSpring pairing,2026-03-01,active," + parent.identifier + "\n");
    const cycle = await prisma.reproductionCycle.findUniqueOrThrow({ where: { id: cycleId } });
    expect(cycle.parentAAnimalId).toBe(parent.id);
    const clutchId = await importCsv(owner, "clutches", "cycleId,laidOn,eggCount,status,incubatorLabel\n" + cycleId + ",2026-10-01,4,active,Incubator A\n");
    const clutch = await prisma.clutch.findUniqueOrThrow({ where: { id: clutchId } });
    expect(clutch.cycleId).toBe(cycleId);
    expect(clutch.eggCount).toBe(4);

    await importCsv(owner, "finance", "entryType,occurredOn,amountEUR,currency,category,description\nexpense,2026-10-02,19.99,EUR,food,Imported food receipt\n");
    const entry = await prisma.financeEntry.findFirstOrThrow({ where: { userId: owner.userId, description: "Imported food receipt" } });
    expect(entry.amountCents).toBe(1999n);
  });

  it("rejects impossible calendar dates during preview", async () => {
    const owner = await account();
    const preview = await owner.agent.post("/api/v1/imports?entity=reproductionCycles")
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .set("Content-Type", "text/csv")
      .send(Buffer.from("startedOn,name\n2026-02-31,Invalid date\n", "utf8"))
      .expect(201);

    expect(preview.body.validRows).toBe(0);
    expect(preview.body.invalidRows).toBe(1);
    expect(preview.body.errors[0].reason).toContain("data valida nel formato AAAA-MM-GG");
  });

  it("rejects an offspring batch linked to a clutch from another cycle", async () => {
    const owner = await account();
    const firstCycleId = await importCsv(owner, "reproductionCycles", "name,startedOn\nFirst cycle,2026-01-01\n");
    const secondCycleId = await importCsv(owner, "reproductionCycles", "name,startedOn\nSecond cycle,2026-02-01\n");
    const clutchId = await importCsv(owner, "clutches", "cycleId,laidOn,eggCount\n" + firstCycleId + ",2026-10-01,2\n");
    const csv = "cycleId,bornOn,count,clutchId\n" + secondCycleId + ",2026-10-20,2," + clutchId + "\n";
    const preview = await owner.agent.post("/api/v1/imports?entity=offspringBatches")
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .set("Content-Type", "text/csv").send(Buffer.from(csv, "utf8")).expect(201);

    expect(preview.body.validRows).toBe(0);
    expect(preview.body.invalidRows).toBe(1);
    expect(preview.body.errors[0].reason).toContain("stesso ciclo");
  });

  it("rejects imports that reference another account's reproduction cycle", async () => {
    const owner = await account();
    const other = await account();
    const cycle = await prisma.reproductionCycle.create({
      data: { userId: other.userId, name: "Private cycle", startedOn: new Date("2026-01-01T00:00:00.000Z") },
    });
    const csv = "cycleId,laidOn,eggCount\n" + cycle.id + ",2026-10-01,2\n";
    const preview = await owner.agent.post("/api/v1/imports?entity=clutches")
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .set("Content-Type", "text/csv").send(Buffer.from(csv, "utf8")).expect(201);
    expect(preview.body.validRows).toBe(0);
    expect(preview.body.invalidRows).toBe(1);
    expect(preview.body.errors[0].reason).toContain("Ciclo non trovato in questo account");
  });
});
