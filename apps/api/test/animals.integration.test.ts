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

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(files: Array<{ name: string; data: string }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let localOffset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const data = Buffer.from(file.data, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    centrals.push(central, name);
    localOffset += local.length + name.length + data.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuffer, eocd]);
}

function makeXlsx(rows: string[][]): Buffer {
  const columnName = (column: number) => {
    let result = "";
    let value = column + 1;
    while (value > 0) {
      const remainder = (value - 1) % 26;
      result = String.fromCharCode(65 + remainder) + result;
      value = Math.floor((value - 1) / 26);
    }
    return result;
  };
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) =>
      `<c r="${columnName(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`,
    ).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return makeZip([
    {
      name: "xl/workbook.xml",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Animals" sheetId="1" r:id="rId1"/></sheets></workbook>',
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
    },
  ]);
}

describe.skipIf(!integrationEnabled)("Animals and care records PostgreSQL integration", () => {
  const userIds: string[] = [];
  const agents: Array<ReturnType<typeof request.agent>> = [];
  let app: Express;

  beforeAll(() => {
    app = createApp({ checkDatabase: async () => undefined });
  });

  afterAll(async () => {
    if (userIds.length) {
      const sessions = await prisma.feedingSession.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
      const sessionIds = sessions.map((session) => session.id);
      await prisma.feedingEntry.deleteMany({ where: { sessionId: { in: sessionIds } } });
      await prisma.feedingSession.deleteMany({ where: { userId: { in: userIds } } });
      const animals = await prisma.animal.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
      const animalIds = animals.map((animal) => animal.id);
      await prisma.weightMeasurement.deleteMany({ where: { animalId: { in: animalIds } } });
      await prisma.shedRecord.deleteMany({ where: { animalId: { in: animalIds } } });
      await prisma.animalNote.deleteMany({ where: { animalId: { in: animalIds } } });
      await prisma.importJob.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.auditEvent.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.animal.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  async function account() {
    const email = `animals-${randomUUID()}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 }),
        displayName: "Animal Integration",
        emailVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    const agent = request.agent(app);
    agents.push(agent);
    const csrf = (await agent.get("/api/v1/auth/csrf")).body.csrfToken as string;
    const login = await agent
      .post("/api/v1/auth/login")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrf)
      .send({ email, password });
    expect(login.status).toBe(200);
    return { userId: user.id, agent, csrf };
  }

  async function createAnimal(accountInfo: Awaited<ReturnType<typeof account>>, name: string, identifier = `id-${randomUUID()}`) {
    const result = await accountInfo.agent
      .post("/api/v1/animals")
      .set("Origin", origin)
      .set("X-CSRF-Token", accountInfo.csrf)
      .send({ name, species: "Python regius", identifier, sex: "female" });
    expect(result.status).toBe(201);
    return result.body.animal as { id: string; name: string; identifier: string };
  }

  it("creates, searches, filters, edits and archives animals without exposing other accounts", async () => {
    const owner = await account();
    const other = await account();
    const animal = await createAnimal(owner, "Nala", "NALA-1");
    const otherAnimal = await createAnimal(other, "Nala", "NALA-1");

    const search = await owner.agent.get("/api/v1/animals?q=NALA-1").expect(200);
    expect(search.body.animals.map((item: { id: string }) => item.id)).toContain(animal.id);
    expect(search.body.animals.map((item: { id: string }) => item.id)).not.toContain(otherAnimal.id);

    const hidden = await other.agent.get(`/api/v1/animals/${animal.id}`).expect(404);
    expect(hidden.body.code).toBe("ANIMAL_NOT_FOUND");

    const edited = await owner.agent
      .patch(`/api/v1/animals/${animal.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", owner.csrf)
      .send({ locationLabel: "Rack A" })
      .expect(200);
    expect(edited.body.animal.locationLabel).toBe("Rack A");

    await owner.agent
      .post(`/api/v1/animals/${animal.id}/archive`)
      .set("Origin", origin)
      .set("X-CSRF-Token", owner.csrf)
      .send({})
      .expect(200);
    const active = await owner.agent.get("/api/v1/animals").expect(200);
    expect(active.body.animals.some((item: { id: string }) => item.id === animal.id)).toBe(false);
    const archived = await owner.agent.get("/api/v1/animals?status=archived").expect(200);
    expect(archived.body.animals.some((item: { id: string }) => item.id === animal.id)).toBe(true);
  });

  it("enforces case-insensitive animal identifier uniqueness in PostgreSQL", async () => {
    const owner = await account();
    await createAnimal(owner, "Case original", "Nala-01");

    const duplicate = await owner.agent
      .post("/api/v1/animals")
      .set("Origin", origin)
      .set("X-CSRF-Token", owner.csrf)
      .send({ name: "Case duplicate", species: "Python regius", identifier: "nALA-01", sex: "female" })
      .expect(409);

    expect(duplicate.body.code).toBe("ANIMAL_IDENTIFIER_CONFLICT");
  });

  it("creates multiple animals atomically and rejects invalid or duplicated data", async () => {
    const owner = await account();
    const bulk = await owner.agent
      .post("/api/v1/animals/bulk")
      .set("Origin", origin)
      .set("X-CSRF-Token", owner.csrf)
      .send({
        animals: [
          { name: "Bulk one", species: "Boa constrictor", identifier: "BULK-1" },
          { name: "Bulk two", species: "Boa constrictor", identifier: "BULK-2", sex: "male" },
        ],
      })
      .expect(201);
    expect(bulk.body.createdCount).toBe(2);

    const invalid = await owner.agent
      .post("/api/v1/animals/bulk")
      .set("Origin", origin)
      .set("X-CSRF-Token", owner.csrf)
      .send({
        animals: [
          { name: "Valid", species: "Boa constrictor", identifier: "BULK-3" },
          { name: "", species: "Boa constrictor", identifier: "BULK-4" },
        ],
      })
      .expect(400);
    expect(invalid.body.code).toBe("VALIDATION_ERROR");

    const duplicate = await owner.agent
      .post("/api/v1/animals/bulk")
      .set("Origin", origin)
      .set("X-CSRF-Token", owner.csrf)
      .send({
        animals: [
          { name: "Duplicate 1", species: "Boa constrictor", identifier: "SAME" },
          { name: "Duplicate 2", species: "Boa constrictor", identifier: "SAME" },
        ],
      })
      .expect(400);
    expect(duplicate.body.code).toBe("DUPLICATE_IDENTIFIERS_IN_REQUEST");
  });

  it("imports CSV and XLSX through a private preview and explicit atomic confirmation", async () => {
    const owner = await account();
    const csv = Buffer.from([
      "Nome,Specie,Identificativo,Sesso,Data di nascita,Posizione",
      "CSV animal,Python regius,CSV-1,female,2024-03-01,Rack 1",
      "Invalid animal,,CSV-2,male,,Rack 2",
    ].join("\n"));
    const preview = await owner.agent
      .post("/api/v1/imports?entity=animals")
      .set("Origin", origin)
      .set("X-CSRF-Token", owner.csrf)
      .set("Content-Type", "text/csv")
      .send(csv)
      .expect(201);
    expect(preview.body.validRows).toBe(1);
    expect(preview.body.invalidRows).toBe(1);
    expect(preview.body.errors[0].row).toBe(3);

    const completed = await owner.agent
      .post(`/api/v1/imports/${preview.body.importId}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", owner.csrf)
      .send({})
      .expect(200);
    expect(completed.body.createdCount).toBe(1);
    expect(completed.body.errorCount).toBe(1);

    const xlsx = makeXlsx([
      ["name", "species", "identifier", "sex"],
      ["XLSX animal", "Boa constrictor", "XLSX-1", "male"],
    ]);
    const xlsxPreview = await owner.agent
      .post("/api/v1/imports?entity=animals")
      .set("Origin", origin)
      .set("X-CSRF-Token", owner.csrf)
      .set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .send(xlsx)
      .expect(201);
    expect(xlsxPreview.body.fileType).toBe("xlsx");
    expect(xlsxPreview.body.selectedSheet).toBe("Animals");
    expect(xlsxPreview.body.validRows).toBe(1);
    await owner.agent
      .post(`/api/v1/imports/${xlsxPreview.body.importId}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", owner.csrf)
      .send({})
      .expect(200);

    const tooManyColumns = makeXlsx([Array.from({ length: 257 }, (_, index) => index === 0 ? "name" : `col${index}`), Array(257).fill("value")]);
    const rejected = await owner.agent
      .post("/api/v1/imports?entity=animals")
      .set("Origin", origin)
      .set("X-CSRF-Token", owner.csrf)
      .set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .send(tooManyColumns)
      .expect(413);
    expect(rejected.body.code).toBe("IMPORT_TOO_MANY_COLUMNS");
  });

  it("commits bulk feedings in one transaction and forbids cross-account animals", async () => {
    const owner = await account();
    const other = await account();
    const first = await createAnimal(owner, "Feed one");
    const second = await createAnimal(owner, "Feed two");
    const foreign = await createAnimal(other, "Foreign");

    const session = await owner.agent
      .post("/api/v1/feeding-sessions")
      .set("Origin", origin)
      .set("X-CSRF-Token", owner.csrf)
      .send({
        performedAt: "2026-10-28T09:00:00.000Z",
        entries: [
          { animalId: first.id, outcome: "ate", foodType: "rat", foodWeightG: 120 },
          { animalId: second.id, outcome: "refused", foodType: "mouse" },
        ],
      })
      .expect(201);
    expect(session.body.createdCount).toBe(2);
    expect(session.body.session.entries.map((entry: { outcome: string }) => entry.outcome)).toEqual(["ate", "refused"]);

    const countBefore = await prisma.feedingSession.count({ where: { userId: owner.userId } });
    await owner.agent
      .post("/api/v1/feeding-sessions")
      .set("Origin", origin)
      .set("X-CSRF-Token", owner.csrf)
      .send({
        performedAt: "2026-10-28T10:00:00.000Z",
        entries: [
          { animalId: first.id, outcome: "ate" },
          { animalId: foreign.id, outcome: "ate" },
        ],
      })
      .expect(404);
    const countAfter = await prisma.feedingSession.count({ where: { userId: owner.userId } });
    expect(countAfter).toBe(countBefore);

    const otherHistory = await other.agent.get(`/api/v1/animals/${first.id}/history`).expect(404);
    expect(otherHistory.body.code).toBe("ANIMAL_NOT_FOUND");
  });

  it("validates weights, records care history, and isolates updates to record owners", async () => {
    const owner = await account();
    const other = await account();
    const animal = await createAnimal(owner, "Weight snake");
    const foreignAnimal = await createAnimal(other, "Other snake");

    const invalid = await owner.agent
      .post(`/api/v1/animals/${animal.id}/weights`)
      .set("Origin", origin)
      .set("X-CSRF-Token", owner.csrf)
      .send({ measuredAt: "2026-10-28T10:00:00.000Z", weightG: 0 })
      .expect(400);
    expect(invalid.body.code).toBe("VALIDATION_ERROR");

    const weight = await owner.agent
      .post(`/api/v1/animals/${animal.id}/weights`)
      .set("Origin", origin)
      .set("X-CSRF-Token", owner.csrf)
      .send({ measuredAt: "2026-10-28T10:00:00.000Z", weightG: 2580, notes: "Routine check" })
      .expect(201);

    const shed = await owner.agent
      .post(`/api/v1/animals/${animal.id}/sheds`)
      .set("Origin", origin)
      .set("X-CSRF-Token", owner.csrf)
      .send({ occurredAt: "2026-10-27T10:00:00.000Z", outcome: "partial", notes: "Tip of tail retained" })
      .expect(201);

    await owner.agent
      .post(`/api/v1/animals/${animal.id}/notes`)
      .set("Origin", origin)
      .set("X-CSRF-Token", owner.csrf)
      .send({ occurredAt: "2026-10-26T10:00:00.000Z", category: "observation", title: "Activity", body: "Normal activity" })
      .expect(201);

    const history = await owner.agent.get(`/api/v1/animals/${animal.id}/history`).expect(200);
    expect(history.body.items.map((item: { type: string }) => item.type)).toEqual(["weight", "shed", "note"]);

    const denied = await other.agent
      .patch(`/api/v1/weights/${weight.body.weight.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", other.csrf)
      .send({ weightG: 3000 })
      .expect(404);
    expect(denied.body.code).toBe("WEIGHT_NOT_FOUND");

    const foreignResponse = await other.agent.get(`/api/v1/animals/${animal.id}/weights`).expect(404);
    expect(foreignResponse.body.code).toBe("ANIMAL_NOT_FOUND");
    expect(foreignAnimal.id).not.toBe(animal.id);
    expect(shed.body.shed.outcome).toBe("partial");
  });

  it("refuses permanent deletion when the animal has dependent care history", async () => {
    const owner = await account();
    const animal = await createAnimal(owner, "History protected");
    await owner.agent
      .post(`/api/v1/animals/${animal.id}/weights`)
      .set("Origin", origin)
      .set("X-CSRF-Token", owner.csrf)
      .send({ measuredAt: "2026-10-28T10:00:00.000Z", weightG: 100 })
      .expect(201);
    const deletion = await owner.agent
      .delete(`/api/v1/animals/${animal.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", owner.csrf)
      .expect(409);
    expect(deletion.body.code).toBe("ANIMAL_HAS_HISTORY");
  });
});
