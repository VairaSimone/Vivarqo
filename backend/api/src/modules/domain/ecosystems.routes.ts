import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { AppError } from "../../errors/app-error.js";
import { requireSession, type AuthContext } from "../auth/session.js";

const aquariumSchema = z.object({
  name: z.string().trim().min(1).max(120),
  waterType: z.enum(["freshwater", "saltwater", "brackish"]),
  volumeLiters: z.coerce.number().positive().max(10_000_000),
  setupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  location: z.string().trim().max(160).nullable().optional(),
  notes: z.string().trim().max(10_000).nullable().optional(),
}).strict();

const aquariumPatchSchema = aquariumSchema.partial().strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");
const readingSchema = z.object({
  measuredAt: z.string().datetime({ offset: true }),
  temperatureC: z.union([z.null(), z.coerce.number().min(-5).max(60)]).optional(),
  ph: z.union([z.null(), z.coerce.number().min(0).max(14)]).optional(),
  ghDkh: z.union([z.null(), z.coerce.number().min(0).max(100)]).optional(),
  khDkh: z.union([z.null(), z.coerce.number().min(0).max(100)]).optional(),
  ammoniaMgL: z.union([z.null(), z.coerce.number().min(0).max(1000)]).optional(),
  nitriteMgL: z.union([z.null(), z.coerce.number().min(0).max(1000)]).optional(),
  nitrateMgL: z.union([z.null(), z.coerce.number().min(0).max(10000)]).optional(),
  salinityPpt: z.union([z.null(), z.coerce.number().min(0).max(100)]).optional(),
  tdsPpm: z.union([z.null(), z.coerce.number().int().min(0).max(100000)]).optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== "measuredAt" && value[key as keyof typeof value] != null), "At least one water parameter is required");

const readingPatchSchema = z.object({
  measuredAt: z.string().datetime({ offset: true }).optional(),
  temperatureC: z.union([z.null(), z.coerce.number().min(-5).max(60)]).optional(),
  ph: z.union([z.null(), z.coerce.number().min(0).max(14)]).optional(),
  ghDkh: z.union([z.null(), z.coerce.number().min(0).max(100)]).optional(),
  khDkh: z.union([z.null(), z.coerce.number().min(0).max(100)]).optional(),
  ammoniaMgL: z.union([z.null(), z.coerce.number().min(0).max(1000)]).optional(),
  nitriteMgL: z.union([z.null(), z.coerce.number().min(0).max(1000)]).optional(),
  nitrateMgL: z.union([z.null(), z.coerce.number().min(0).max(10000)]).optional(),
  salinityPpt: z.union([z.null(), z.coerce.number().min(0).max(100)]).optional(),
  tdsPpm: z.union([z.null(), z.coerce.number().int().min(0).max(100000)]).optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");
const aviarySchema = z.object({
  name: z.string().trim().min(1).max(120),
  environment: z.enum(["indoor", "outdoor", "mixed"]),
  location: z.string().trim().max(160).nullable().optional(),
  capacity: z.coerce.number().int().positive().max(100000).nullable().optional(),
  notes: z.string().trim().max(10000).nullable().optional(),
}).strict();

const aviaryPatchSchema = aviarySchema.partial().strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");
const aquariumRangeSchema = z.object({
  ranges: z.array(z.object({
    parameter: z.enum(["temperatureC", "ph", "ghDkh", "khDkh", "nitrateMgL"]),
    minValue: z.number().finite().nullable(),
    maxValue: z.number().finite().nullable(),
  }).strict().refine((item) => item.minValue !== null || item.maxValue !== null, "At least one bound is required")
    .refine((item) => item.minValue === null || item.maxValue === null || item.minValue <= item.maxValue, "Minimum cannot exceed maximum")).max(5),
}).strict();
const aviaryNoteSchema = z.object({
  title: z.string().trim().max(160).nullable().optional(),
  body: z.string().trim().min(1).max(10000),
  occurredAt: z.string().datetime({ offset: true }).optional(),
}).strict();
const aviaryBirdAssignmentSchema = z.object({
  animalIds: z.array(z.string().uuid()).max(500),
}).strict();

function parseUuid(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id || !z.string().uuid().safeParse(id).success) throw new AppError(400, "INVALID_ID", "Invalid id");
  return id;
}
function parse<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const result = schema.safeParse(body);
  if (!result.success) throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", { issues: result.error.issues });
  return result.data;
}
async function requireCategory(userId: string, category: "fish" | "birds") {
  const config = await prisma.accountConfiguration.findUnique({ where: { userId }, select: { animalCategories: true } });
  if (!config?.animalCategories.includes(category)) {
    throw new AppError(403, "ANIMAL_CATEGORY_NOT_ENABLED", "This category is not enabled for the account", { category, settingsPath: "/settings/categories" });
  }
}
async function ownedAquarium(userId: string, id: string) {
  const aquarium = await prisma.aquarium.findFirst({ where: { id, userId, archivedAt: null } });
  if (!aquarium) throw new AppError(404, "AQUARIUM_NOT_FOUND", "Aquarium not found");
  return aquarium;
}
async function ownedAviary(userId: string, id: string) {
  const aviary = await prisma.aviary.findFirst({ where: { id, userId, archivedAt: null } });
  if (!aviary) throw new AppError(404, "AVIARY_NOT_FOUND", "Aviary not found");
  return aviary;
}

export function createEcosystemRouter() {
  const router = Router();

  router.get("/aquariums", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireCategory(auth.userId, "fish");
    const aquariums = await prisma.aquarium.findMany({
      where: { userId: auth.userId, archivedAt: req.query.archived === "true" ? { not: null } : null },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      include: { _count: { select: { readings: true } }, readings: { orderBy: { measuredAt: "desc" }, take: 1 } },
    });
    res.status(200).json({ aquariums });
  });

  router.post("/aquariums", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireCategory(auth.userId, "fish");
    const input = parse(aquariumSchema, req.body);
    const aquarium = await prisma.aquarium.create({
      data: { ...input, userId: auth.userId, setupDate: input.setupDate ? new Date(input.setupDate + "T00:00:00.000Z") : null },
    });
    res.status(201).json({ aquarium });
  });

  router.patch("/aquariums/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireCategory(auth.userId, "fish");
    const id = parseUuid(req.params.id);
    await ownedAquarium(auth.userId, id);
    const input = parse(aquariumPatchSchema, req.body);
    const aquarium = await prisma.aquarium.update({
      where: { id },
      data: {
        ...input,
        ...(input.setupDate !== undefined ? { setupDate: input.setupDate ? new Date(input.setupDate + "T00:00:00.000Z") : null } : {}),
      },
    });
    res.status(200).json({ aquarium });
  });

  router.post("/aquariums/:id/restore", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireCategory(auth.userId, "fish");
    const id = parseUuid(req.params.id);
    const archived = await prisma.aquarium.findFirst({ where: { id, userId: auth.userId, archivedAt: { not: null } } });
    if (!archived) throw new AppError(404, "ARCHIVED_AQUARIUM_NOT_FOUND", "Archived aquarium not found");
    const aquarium = await prisma.aquarium.update({ where: { id }, data: { archivedAt: null } });
    res.status(200).json({ aquarium });
  });

  router.delete("/aquariums/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireCategory(auth.userId, "fish");
    const id = parseUuid(req.params.id);
    await ownedAquarium(auth.userId, id);
    await prisma.aquarium.update({ where: { id }, data: { archivedAt: new Date() } });
    res.status(204).send();
  });

  router.get("/aquariums/:id/readings", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireCategory(auth.userId, "fish");
    const aquarium = await ownedAquarium(auth.userId, parseUuid(req.params.id));
    const readings = await prisma.aquariumWaterReading.findMany({
      where: { aquariumId: aquarium.id },
      orderBy: [{ measuredAt: "desc" }, { id: "desc" }],
      take: Math.min(1000, Math.max(1, Number(req.query.take) || 200)),
      skip: Math.max(0, Math.min(100000, Number(req.query.skip) || 0)),
    });
    res.status(200).json({ readings });
  });

  router.get("/aquariums/:id/ranges", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireCategory(auth.userId, "fish");
    const aquarium = await ownedAquarium(auth.userId, parseUuid(req.params.id));
    const ranges = await prisma.aquariumParameterRange.findMany({ where: { aquariumId: aquarium.id }, orderBy: { parameter: "asc" } });
    res.status(200).json({ ranges });
  });

  router.put("/aquariums/:id/ranges", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireCategory(auth.userId, "fish");
    const aquarium = await ownedAquarium(auth.userId, parseUuid(req.params.id));
    const input = parse(aquariumRangeSchema, req.body);
    if (new Set(input.ranges.map((item) => item.parameter)).size !== input.ranges.length) {
      throw new AppError(400, "DUPLICATE_PARAMETER_RANGE", "Each parameter can have only one range");
    }
    const ranges = await prisma.$transaction(async (tx) => {
      for (const range of input.ranges) {
        await tx.aquariumParameterRange.upsert({
          where: { aquariumId_parameter: { aquariumId: aquarium.id, parameter: range.parameter } },
          create: { aquariumId: aquarium.id, ...range },
          update: { minValue: range.minValue, maxValue: range.maxValue },
        });
      }
      const keep = input.ranges.map((item) => item.parameter);
      await tx.aquariumParameterRange.deleteMany({ where: { aquariumId: aquarium.id, ...(keep.length ? { parameter: { notIn: keep } } : {}) } });
      return tx.aquariumParameterRange.findMany({ where: { aquariumId: aquarium.id }, orderBy: { parameter: "asc" } });
    });
    res.status(200).json({ ranges });
  });

  router.get("/aquariums/:id/export.csv", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireCategory(auth.userId, "fish");
    const aquarium = await ownedAquarium(auth.userId, parseUuid(req.params.id));
    const escapeCsv = (value: unknown) => {
      const raw = value === null || value === undefined ? "" : String(value);
      const safe = typeof value === "string" && /^[=+@\\-\\t\\r]/.test(raw) ? "'" + raw : raw;
      return '"' + safe.replace(/"/g, '""') + '"';
    };
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="aquarium-' + aquarium.id + '-readings.csv"');
    res.write("\uFEFF");
    res.write(["measuredAt","temperatureC","ph","ghDkh","khDkh","ammoniaMgL","nitriteMgL","nitrateMgL","salinityPpt","tdsPpm","notes"].join(";") + "\r\n");
    let cursor: string | undefined;
    while (true) {
      const batch = await prisma.aquariumWaterReading.findMany({
        where: { aquariumId: aquarium.id }, orderBy: [{ measuredAt: "asc" }, { id: "asc" }],
        take: 1000, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!batch.length) break;
      for (const row of batch) {
        res.write([row.measuredAt.toISOString(),row.temperatureC,row.ph,row.ghDkh,row.khDkh,row.ammoniaMgL,row.nitriteMgL,row.nitrateMgL,row.salinityPpt,row.tdsPpm,row.notes].map(escapeCsv).join(";") + "\r\n");
      }
      cursor = batch[batch.length - 1]!.id;
      if (batch.length < 1000) break;
    }
    res.end();
  });

  router.patch("/aquariums/:id/readings/:readingId", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireCategory(auth.userId, "fish");
    const aquarium = await ownedAquarium(auth.userId, parseUuid(req.params.id));
    const readingId = parseUuid(req.params.readingId);
    const existing = await prisma.aquariumWaterReading.findFirst({ where: { id: readingId, aquariumId: aquarium.id }, select: { id: true } });
    if (!existing) throw new AppError(404, "WATER_READING_NOT_FOUND", "Water reading not found");
    const input = parse(readingPatchSchema, req.body);
    const reading = await prisma.aquariumWaterReading.update({ where: { id: readingId }, data: {
      ...input, ...(input.measuredAt ? { measuredAt: new Date(input.measuredAt) } : {}),
    } });
    res.status(200).json({ reading });
  });

  router.delete("/aquariums/:id/readings/:readingId", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireCategory(auth.userId, "fish");
    const aquarium = await ownedAquarium(auth.userId, parseUuid(req.params.id));
    const readingId = parseUuid(req.params.readingId);
    const result = await prisma.aquariumWaterReading.deleteMany({ where: { id: readingId, aquariumId: aquarium.id } });
    if (!result.count) throw new AppError(404, "WATER_READING_NOT_FOUND", "Water reading not found");
    res.status(204).send();
  });

  router.post("/aquariums/:id/readings", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireCategory(auth.userId, "fish");
    const aquarium = await ownedAquarium(auth.userId, parseUuid(req.params.id));
    const input = parse(readingSchema, req.body);
    const reading = await prisma.aquariumWaterReading.create({ data: { ...input, aquariumId: aquarium.id } });
    res.status(201).json({ reading });
  });

  router.get("/aviaries", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireCategory(auth.userId, "birds");
    const aviaries = await prisma.aviary.findMany({
      where: { userId: auth.userId, archivedAt: req.query.archived === "true" ? { not: null } : null },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      include: { _count: { select: { birds: true } } },
    });
    res.status(200).json({ aviaries: aviaries.map((aviary) => ({
      ...aviary,
      capacityRemaining: aviary.capacity === null ? null : Math.max(0, aviary.capacity - aviary._count.birds),
    })) });
  });

  router.post("/aviaries", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireCategory(auth.userId, "birds");
    const input = parse(aviarySchema, req.body);
    const aviary = await prisma.aviary.create({ data: { ...input, userId: auth.userId } });
    res.status(201).json({ aviary });
  });

  router.patch("/aviaries/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireCategory(auth.userId, "birds");
    const id = parseUuid(req.params.id);
    const aviary = await ownedAviary(auth.userId, id);
    const input = parse(aviaryPatchSchema, req.body);
    const nextCapacity = input.capacity === undefined ? aviary.capacity : input.capacity;
    if (nextCapacity !== null) {
      const assigned = await prisma.aviaryBird.count({ where: { aviaryId: id } });
      if (assigned > nextCapacity) throw new AppError(409, "AVIARY_CAPACITY_BELOW_ASSIGNMENTS", "Capacity cannot be lower than the number of assigned birds", { assigned, capacity: nextCapacity });
    }
    const updated = await prisma.aviary.update({ where: { id }, data: input });
    res.status(200).json({ aviary: updated });
  });

  router.post("/aviaries/:id/restore", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireCategory(auth.userId, "birds");
    const id = parseUuid(req.params.id);
    const archived = await prisma.aviary.findFirst({ where: { id, userId: auth.userId, archivedAt: { not: null } }, include: { _count: { select: { birds: true } } } });
    if (!archived) throw new AppError(404, "ARCHIVED_AVIARY_NOT_FOUND", "Archived aviary not found");
    if (archived.capacity !== null && archived._count.birds > archived.capacity) {
      throw new AppError(409, "AVIARY_CAPACITY_BELOW_ASSIGNMENTS", "Archived aviary assignments exceed its capacity", { assigned: archived._count.birds, capacity: archived.capacity });
    }
    const aviary = await prisma.aviary.update({ where: { id }, data: { archivedAt: null } });
    res.status(200).json({ aviary });
  });

  router.delete("/aviaries/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireCategory(auth.userId, "birds");
    const id = parseUuid(req.params.id);
    await ownedAviary(auth.userId, id);
    // Keep bird assignments attached to the archived aviary. They are historical
    // placement data and become active again if the aviary is restored.
    await prisma.aviary.update({ where: { id }, data: { archivedAt: new Date() } });
    res.status(204).send();
  });

  router.get("/aviaries/:id/birds", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireCategory(auth.userId, "birds");
    const aviary = await ownedAviary(auth.userId, parseUuid(req.params.id));
    const birds = await prisma.animal.findMany({
      where: { userId: auth.userId, category: "birds", aviaryAssignments: { some: { aviaryId: aviary.id } } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    res.status(200).json({ birds });
  });

  router.get("/aviaries/:id/history", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireCategory(auth.userId, "birds");
    const aviary = await prisma.aviary.findFirst({ where: { id: parseUuid(req.params.id), userId: auth.userId } });
    if (!aviary) throw new AppError(404, "AVIARY_NOT_FOUND", "Aviary not found");
    const [movements, notes] = await Promise.all([
      prisma.aviaryMovement.findMany({
        where: { OR: [{ fromAviaryId: aviary.id }, { toAviaryId: aviary.id }] },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 200,
        include: { animal: { select: { id: true, name: true, species: true } }, fromAviary: { select: { id: true, name: true } }, toAviary: { select: { id: true, name: true } } },
      }),
      prisma.aviaryNote.findMany({ where: { aviaryId: aviary.id }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 100 }),
    ]);
    res.status(200).json({ movements, notes });
  });

  router.post("/aviaries/:id/notes", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireCategory(auth.userId, "birds");
    const aviary = await prisma.aviary.findFirst({ where: { id: parseUuid(req.params.id), userId: auth.userId } });
    if (!aviary) throw new AppError(404, "AVIARY_NOT_FOUND", "Aviary not found");
    const input = parse(aviaryNoteSchema, req.body);
    const note = await prisma.aviaryNote.create({ data: { aviaryId: aviary.id, ...input, ...(input.occurredAt ? { occurredAt: new Date(input.occurredAt) } : {}) } });
    res.status(201).json({ note });
  });

  router.delete("/aviaries/:id/notes/:noteId", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireCategory(auth.userId, "birds");
    const aviary = await prisma.aviary.findFirst({ where: { id: parseUuid(req.params.id), userId: auth.userId }, select: { id: true } });
    if (!aviary) throw new AppError(404, "AVIARY_NOT_FOUND", "Aviary not found");
    const noteId = parseUuid(req.params.noteId);
    const deleted = await prisma.aviaryNote.deleteMany({ where: { id: noteId, aviaryId: aviary.id } });
    if (!deleted.count) throw new AppError(404, "AVIARY_NOTE_NOT_FOUND", "Aviary note not found");
    res.status(204).send();
  });

  router.put("/aviaries/:id/birds", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireCategory(auth.userId, "birds");
    const aviary = await ownedAviary(auth.userId, parseUuid(req.params.id));
    const input = aviaryBirdAssignmentSchema.safeParse(req.body);
    if (!input.success) throw new AppError(400, "VALIDATION_ERROR", "Provide a list of bird ids", { issues: input.error.issues });
    if (new Set(input.data.animalIds).size !== input.data.animalIds.length) {
      throw new AppError(400, "VALIDATION_ERROR", "Bird ids must be unique");
    }
    const ids = input.data.animalIds;
    if (aviary.capacity !== null && ids.length > aviary.capacity) {
      throw new AppError(409, "AVIARY_CAPACITY_EXCEEDED", "The selected birds exceed the aviary capacity", { capacity: aviary.capacity, requested: ids.length });
    }
    const birds = await prisma.animal.findMany({ where: { id: { in: ids }, userId: auth.userId, category: "birds" }, select: { id: true } });
    if (birds.length !== ids.length) throw new AppError(400, "INVALID_BIRD", "One or more selected records are not birds in this account");
    await prisma.$transaction(async (tx) => {
      const current = await tx.aviaryBird.findMany({ where: { OR: [{ aviaryId: aviary.id }, ...(ids.length ? [{ animalId: { in: ids } }] : [])] }, select: { animalId: true, aviaryId: true } });
      const currentByAnimal = new Map(current.map((item) => [item.animalId, item.aviaryId]));
      const targetByAnimal = new Map(ids.map((animalId) => [animalId, aviary.id]));
      const changed = new Set([...currentByAnimal.keys(), ...targetByAnimal.keys()]);
      const movements = [...changed].flatMap((animalId) => {
        const fromAviaryId = currentByAnimal.get(animalId) ?? null;
        const toAviaryId = targetByAnimal.get(animalId) ?? null;
        return fromAviaryId === toAviaryId ? [] : [{ animalId, fromAviaryId, toAviaryId }];
      });
      if (movements.length) await tx.aviaryMovement.createMany({ data: movements });
      if (ids.length) await tx.aviaryBird.deleteMany({ where: { animalId: { in: ids } } });
      await tx.aviaryBird.deleteMany({ where: { aviaryId: aviary.id } });
      if (ids.length) await tx.aviaryBird.createMany({ data: ids.map((animalId) => ({ aviaryId: aviary.id, animalId })) });
    });
    res.status(200).json({ assignedCount: ids.length });
  });

  return router;
}
