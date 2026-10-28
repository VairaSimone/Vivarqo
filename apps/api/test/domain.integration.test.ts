import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { deletePrivateObject } from "../src/modules/domain/private-storage.js";

const enabled = process.env.RUN_DB_INTEGRATION === "true";
const origin = "http://localhost:5173";
const password = "Correct-Horse-Battery-42!";
const pdf = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n", "ascii");

describe.skipIf(!enabled)("Remaining domain modules PostgreSQL integration", () => {
  const userIds: string[] = [];
  let app: Express;

  beforeAll(() => {
    app = createApp({ checkDatabase: async () => undefined });
  });

  afterAll(async () => {
    if (userIds.length === 0) {
      await prisma.$disconnect();
      return;
    }
    const ids = { in: userIds };
    const exports = await prisma.exportJob.findMany({ where: { userId: ids }, select: { storageKey: true } });
    const docs = await prisma.document.findMany({ where: { userId: ids }, select: { storageKey: true } });
    for (const object of [...exports.map((item) => item.storageKey), ...docs.map((item) => item.storageKey)]) {
      if (object) await deletePrivateObject(object).catch(() => undefined);
    }
    const cycleRows = await prisma.reproductionCycle.findMany({ where: { userId: ids }, select: { id: true } });
    const cycleIds = cycleRows.map((item) => item.id);
    const clutches = await prisma.clutch.findMany({ where: { cycleId: { in: cycleIds } }, select: { id: true } });
    const clutchIds = clutches.map((item) => item.id);
    const itemRows = await prisma.inventoryItem.findMany({ where: { userId: ids }, select: { id: true } });
    const itemIds = itemRows.map((item) => item.id);
    const animalRows = await prisma.animal.findMany({ where: { userId: ids }, select: { id: true } });
    const animalIds = animalRows.map((item) => item.id);

    await prisma.financeEntry.deleteMany({ where: { userId: ids } });
    await prisma.document.deleteMany({ where: { userId: ids } });
    await prisma.publicShare.deleteMany({ where: { userId: ids } });
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.inventoryItem.deleteMany({ where: { userId: ids } });
    await prisma.incubationLog.deleteMany({ where: { clutchId: { in: clutchIds } } });
    await prisma.egg.deleteMany({ where: { clutchId: { in: clutchIds } } });
    await prisma.offspringBatch.deleteMany({ where: { cycleId: { in: cycleIds } } });
    await prisma.clutch.deleteMany({ where: { id: { in: clutchIds } } });
    await prisma.reproductiveEvent.deleteMany({ where: { cycleId: { in: cycleIds } } });
    await prisma.reproductionCycle.deleteMany({ where: { id: { in: cycleIds } } });
    await prisma.animalNote.deleteMany({ where: { animalId: { in: animalIds } } });
    await prisma.weightMeasurement.deleteMany({ where: { animalId: { in: animalIds } } });
    await prisma.shedRecord.deleteMany({ where: { animalId: { in: animalIds } } });
    await prisma.feedingSession.deleteMany({ where: { userId: ids } });
    await prisma.notification.deleteMany({ where: { userId: ids } });
    await prisma.notificationPreferences.deleteMany({ where: { userId: ids } });
    await prisma.pushSubscription.deleteMany({ where: { userId: ids } });
    await prisma.exportJob.deleteMany({ where: { userId: ids } });
    await prisma.subscription.deleteMany({ where: { userId: ids } });
    await prisma.auditEvent.deleteMany({ where: { userId: ids } });
    await prisma.animalGeneticTrait.deleteMany({ where: { animalId: { in: animalIds } } });
    await prisma.animalGeneticTrait.deleteMany({ where: { sourceAnimalId: { in: animalIds } } });
    await prisma.animal.deleteMany({ where: { userId: ids } });
    await prisma.user.deleteMany({ where: { id: ids } });
    await prisma.$disconnect();
  });

  async function account() {
    const email = `domains-${randomUUID()}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 }),
        displayName: "Domain Integration",
        emailVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    const agent = request.agent(app);
    const csrf = (await agent.get("/api/v1/auth/csrf")).body.csrfToken as string;
    const login = await agent.post("/api/v1/auth/login").set("Origin", origin).set("X-CSRF-Token", csrf).send({ email, password });
    expect(login.status).toBe(200);
    return { userId: user.id, agent, csrf };
  }
  function mutation(ctx: Awaited<ReturnType<typeof account>>) {
    return { agent: ctx.agent, csrf: ctx.csrf };
  }

  it("isolates reproductive cycles, events and clutches by account", async () => {
    const owner = await account();
    const other = await account();
    const animal = await prisma.animal.create({ data: { userId: owner.userId, name: "Parent", species: "Python regius" } });
    const created = await owner.agent.post("/api/v1/reproduction-cycles")
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ name: "Pairing 2026", startedOn: "2026-10-01", status: "active", parentAAnimalId: animal.id })
      .expect(201);
    const cycleId = created.body.cycle.id as string;
    const event = await owner.agent.post(`/api/v1/reproduction-cycles/${cycleId}/events`)
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ eventType: "laying", occurredAt: "2026-10-28T09:00:00.000Z", animalId: animal.id })
      .expect(201);
    expect(event.body.event.eventType).toBe("laying");

    const clutch = await owner.agent.post("/api/v1/clutches")
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ cycleId, laidOn: "2026-10-28", eggCount: 2, incubatorLabel: "Incubator A" })
      .expect(201);
    const foreign = await other.agent.get(`/api/v1/reproduction-cycles/${cycleId}`).expect(404);
    expect(foreign.body.code).toBe("REPRODUCTION_CYCLE_NOT_FOUND");

    const eggs = await owner.agent.post(`/api/v1/clutches/${clutch.body.clutch.id}/eggs`)
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ eggs: [{ code: "E1" }, { code: "E2" }] })
      .expect(201);
    expect(eggs.body.createdCount).toBe(2);
    await owner.agent.post(`/api/v1/clutches/${clutch.body.clutch.id}/incubation-logs`)
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ recordedAt: "2026-10-28T10:00:00.000Z", temperatureC: 31.5, humidityPct: 80, eventType: "routine_check" })
      .expect(201);
    expect((await owner.agent.get(`/api/v1/clutches/${clutch.body.clutch.id}`).expect(200)).body.clutch.incubationLogs).toHaveLength(1);
  });

  it("locks stock rows and applies inbound, outbound and count-adjustment movements atomically", async () => {
    const owner = await account();
    const other = await account();
    const item = await owner.agent.post("/api/v1/inventory/items")
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ name: "Frozen mice", category: "food", unit: "pcs", quantityOnHand: 2, minimumQuantity: 1 })
      .expect(201);
    const itemId = item.body.item.id as string;
    const denied = await other.agent.get(`/api/v1/inventory/items/${itemId}`).expect(404);
    expect(denied.body.code).toBe("INVENTORY_ITEM_NOT_FOUND");

    await owner.agent.post(`/api/v1/inventory/items/${itemId}/movements`)
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ movementType: "out", quantity: 3, occurredAt: "2026-10-28T10:00:00.000Z" })
      .expect(409);
    const stillTwo = await owner.agent.get(`/api/v1/inventory/items/${itemId}`).expect(200);
    expect(Number(stillTwo.body.item.quantityOnHand)).toBe(2);

    const movement = await owner.agent.post(`/api/v1/inventory/items/${itemId}/movements`)
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ movementType: "out", quantity: 1.25, occurredAt: "2026-10-28T10:00:00.000Z" })
      .expect(201);
    expect(Number(movement.body.item.quantityOnHand)).toBe(0.75);
    const lowStock = await owner.agent.get("/api/v1/inventory/items?lowStock=true").expect(200);
    expect(lowStock.body.items.some((entry: { id: string }) => entry.id === itemId)).toBe(true);

    const adjustment = await owner.agent.post(`/api/v1/inventory/items/${itemId}/movements`)
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ movementType: "adjustment", quantity: 4.5, occurredAt: "2026-10-28T11:00:00.000Z", notes: "Physical count" })
      .expect(201);
    expect(Number(adjustment.body.item.quantityOnHand)).toBe(4.5);
  });

  it("stores private documents, exposes only allowlisted share fields, and revocation hides the public page", async () => {
    const owner = await account();
    const other = await account();
    const animal = await prisma.animal.create({
      data: { userId: owner.userId, name: "Private name", species: "Boa constrictor", morph: "Hypo", notes: "PRIVATE NOTES NEVER PUBLISH" },
    });
    const upload = await owner.agent.post("/api/v1/documents")
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .set("Content-Type", "application/pdf")
      .set("X-Document-Name", "records.pdf")
      .set("X-Document-Category", "CITES")
      .set("X-Animal-Id", animal.id)
      .send(pdf)
      .expect(201);
    const docId = upload.body.document.id as string;
    const docDownload = await other.agent.get(`/api/v1/documents/${docId}/download`).expect(404);
    expect(docDownload.body.code).toBe("DOCUMENT_NOT_FOUND");
    const downloaded = await owner.agent.get(`/api/v1/documents/${docId}/download`).expect(200);
    expect(downloaded.headers["content-type"]).toContain("application/pdf");
    expect(downloaded.body.length).toBe(pdf.length);

    const share = await owner.agent.post(`/api/v1/animals/${animal.id}/public-share`)
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ visibleFields: ["species", "morph"], publicDescription: "A public description", isEnabled: true })
      .expect(201);
    const publicPath = new URL(share.body.share.url).pathname;
    const publicPage = await request(app).get(publicPath).expect(200);
    expect(publicPage.body.animal).toEqual({ species: "Boa constrictor", morph: "Hypo" });
    expect(JSON.stringify(publicPage.body)).not.toContain("Private name");
    expect(JSON.stringify(publicPage.body)).not.toContain("PRIVATE NOTES");
    await owner.agent.patch(`/api/v1/public-shares/${share.body.share.id}`)
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ revoke: true })
      .expect(200);
    await request(app).get(publicPath).expect(404);
  });

  it("records finance in integer cents, reports summaries, and isolates in-app notifications/preferences", async () => {
    const owner = await account();
    const other = await account();
    const created = await owner.agent.post("/api/v1/finance/entries")
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ entryType: "expense", occurredOn: "2026-10-20", amountCents: 1299, currency: "eur", category: "food", description: "Rats for collection" })
      .expect(201);
    expect(created.body.entry.amountCents).toBe("1299");
    await owner.agent.post("/api/v1/finance/entries")
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ entryType: "income", occurredOn: "2026-10-21", amountCents: 2500, currency: "EUR", category: "sale", description: "Animal sale" })
      .expect(201);
    const summary = await owner.agent.get("/api/v1/finance/summary?from=2026-10-01&to=2026-10-31").expect(200);
    expect(summary.body.incomeCents).toBe("2500");
    expect(summary.body.expenseCents).toBe("1299");
    expect(summary.body.balanceCents).toBe("1201");
    const denied = await other.agent.patch(`/api/v1/finance/entries/${created.body.entry.id}`)
      .set("Origin", origin).set("X-CSRF-Token", other.csrf).send({ description: "hack" }).expect(404);
    expect(denied.body.code).toBe("FINANCE_ENTRY_NOT_FOUND");

    const notification = await prisma.notification.create({
      data: { userId: owner.userId, category: "billing", title: "Subscription update", body: "Subscription status updated" },
    });
    const notificationRead = await owner.agent.patch(`/api/v1/notifications/${notification.id}/read`)
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf).send({}).expect(200);
    expect(notificationRead.body.notification.readAt).toBeTruthy();
    await other.agent.patch(`/api/v1/notifications/${notification.id}/read`)
      .set("Origin", origin).set("X-CSRF-Token", other.csrf).send({}).expect(404);

    await owner.agent.post("/api/v1/push-subscriptions")
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ endpoint: `https://fcm.googleapis.com/wp/${randomUUID()}`, keys: { p256dh: "abcdefghijklmnop0123456789", auth: "abcdefghijklmnop" }, userAgent: "integration-test" })
      .expect(201);

    const unsupported = await owner.agent.post("/api/v1/push-subscriptions")
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({
        endpoint: "https://attacker.example.test/push",
        keys: { p256dh: "A".repeat(87), auth: "A".repeat(22) },
      })
      .expect(400);
    expect(unsupported.body.code).toBe("INVALID_PUSH_ENDPOINT");

    const prefs = await owner.agent.patch("/api/v1/notification-preferences")
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ pushEnabled: true, inAppEnabled: true, quietHoursStart: "22:00", quietHoursEnd: "07:00", categories: { billing: true } })
      .expect(200);
    expect(prefs.body.preferences.pushEnabled).toBe(true);
    expect(prefs.body.preferences.quietHoursStart).toBe("22:00");
  });

  it("matches care-import animal identifiers without regard to letter case", async () => {
    const owner = await account();
    const animal = await prisma.animal.create({
      data: { userId: owner.userId, name: "Case-insensitive import", identifier: "ROCCO-123", species: "Python regius" },
    });
    const csv = "animalIdentifier,measuredAt,weightG\nrocco-123,2026-10-20T12:00:00Z,420\n";
    const preview = await owner.agent.post("/api/v1/imports?entity=weights")
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .set("Content-Type", "text/csv").send(Buffer.from(csv, "utf8")).expect(201);

    expect(preview.body.validRows).toBe(1);
    expect(preview.body.invalidRows).toBe(0);

    await owner.agent.post("/api/v1/imports/" + preview.body.importId + "/confirm")
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf).send({}).expect(200);
    const measurement = await prisma.weightMeasurement.findFirstOrThrow({
      where: { animalId: animal.id, weightG: 420 },
    });
    expect(measurement.animalId).toBe(animal.id);
  });

  it("exports private data as a downloadable ZIP, controls document attachments, and reports unconfigured billing", async () => {
    const owner = await account();
    const animal = await prisma.animal.create({ data: { userId: owner.userId, name: "Export animal", species: "Python regius" } });
    const uploaded = await owner.agent.post("/api/v1/documents")
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .set("Content-Type", "application/pdf").set("X-Document-Name", "records.pdf")
      .set("X-Document-Category", "records").set("X-Animal-Id", animal.id)
      .send(pdf).expect(201);
    const documentPath = `documents/${uploaded.body.document.id}_records.pdf`;
    const getZip = async (path: string) => owner.agent.get(path).buffer(true).parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => callback(null, Buffer.concat(chunks)));
    }).expect(200);

    const noDocumentFiles = await owner.agent.post("/api/v1/exports")
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf).send({ includeDocuments: false }).expect(201);
    expect(noDocumentFiles.body.export.status).toBe("completed");
    const noDocZip = Buffer.from((await getZip(noDocumentFiles.body.downloadPath)).body as Buffer);
    expect(noDocZip.subarray(0, 2).toString("hex")).toBe("504b");
    expect(noDocZip.includes(Buffer.from("documents.csv"))).toBe(true);
    expect(noDocZip.includes(Buffer.from(documentPath))).toBe(false);

    const withDocumentFiles = await owner.agent.post("/api/v1/exports")
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf).send({ includeDocuments: true }).expect(201);
    const withDocZip = Buffer.from((await getZip(withDocumentFiles.body.downloadPath)).body as Buffer);
    expect(withDocZip.includes(Buffer.from("documents.csv"))).toBe(true);
    expect(withDocZip.includes(Buffer.from(documentPath))).toBe(true);

    const billing = await owner.agent.get("/api/v1/billing/subscription").expect(200);
    expect(billing.body.subscription).toBeNull();
    expect(billing.body.entitlements.paidSubscription).toBe(false);
    const noCredentials = await owner.agent.post("/api/v1/billing/checkout")
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf).send({}).expect(503);
    expect(noCredentials.body.code).toBe("BILLING_NOT_CONFIGURED");
  });
});
