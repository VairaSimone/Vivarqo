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

const readingSchema = z.object({
  measuredAt: z.string().datetime({ offset: true }),
  temperatureC: z.coerce.number().min(-5).max(60).nullable().optional(),
  ph: z.coerce.number().min(0).max(14).nullable().optional(),
  ghDkh: z.coerce.number().min(0).max(100).nullable().optional(),
  khDkh: z.coerce.number().min(0).max(100).nullable().optional(),
  ammoniaMgL: z.coerce.number().min(0).max(1000).nullable().optional(),
  nitriteMgL: z.coerce.number().min(0).max(1000).nullable().optional(),
  nitrateMgL: z.coerce.number().min(0).max(10000).nullable().optional(),
  salinityPpt: z.coerce.number().min(0).max(100).nullable().optional(),
  tdsPpm: z.coerce.number().int().min(0).max(100000).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== "measuredAt" && value[key as keyof typeof value] != null), "At least one water parameter is required");

const aviarySchema = z.object({
  name: z.string().trim().min(1).max(120),
  environment: z.enum(["indoor", "outdoor", "mixed"]),
  location: z.string().trim().max(160).nullable().optional(),
  capacity: z.coerce.number().int().positive().max(100000).nullable().optional(),
  notes: z.string().trim().max(10000).nullable().optional(),
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

  router.get("/aquariums", requireSession, async (_req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireCategory(auth.userId, "fish");
    const aquariums = await prisma.aquarium.findMany({
      where: { userId: auth.userId, archivedAt: null },
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

  router.get("/aquariums/:id/readings", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireCategory(auth.userId, "fish");
    const aquarium = await ownedAquarium(auth.userId, parseUuid(req.params.id));
    const readings = await prisma.aquariumWaterReading.findMany({
      where: { aquariumId: aquarium.id },
      orderBy: { measuredAt: "desc" },
      take: 200,
    });
    res.status(200).json({ readings });
  });

  router.post("/aquariums/:id/readings", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireCategory(auth.userId, "fish");
    const aquarium = await ownedAquarium(auth.userId, parseUuid(req.params.id));
    const input = parse(readingSchema, req.body);
    const reading = await prisma.aquariumWaterReading.create({ data: { ...input, aquariumId: aquarium.id } });
    res.status(201).json({ reading });
  });

  router.get("/aviaries", requireSession, async (_req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireCategory(auth.userId, "birds");
    const aviaries = await prisma.aviary.findMany({
      where: { userId: auth.userId, archivedAt: null },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      include: { _count: { select: { birds: true } } },
    });
    res.status(200).json({ aviaries });
  });

  router.post("/aviaries", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireCategory(auth.userId, "birds");
    const input = parse(aviarySchema, req.body);
    const aviary = await prisma.aviary.create({ data: { ...input, userId: auth.userId } });
    res.status(201).json({ aviary });
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
      // A bird can belong to one aviary only. Reassigning it moves the record,
      // while the animal and its care history remain untouched.
      if (ids.length) await tx.aviaryBird.deleteMany({ where: { animalId: { in: ids } } });
      await tx.aviaryBird.deleteMany({ where: { aviaryId: aviary.id } });
      if (ids.length) await tx.aviaryBird.createMany({ data: ids.map((animalId) => ({ aviaryId: aviary.id, animalId })) });
    });
    res.status(200).json({ assignedCount: ids.length });
  });

  return router;
}
