import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { AppError } from "../../errors/app-error.js";
import { requireSession, type AuthContext } from "../auth/session.js";

const date = z.string().datetime({ offset: true });
export const waterChangeSchema = z.object({
  occurredAt: date, volumeLiters: z.coerce.number().positive().max(10000000),
  percentage: z.coerce.number().positive().max(100).nullable().optional(),
  waterSource: z.string().trim().max(120).nullable().optional(),
  conditioner: z.string().trim().max(160).nullable().optional(),
  temperatureC: z.coerce.number().min(-5).max(60).nullable().optional(),
  notes: z.string().trim().max(10000).nullable().optional(),
}).strict();
export const filterSchema = z.object({
  occurredAt: date, filterName: z.string().trim().min(1).max(160),
  action: z.enum(["cleaning","replacement","inspection","other"]),
  material: z.string().trim().max(160).nullable().optional(),
  materialChanged: z.boolean().default(false), nextDueAt: date.nullable().optional(),
  notes: z.string().trim().max(10000).nullable().optional(),
}).strict();
export const dosingSchema = z.object({
  occurredAt: date, productName: z.string().trim().min(1).max(160),
  productType: z.enum(["fertilizer","conditioner","mineral","bacteria","other"]),
  doseAmount: z.coerce.number().positive().max(100000000), doseUnit: z.string().trim().min(1).max(32),
  targetVolumeL: z.coerce.number().positive().max(10000000).nullable().optional(),
  reason: z.string().trim().max(240).nullable().optional(), notes: z.string().trim().max(10000).nullable().optional(),
}).strict();
export const populationMovementSchema = z.object({
  movementType: z.enum(["introduction","removal","transfer","mortality"]),
  speciesKey: z.string().trim().min(1).max(180),
  commonName: z.string().trim().max(160).nullable().optional(),
  scientificName: z.string().trim().max(180).nullable().optional(),
  quantity: z.coerce.number().int().positive().max(1000000),
  occurredAt: date, fromAquariumId: z.string().uuid().nullable().optional(),
  toAquariumId: z.string().uuid().nullable().optional(),
  reason: z.string().trim().max(240).nullable().optional(), notes: z.string().trim().max(10000).nullable().optional(),
}).strict();
export const quarantineSchema = z.object({
  speciesKey: z.string().trim().min(1).max(180), commonName: z.string().trim().max(160).nullable().optional(),
  scientificName: z.string().trim().max(180).nullable().optional(), quantity: z.coerce.number().int().positive().max(1000000),
  startedAt: date, endedAt: date.nullable().optional(), source: z.string().trim().max(180).nullable().optional(),
  status: z.enum(["quarantine","released","isolated","lost"]).default("quarantine"),
  observations: z.string().trim().max(10000).nullable().optional(),
}).strict().superRefine((v, ctx) => {
  if (v.endedAt && Date.parse(v.endedAt) < Date.parse(v.startedAt)) ctx.addIssue({ code: "custom", path: ["endedAt"], message: "End date cannot precede start date" });
});
export const quarantinePatchSchema = z.object({
  destinationAquariumId: z.string().uuid().optional(),
  status: z.enum(["quarantine","released","isolated","lost"]).optional(),
  endedAt: date.nullable().optional(),
  observations: z.string().trim().max(10000).nullable().optional(),
}).strict().refine(v => Object.keys(v).length > 0, "At least one field is required");
export const treatmentPatchSchema = z.object({
  endedAt: date.nullable().optional(),
  outcome: z.string().trim().max(10000).nullable().optional(),
}).strict().refine(v => Object.keys(v).length > 0, "At least one field is required");
export const treatmentSchema = z.object({
  startedAt: date, endedAt: date.nullable().optional(), treatmentType: z.enum(["medication","antiparasitic","other"]),
  productName: z.string().trim().min(1).max(160), activeIngredient: z.string().trim().max(160).nullable().optional(),
  doseAmount: z.coerce.number().positive().nullable().optional(), doseUnit: z.string().trim().max(32).nullable().optional(),
  targetSpecies: z.string().trim().max(180).nullable().optional(), instructions: z.string().trim().max(10000).nullable().optional(),
  outcome: z.string().trim().max(10000).nullable().optional(),
}).strict().superRefine((v, ctx) => {
  if (v.endedAt && Date.parse(v.endedAt) < Date.parse(v.startedAt)) ctx.addIssue({ code: "custom", path: ["endedAt"], message: "End date cannot precede start date" });
});
export const reproductionSchema = z.object({
  speciesKey: z.string().trim().min(1).max(180), commonName: z.string().trim().max(160).nullable().optional(),
  startedAt: date, spawnedAt: date.nullable().optional(), hatchedAt: date.nullable().optional(),
  eggsCount: z.coerce.number().int().min(0).max(1000000).nullable().optional(),
  hatchedCount: z.coerce.number().int().min(0).max(1000000).nullable().optional(),
  survivingCount: z.coerce.number().int().min(0).max(1000000).nullable().optional(),
  notes: z.string().trim().max(10000).nullable().optional(),
}).strict().superRefine((v, ctx) => {
  if (v.eggsCount != null && v.hatchedCount != null && v.hatchedCount > v.eggsCount) ctx.addIssue({ code: "custom", path: ["hatchedCount"], message: "Hatched count cannot exceed egg count" });
  if (v.hatchedCount != null && v.survivingCount != null && v.survivingCount > v.hatchedCount) ctx.addIssue({ code: "custom", path: ["survivingCount"], message: "Surviving count cannot exceed hatched count" });
});
export const compatibilitySchema = z.object({
  speciesAKey: z.string().trim().min(1).max(180), speciesBKey: z.string().trim().min(1).max(180),
  compatibility: z.enum(["compatible","caution","incompatible"]), notes: z.string().trim().max(10000).nullable().optional(),
}).strict().refine(v => v.speciesAKey.toLowerCase() !== v.speciesBKey.toLowerCase(), "Choose two different species");

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
async function requireFishCategory(userId: string) {
  const config = await prisma.accountConfiguration.findUnique({ where: { userId }, select: { animalCategories: true } });
  if (!config?.animalCategories.includes("fish")) throw new AppError(403, "ANIMAL_CATEGORY_NOT_ENABLED", "Fish category is not enabled");
}
async function ownedAquarium(userId: string, id: string) {
  const aquarium = await prisma.aquarium.findFirst({ where: { id, userId, archivedAt: null } });
  if (!aquarium) throw new AppError(404, "AQUARIUM_NOT_FOUND", "Aquarium not found");
  return aquarium;
}
const asDate = (value: string | null | undefined) => value ? new Date(value) : null;

export function createAquariumManagementRouter() {
  const router = Router();

  router.get("/aquariums/:id/management", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireFishCategory(auth.userId);
    const aquarium = await ownedAquarium(auth.userId, parseUuid(req.params.id));
    const [waterChanges, filterMaintenances, productDosages, populations, movements, quarantines, treatments, reproductions, compatibilityRules] = await Promise.all([
      prisma.aquariumWaterChange.findMany({ where: { aquariumId: aquarium.id }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 200 }),
      prisma.aquariumFilterMaintenance.findMany({ where: { aquariumId: aquarium.id }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 200 }),
      prisma.aquariumProductDosing.findMany({ where: { aquariumId: aquarium.id }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 200 }),
      prisma.aquariumPopulation.findMany({ where: { aquariumId: aquarium.id, quantity: { gt: 0 } }, orderBy: [{ commonName: "asc" }, { speciesKey: "asc" }] }),
      prisma.aquariumPopulationMovement.findMany({ where: { OR: [{ fromAquariumId: aquarium.id }, { toAquariumId: aquarium.id }] }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 300, include: { fromAquarium: { select: { id: true, name: true } }, toAquarium: { select: { id: true, name: true } } } }),
      prisma.aquariumQuarantine.findMany({ where: { aquariumId: aquarium.id }, orderBy: [{ startedAt: "desc" }, { id: "desc" }], take: 200 }),
      prisma.aquariumTreatment.findMany({ where: { aquariumId: aquarium.id }, orderBy: [{ startedAt: "desc" }, { id: "desc" }], take: 200 }),
      prisma.aquariumReproduction.findMany({ where: { aquariumId: aquarium.id }, orderBy: [{ startedAt: "desc" }, { id: "desc" }], take: 200 }),
      prisma.aquariumCompatibilityRule.findMany({ where: { userId: auth.userId }, orderBy: [{ speciesAKey: "asc" }, { speciesBKey: "asc" }] }),
    ]);
    res.status(200).json({ waterChanges, filterMaintenances, productDosages, populations, movements, quarantines, treatments, reproductions, compatibilityRules });
  });

  router.get("/aquariums/:id/water-change-calculator", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireFishCategory(auth.userId);
    const aquarium = await ownedAquarium(auth.userId, parseUuid(req.params.id));
    const percentage = z.coerce.number().gt(0).lte(100).safeParse(req.query.percentage);
    if (!percentage.success) throw new AppError(400, "INVALID_PERCENTAGE", "Percentage must be between 0 and 100");
    const liters = Number(aquarium.volumeLiters) * percentage.data / 100;
    res.status(200).json({ aquariumVolumeLiters: Number(aquarium.volumeLiters), percentage: percentage.data, waterToChangeLiters: Math.round(liters * 100) / 100 });
  });

  router.post("/aquariums/:id/water-changes", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext; await requireFishCategory(auth.userId);
    const aquarium = await ownedAquarium(auth.userId, parseUuid(req.params.id)); const v = parse(waterChangeSchema, req.body);
    const record = await prisma.aquariumWaterChange.create({ data: { aquariumId: aquarium.id, ...v, occurredAt: new Date(v.occurredAt) } });
    res.status(201).json({ waterChange: record });
  });
  router.post("/aquariums/:id/filter-maintenance", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext; await requireFishCategory(auth.userId);
    const aquarium = await ownedAquarium(auth.userId, parseUuid(req.params.id)); const v = parse(filterSchema, req.body);
    const record = await prisma.aquariumFilterMaintenance.create({ data: { aquariumId: aquarium.id, ...v, occurredAt: new Date(v.occurredAt), nextDueAt: asDate(v.nextDueAt) } });
    res.status(201).json({ maintenance: record });
  });
  router.post("/aquariums/:id/product-dosages", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext; await requireFishCategory(auth.userId);
    const aquarium = await ownedAquarium(auth.userId, parseUuid(req.params.id)); const v = parse(dosingSchema, req.body);
    const record = await prisma.aquariumProductDosing.create({ data: { aquariumId: aquarium.id, ...v, occurredAt: new Date(v.occurredAt), targetVolumeL: v.targetVolumeL ?? null } });
    res.status(201).json({ dosage: record });
  });
  router.post("/aquariums/:id/treatments", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext; await requireFishCategory(auth.userId);
    const aquarium = await ownedAquarium(auth.userId, parseUuid(req.params.id)); const v = parse(treatmentSchema, req.body);
    const record = await prisma.aquariumTreatment.create({ data: { aquariumId: aquarium.id, ...v, startedAt: new Date(v.startedAt), endedAt: asDate(v.endedAt), doseAmount: v.doseAmount ?? null } });
    res.status(201).json({ treatment: record });
  });
  router.post("/aquariums/:id/quarantines", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext; await requireFishCategory(auth.userId);
    const aquarium = await ownedAquarium(auth.userId, parseUuid(req.params.id)); const v = parse(quarantineSchema, req.body);
    const record = await prisma.aquariumQuarantine.create({ data: { aquariumId: aquarium.id, ...v, startedAt: new Date(v.startedAt), endedAt: asDate(v.endedAt) } });
    res.status(201).json({ quarantine: record });
  });
  router.patch("/quarantines/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext; await requireFishCategory(auth.userId);
    const id = parseUuid(req.params.id);
    const existing = await prisma.aquariumQuarantine.findFirst({ where: { id, aquarium: { is: { userId: auth.userId } } }, select: { id: true, aquariumId: true, speciesKey: true, commonName: true, scientificName: true, quantity: true, status: true } });
    if (!existing) throw new AppError(404, "AQUARIUM_QUARANTINE_NOT_FOUND", "Quarantine record not found");
    const v = parse(quarantinePatchSchema, req.body);
    if (v.status === "released" && existing.status !== "released") {
      if (!v.destinationAquariumId) throw new AppError(400, "QUARANTINE_DESTINATION_REQUIRED", "Choose the destination aquarium before releasing quarantined fish");
      const destination = await ownedAquarium(auth.userId, v.destinationAquariumId);
      const record = await prisma.$transaction(async tx => {
        const updated = await tx.aquariumQuarantine.update({ where: { id }, data: { ...v, endedAt: asDate(v.endedAt) ?? new Date() } });
        await tx.aquariumPopulation.upsert({
          where: { aquariumId_speciesKey: { aquariumId: destination.id, speciesKey: existing.speciesKey } },
          create: { aquariumId: destination.id, speciesKey: existing.speciesKey, commonName: existing.commonName, scientificName: existing.scientificName, quantity: existing.quantity },
          update: { quantity: { increment: existing.quantity } },
        });
        await tx.aquariumPopulationMovement.create({ data: {
          toAquariumId: destination.id, speciesKey: existing.speciesKey, commonName: existing.commonName,
          scientificName: existing.scientificName, movementType: "introduction", quantity: existing.quantity,
          occurredAt: asDate(v.endedAt) ?? new Date(), reason: "Released from quarantine",
          notes: "Quarantine record " + existing.id,
        } });
        return updated;
      });
      res.status(200).json({ quarantine: record });
      return;
    }
    const { destinationAquariumId: _destinationAquariumId, ...update } = v;
    const record = await prisma.aquariumQuarantine.update({ where: { id }, data: { ...update, ...(v.endedAt !== undefined ? { endedAt: asDate(v.endedAt) } : {}) } });
    res.status(200).json({ quarantine: record });
  });
  router.patch("/aquarium-treatments/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext; await requireFishCategory(auth.userId);
    const id = parseUuid(req.params.id);
    const existing = await prisma.aquariumTreatment.findFirst({ where: { id, aquarium: { is: { userId: auth.userId } } }, select: { id: true, startedAt: true } });
    if (!existing) throw new AppError(404, "AQUARIUM_TREATMENT_NOT_FOUND", "Treatment record not found");
    const v = parse(treatmentPatchSchema, req.body);
    if (v.endedAt && Date.parse(v.endedAt) < existing.startedAt.getTime()) throw new AppError(400, "INVALID_DATE_RANGE", "Treatment end date cannot precede start date");
    const record = await prisma.aquariumTreatment.update({ where: { id }, data: { ...v, ...(v.endedAt !== undefined ? { endedAt: asDate(v.endedAt) } : {}) } });
    res.status(200).json({ treatment: record });
  });

  router.post("/aquariums/:id/reproductions", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext; await requireFishCategory(auth.userId);
    const aquarium = await ownedAquarium(auth.userId, parseUuid(req.params.id)); const v = parse(reproductionSchema, req.body);
    const record = await prisma.aquariumReproduction.create({ data: { aquariumId: aquarium.id, ...v, startedAt: new Date(v.startedAt), spawnedAt: asDate(v.spawnedAt), hatchedAt: asDate(v.hatchedAt) } });
    res.status(201).json({ reproduction: record });
  });

  router.post("/aquariums/:id/population-movements", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext; await requireFishCategory(auth.userId);
    const currentId = parseUuid(req.params.id); await ownedAquarium(auth.userId, currentId);
    const v = parse(populationMovementSchema, req.body);
    const fromId = v.movementType === "introduction" ? null : (v.fromAquariumId ?? currentId);
    const toId = v.movementType === "transfer" ? v.toAquariumId : (v.movementType === "introduction" ? (v.toAquariumId ?? currentId) : null);
    if (v.movementType === "transfer" && (!fromId || !toId || fromId === toId)) throw new AppError(400, "INVALID_TRANSFER", "A transfer requires two different aquariums");
    if (v.movementType === "introduction" && !toId) throw new AppError(400, "INVALID_INTRODUCTION", "A destination aquarium is required");
    if ((v.movementType === "removal" || v.movementType === "mortality") && !fromId) throw new AppError(400, "INVALID_REMOVAL", "A source aquarium is required");
    const aquariumIds = [...new Set([fromId, toId].filter((id): id is string => Boolean(id)))];
    const owned = await prisma.aquarium.findMany({ where: { id: { in: aquariumIds }, userId: auth.userId, archivedAt: null }, select: { id: true } });
    if (owned.length !== aquariumIds.length) throw new AppError(404, "AQUARIUM_NOT_FOUND", "One or more aquariums were not found");
    const speciesKey = v.speciesKey.toLocaleLowerCase("en").trim();
    const record = await prisma.$transaction(async tx => {
      if (fromId) {
        const removed = await tx.aquariumPopulation.updateMany({ where: { aquariumId: fromId, speciesKey, quantity: { gte: v.quantity } }, data: { quantity: { decrement: v.quantity } } });
        if (!removed.count) throw new AppError(409, "INSUFFICIENT_POPULATION", "The source aquarium does not contain enough fish of this species");
      }
      if (toId) {
        await tx.aquariumPopulation.upsert({
          where: { aquariumId_speciesKey: { aquariumId: toId, speciesKey } },
          create: { aquariumId: toId, speciesKey, commonName: v.commonName ?? null, scientificName: v.scientificName ?? null, quantity: v.quantity },
          update: { quantity: { increment: v.quantity }, commonName: v.commonName ?? undefined, scientificName: v.scientificName ?? undefined },
        });
      }
      return tx.aquariumPopulationMovement.create({ data: {
        fromAquariumId: fromId, toAquariumId: toId, speciesKey,
        commonName: v.commonName ?? null, scientificName: v.scientificName ?? null,
        movementType: v.movementType, quantity: v.quantity, occurredAt: new Date(v.occurredAt),
        reason: v.reason ?? null, notes: v.notes ?? null,
      } });
    });
    res.status(201).json({ movement: record });
  });

  router.put("/aquariums/:id/compatibility-rules", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext; await requireFishCategory(auth.userId);
    await ownedAquarium(auth.userId, parseUuid(req.params.id));
    const v = parse(compatibilitySchema, req.body);
    const [speciesAKey, speciesBKey] = [v.speciesAKey.toLocaleLowerCase("en").trim(), v.speciesBKey.toLocaleLowerCase("en").trim()].sort();
    const rule = await prisma.aquariumCompatibilityRule.upsert({
      where: { userId_speciesAKey_speciesBKey: { userId: auth.userId, speciesAKey, speciesBKey } },
      create: { userId: auth.userId, speciesAKey, speciesBKey, compatibility: v.compatibility, notes: v.notes ?? null },
      update: { compatibility: v.compatibility, notes: v.notes ?? null },
    });
    res.status(200).json({ rule });
  });

  return router;
}
