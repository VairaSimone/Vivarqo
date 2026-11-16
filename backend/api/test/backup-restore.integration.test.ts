import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { deletePrivateObject } from "../src/modules/domain/private-storage.js";
import { dispatchExportJob } from "../src/modules/domain/data-jobs-worker.js";

const enabled = process.env.RUN_DB_INTEGRATION === "true";
const origin = "http://localhost:5173";
const password = "Correct-Horse-Battery-42!";
const modules = ["animals", "feedings", "reproduction", "finance", "inventory"];

describe.skipIf(!enabled)("Full account ZIP backup restore integration", () => {
  let app: Express;
  const userIds: string[] = [];
  const exportKeys: string[] = [];

  beforeAll(() => { app = createApp({ checkDatabase: async () => undefined }); });

  afterAll(async () => {
    if (userIds.length) {
      const users = { in: userIds };
      const animals = await prisma.animal.findMany({ where: { userId: users }, select: { id: true } });
      const animalIds = animals.map((row) => row.id);
      const cycles = await prisma.reproductionCycle.findMany({ where: { userId: users }, select: { id: true } });
      const cycleIds = cycles.map((row) => row.id);
      const clutches = await prisma.clutch.findMany({ where: { cycleId: { in: cycleIds } }, select: { id: true } });
      const clutchIds = clutches.map((row) => row.id);
      const items = await prisma.inventoryItem.findMany({ where: { userId: users }, select: { id: true } });
      const itemIds = items.map((row) => row.id);
      const sessions = await prisma.feedingSession.findMany({ where: { userId: users }, select: { id: true } });
      const sessionIds = sessions.map((row) => row.id);
      await prisma.financeEntry.deleteMany({ where: { userId: users } });
      await prisma.document.deleteMany({ where: { userId: users } });
      await prisma.publicShare.deleteMany({ where: { userId: users } });
      await prisma.notificationPreferences.deleteMany({ where: { userId: users } });
      await prisma.notification.deleteMany({ where: { userId: users } });
      await prisma.task.deleteMany({ where: { userId: users } });
      await prisma.reminderRule.deleteMany({ where: { userId: users } });
      await prisma.stockMovement.deleteMany({ where: { itemId: { in: itemIds } } });
      await prisma.inventoryLot.deleteMany({ where: { itemId: { in: itemIds } } });
      await prisma.feedingEntry.deleteMany({ where: { sessionId: { in: sessionIds } } });
      await prisma.inventoryItem.deleteMany({ where: { userId: users } });
      await prisma.inventorySupplier.deleteMany({ where: { userId: users } });
      await prisma.feedingSession.deleteMany({ where: { userId: users } });
      await prisma.incubationLog.deleteMany({ where: { clutchId: { in: clutchIds } } });
      await prisma.egg.deleteMany({ where: { clutchId: { in: clutchIds } } });
      await prisma.offspringBatch.deleteMany({ where: { cycleId: { in: cycleIds } } });
      await prisma.clutch.deleteMany({ where: { id: { in: clutchIds } } });
      await prisma.reproductiveEvent.deleteMany({ where: { cycleId: { in: cycleIds } } });
      await prisma.reproductionCycle.deleteMany({ where: { id: { in: cycleIds } } });
      await prisma.animalNote.deleteMany({ where: { animalId: { in: animalIds } } });
      await prisma.weightMeasurement.deleteMany({ where: { animalId: { in: animalIds } } });
      await prisma.shedRecord.deleteMany({ where: { animalId: { in: animalIds } } });
      await prisma.animalGeneticTrait.deleteMany({ where: { animalId: { in: animalIds } } });
      await prisma.animalGeneticTrait.deleteMany({ where: { sourceAnimalId: { in: animalIds } } });
      await prisma.animal.deleteMany({ where: { userId: users } });
      await prisma.financeBudget.deleteMany({ where: { userId: users } });
      await prisma.financeRecurrence.deleteMany({ where: { userId: users } });
      await prisma.exportJob.deleteMany({ where: { userId: users } });
      await prisma.auditEvent.deleteMany({ where: { userId: users } });
      await prisma.user.deleteMany({ where: { id: users } });
    }
    await Promise.all(exportKeys.map((key) => deletePrivateObject(key).catch(() => undefined)));
    await prisma.$disconnect();
  });

  async function account() {
    const email = "backup-restore-" + randomUUID() + "@example.com";
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 }),
        displayName: "Backup Restore",
        emailVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    const agent = request.agent(app);
    const csrf = (await agent.get("/api/v1/auth/csrf").expect(200)).body.csrfToken as string;
    await agent.post("/api/v1/auth/login").set("Origin", origin).set("X-CSRF-Token", csrf).send({ email, password }).expect(200);
    return { userId: user.id, agent, csrf };
  }

  it("restores IDs and cross-module foreign keys atomically into an empty account", async () => {
    const source = await account();
    const target = await account();
    const parent = await prisma.animal.create({
      data: { userId: source.userId, name: "Backup parent", identifier: "BACKUP-PARENT", species: "Python regius" },
    });
    const child = await prisma.animal.create({
      data: { userId: source.userId, name: "Backup child", identifier: "BACKUP-CHILD", species: "Python regius", motherAnimalId: parent.id },
    });
    const session = await prisma.feedingSession.create({ data: { userId: source.userId, performedAt: new Date("2026-10-01T12:00:00.000Z") } });
    const supplier = await prisma.inventorySupplier.create({ data: { userId: source.userId, name: "Backup supplier" } });
    const item = await prisma.inventoryItem.create({ data: { userId: source.userId, name: "Frozen prey", category: "food", unit: "pcs", quantityOnHand: 3 } });
    const lot = await prisma.inventoryLot.create({
      data: { itemId: item.id, supplierId: supplier.id, quantityReceived: 3, quantityRemaining: 2,
        unitCostCents: 500, purchasedAt: new Date("2026-09-01T10:00:00.000Z") },
    });
    const movement = await prisma.stockMovement.create({
      data: { itemId: item.id, lotId: lot.id, movementType: "in", quantity: 3,
        unitCostCents: 500, occurredAt: new Date("2026-09-01T10:00:00.000Z") },
    });
    await prisma.feedingEntry.create({
      data: { sessionId: session.id, animalId: child.id, outcome: "ate", foodType: "rat",
        inventoryItemId: item.id, inventoryQuantity: 1, inventoryDeducted: false },
    });
    const cycle = await prisma.reproductionCycle.create({
      data: { userId: source.userId, parentAAnimalId: parent.id, name: "Backup cycle", startedOn: new Date("2026-09-01T00:00:00.000Z") },
    });
    const clutch = await prisma.clutch.create({
      data: { cycleId: cycle.id, laidOn: new Date("2026-10-01T00:00:00.000Z"), eggCount: 2 },
    });
    const finance = await prisma.financeEntry.create({
      data: { userId: source.userId, animalId: child.id, reproductionCycleId: cycle.id, clutchId: clutch.id,
        entryType: "expense", occurredOn: new Date("2026-10-02T00:00:00.000Z"), amountCents: 500n,
        currency: "EUR", category: "food", description: "Backup linked expense", sourceStockMovementId: movement.id },
    });

    const created = await source.agent.post("/api/v1/exports")
      .set("Origin", origin).set("X-CSRF-Token", source.csrf)
      .send({ includeDocuments: true, modules }).expect(202);
    const exportId = created.body.export.id as string;
    expect(await dispatchExportJob(exportId)).toBe(true);
    const exportedJob = await prisma.exportJob.findUniqueOrThrow({ where: { id: exportId } });
    if (exportedJob.storageKey) exportKeys.push(exportedJob.storageKey);
    const downloaded = await source.agent.get("/api/v1/exports/" + exportId + "/download")
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      }).expect(200);
    const archive = downloaded.body as Buffer;

    // A UUID primary key cannot be duplicated while the original source rows still exist.
    // Simulate restoring onto a clean database by removing the source account after exporting.
    await prisma.financeEntry.deleteMany({ where: { userId: source.userId } });
    await prisma.stockMovement.deleteMany({ where: { itemId: item.id } });
    await prisma.inventoryLot.deleteMany({ where: { itemId: item.id } });
    await prisma.feedingEntry.deleteMany({ where: { sessionId: session.id } });
    await prisma.feedingSession.deleteMany({ where: { userId: source.userId } });
    await prisma.clutch.deleteMany({ where: { id: clutch.id } });
    await prisma.reproductionCycle.deleteMany({ where: { userId: source.userId } });
    await prisma.inventoryItem.deleteMany({ where: { userId: source.userId } });
    await prisma.inventorySupplier.deleteMany({ where: { userId: source.userId } });
    await prisma.animal.deleteMany({ where: { userId: source.userId } });
    await prisma.user.delete({ where: { id: source.userId } });

    const restored = await target.agent.post("/api/v1/exports/restore")
      .set("Origin", origin).set("X-CSRF-Token", target.csrf)
      .set("Content-Type", "application/zip").send(archive).expect(200);
    expect(restored.body.status).toBe("restored");
    expect(restored.body.restoredRecords).toBeGreaterThanOrEqual(9);

    const restoredChild = await prisma.animal.findUniqueOrThrow({ where: { id: child.id } });
    expect(restoredChild.userId).toBe(target.userId);
    expect(restoredChild.motherAnimalId).toBe(parent.id);
    const restoredFeeding = await prisma.feedingEntry.findFirstOrThrow({ where: { animalId: child.id } });
    expect(restoredFeeding.sessionId).toBe(session.id);
    expect(restoredFeeding.inventoryItemId).toBe(item.id);
    expect((await prisma.inventoryLot.findUniqueOrThrow({ where: { id: lot.id } })).supplierId).toBe(supplier.id);
    expect((await prisma.stockMovement.findUniqueOrThrow({ where: { id: movement.id } })).lotId).toBe(lot.id);
    const restoredFinance = await prisma.financeEntry.findUniqueOrThrow({ where: { id: finance.id } });
    expect(restoredFinance.sourceStockMovementId).toBe(movement.id);
    expect(restoredFinance.reproductionCycleId).toBe(cycle.id);
    expect(restoredFinance.clutchId).toBe(clutch.id);
    expect((await prisma.clutch.findUniqueOrThrow({ where: { id: clutch.id } })).cycleId).toBe(cycle.id);

    await target.agent.post("/api/v1/exports/restore")
      .set("Origin", origin).set("X-CSRF-Token", target.csrf)
      .set("Content-Type", "application/zip").send(archive).expect(409);
  });
});
