import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { AppError } from "../../errors/app-error.js";
import { requireSession, type AuthContext } from "../auth/session.js";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const parsed = new Date(value + "T00:00:00.000Z"); return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; }, "Invalid calendar date");
const profileSchema = z.object({
  ringType: z.enum(["none", "closed", "open", "microchip"]).optional(),
  ringNumber: z.string().trim().max(80).nullable().optional(),
  ringYear: z.number().int().min(1900).max(2200).nullable().optional(),
  citesNumber: z.string().trim().max(120).nullable().optional(),
  citesAnnex: z.string().trim().max(24).nullable().optional(),
  citesAuthority: z.string().trim().max(160).nullable().optional(),
  citesIssuedAt: dateOnly.nullable().optional(),
  citesExpiresAt: dateOnly.nullable().optional(),
  notes: z.string().trim().max(10000).nullable().optional(),
}).strict().refine(v => Object.keys(v).length > 0, "At least one field is required")
  .refine(v => !v.citesIssuedAt || !v.citesExpiresAt || v.citesExpiresAt >= v.citesIssuedAt, { path: ["citesExpiresAt"], message: "CITES expiry cannot precede issue date" })
  .refine(v => v.ringType !== "none" || !v.ringNumber, { path: ["ringNumber"], message: "A ring number requires an identification ring type" });
const pairSchema = z.object({
  femaleAnimalId: z.string().uuid(),
  maleAnimalId: z.string().uuid(),
  pairedAt: dateOnly,
  notes: z.string().trim().max(10000).nullable().optional(),
}).strict().refine(v => v.femaleAnimalId !== v.maleAnimalId, { path: ["maleAnimalId"], message: "The two birds must be different" });
const pairPatchSchema = z.object({
  status: z.enum(["active", "paused", "completed", "cancelled"]).optional(),
  separatedAt: dateOnly.nullable().optional(),
  notes: z.string().trim().max(10000).nullable().optional(),
}).strict().refine(v => Object.keys(v).length > 0, "At least one field is required");
const maintenanceSchema = z.object({
  occurredAt: z.string().datetime({ offset: true }),
  action: z.enum(["cleaning", "disinfection", "inspection", "repair", "other"]),
  area: z.string().trim().max(160).nullable().optional(),
  products: z.string().trim().max(240).nullable().optional(),
  nextDueAt: z.string().datetime({ offset: true }).nullable().optional(),
  notes: z.string().trim().max(10000).nullable().optional(),
}).strict().refine(v => !v.nextDueAt || !v.occurredAt || new Date(v.nextDueAt).getTime() >= new Date(v.occurredAt).getTime(), { path: ["nextDueAt"], message: "Next maintenance cannot precede this maintenance" });
const maintenancePatchSchema = z.object({
  occurredAt: z.string().datetime({ offset: true }).optional(),
  action: z.enum(["cleaning", "disinfection", "inspection", "repair", "other"]).optional(),
  area: z.string().trim().max(160).nullable().optional(),
  products: z.string().trim().max(240).nullable().optional(),
  nextDueAt: z.string().datetime({ offset: true }).nullable().optional(),
  notes: z.string().trim().max(10000).nullable().optional(),
}).strict().refine(v => Object.keys(v).length > 0, "At least one field is required");

function parse<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const result = schema.safeParse(body);
  if (!result.success) throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", { issues: result.error.issues });
  return result.data;
}
function parseUuid(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id || !z.string().uuid().safeParse(id).success) throw new AppError(400, "INVALID_ID", "Invalid id");
  return id;
}
function date(value: string | null | undefined): Date | null | undefined {
  return value === undefined ? undefined : value === null ? null : new Date(value + "T00:00:00.000Z");
}
async function requireBirds(userId: string) {
  const config = await prisma.accountConfiguration.findUnique({ where: { userId }, select: { animalCategories: true } });
  if (!config?.animalCategories.includes("birds")) throw new AppError(403, "ANIMAL_CATEGORY_NOT_ENABLED", "Birds are not enabled for this account", { category: "birds", settingsPath: "/settings/categories" });
}
async function ownedBird(userId: string, animalId: string) {
  const animal = await prisma.animal.findFirst({ where: { id: animalId, userId, category: "birds" }, select: { id: true, name: true, species: true, sex: true, status: true, archivedAt: true } });
  if (!animal) throw new AppError(404, "BIRD_NOT_FOUND", "Bird not found");
  return animal;
}
async function ownedAviary(userId: string, aviaryId: string) {
  const aviary = await prisma.aviary.findFirst({ where: { id: aviaryId, userId }, select: { id: true } });
  if (!aviary) throw new AppError(404, "AVIARY_NOT_FOUND", "Aviary not found");
  return aviary;
}

export function createBirdManagementRouter() {
  const router = Router();

  router.get("/birds/:animalId/profile", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireBirds(auth.userId);
    const animalId = parseUuid(req.params.animalId);
    await ownedBird(auth.userId, animalId);
    const profile = await prisma.birdProfile.findFirst({ where: { userId: auth.userId, animalId } });
    res.status(200).json({ profile });
  });

  router.put("/birds/:animalId/profile", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireBirds(auth.userId);
    const animalId = parseUuid(req.params.animalId);
    await ownedBird(auth.userId, animalId);
    const input = parse(profileSchema, req.body);
    const existing = await prisma.birdProfile.findFirst({ where: { userId: auth.userId, animalId } });
    const ringType = input.ringType ?? existing?.ringType ?? "none";
    const ringNumber = input.ringNumber !== undefined ? input.ringNumber : existing?.ringNumber ?? null;
    const citesIssuedAt = input.citesIssuedAt !== undefined ? input.citesIssuedAt : existing?.citesIssuedAt?.toISOString().slice(0, 10) ?? null;
    const citesExpiresAt = input.citesExpiresAt !== undefined ? input.citesExpiresAt : existing?.citesExpiresAt?.toISOString().slice(0, 10) ?? null;
    if (ringType === "none" && ringNumber) throw new AppError(400, "RING_TYPE_REQUIRED", "Choose a ring or microchip type for the identification number");
    if (citesIssuedAt && citesExpiresAt && citesExpiresAt < citesIssuedAt) throw new AppError(400, "INVALID_CITES_DATES", "CITES expiry cannot precede issue date");
    if (ringNumber && await prisma.birdProfile.findFirst({ where: { userId: auth.userId, animalId: { not: animalId }, ringNumber }, select: { id: true } })) {
      throw new AppError(409, "RING_NUMBER_ALREADY_USED", "This ring number is already assigned to another bird");
    }
    const citesNumber = input.citesNumber !== undefined ? input.citesNumber : existing?.citesNumber ?? null;
    if (citesNumber && await prisma.birdProfile.findFirst({ where: { userId: auth.userId, animalId: { not: animalId }, citesNumber }, select: { id: true } })) {
      throw new AppError(409, "CITES_NUMBER_ALREADY_USED", "This CITES number is already assigned to another bird");
    }
    const profile = await prisma.birdProfile.upsert({
      where: { animalId },
      create: {
        userId: auth.userId, animalId, ringType: input.ringType ?? "none",
        ringNumber: input.ringNumber ?? null, ringYear: input.ringYear ?? null,
        citesNumber: input.citesNumber ?? null, citesAnnex: input.citesAnnex ?? null,
        citesAuthority: input.citesAuthority ?? null, citesIssuedAt: date(input.citesIssuedAt) ?? null,
        citesExpiresAt: date(input.citesExpiresAt) ?? null, notes: input.notes ?? null,
      },
      update: {
        ...input,
        ...(input.citesIssuedAt !== undefined ? { citesIssuedAt: date(input.citesIssuedAt) } : {}),
        ...(input.citesExpiresAt !== undefined ? { citesExpiresAt: date(input.citesExpiresAt) } : {}),
      },
    });
    res.status(200).json({ profile });
  });

  router.get("/bird-breeding-pairs", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireBirds(auth.userId);
    const status = typeof req.query.status === "string" ? req.query.status : "all";
    if (!["all", "active", "paused", "completed", "cancelled"].includes(status)) throw new AppError(400, "VALIDATION_ERROR", "Invalid pair status");
    const pairs = await prisma.birdBreedingPair.findMany({
      where: { userId: auth.userId, ...(status === "all" ? {} : { status }) },
      include: {
        female: { select: { id: true, name: true, species: true, identifier: true } },
        male: { select: { id: true, name: true, species: true, identifier: true } },
        cycle: { select: { id: true, name: true, status: true, _count: { select: { clutches: true, offspringBatches: true } } } },
      },
      orderBy: [{ pairedAt: "desc" }, { id: "desc" }], take: 200,
    });
    res.status(200).json({ pairs });
  });

  router.post("/bird-breeding-pairs", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireBirds(auth.userId);
    const input = parse(pairSchema, req.body);
    const [female, male] = await Promise.all([ownedBird(auth.userId, input.femaleAnimalId), ownedBird(auth.userId, input.maleAnimalId)]);
    if (female.sex !== "female" || male.sex !== "male") throw new AppError(400, "INVALID_BIRD_PAIR_SEX", "Select a female bird and a male bird with matching recorded sexes");
    if (female.species.trim().toLocaleLowerCase() !== male.species.trim().toLocaleLowerCase()) throw new AppError(400, "BIRD_PAIR_SPECIES_MISMATCH", "Breeding pair members must have the same recorded species");
    if (female.status !== "active" || female.archivedAt || male.status !== "active" || male.archivedAt) throw new AppError(409, "BIRD_NOT_ACTIVE", "Archived or inactive birds cannot start a breeding pair");
    const existing = await prisma.birdBreedingPair.findFirst({ where: { userId: auth.userId, femaleAnimalId: female.id, maleAnimalId: male.id, status: "active" }, select: { id: true } });
    if (existing) throw new AppError(409, "BIRD_PAIR_ALREADY_ACTIVE", "This pair is already active");
    const pairedAt = new Date(input.pairedAt + "T00:00:00.000Z");
    const pair = await prisma.$transaction(async tx => {
      const cycle = await tx.reproductionCycle.create({ data: {
        userId: auth.userId, name: (female.name + " × " + male.name).slice(0, 160), startedOn: pairedAt,
        status: "active", parentAAnimalId: female.id, parentBAnimalId: male.id, notes: input.notes ?? null,
      } });
      return tx.birdBreedingPair.create({ data: {
        userId: auth.userId, femaleAnimalId: female.id, maleAnimalId: male.id, cycleId: cycle.id,
        pairedAt, status: "active", notes: input.notes ?? null,
      }, include: { female: { select: { id: true, name: true, species: true } }, male: { select: { id: true, name: true, species: true } }, cycle: true } });
    }, { isolationLevel: "Serializable" });
    res.status(201).json({ pair });
  });

  router.patch("/bird-breeding-pairs/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireBirds(auth.userId);
    const id = parseUuid(req.params.id);
    const input = parse(pairPatchSchema, req.body);
    const existing = await prisma.birdBreedingPair.findFirst({ where: { id, userId: auth.userId }, include: { cycle: { select: { id: true, startedOn: true, endedOn: true } } } });
    if (!existing) throw new AppError(404, "BIRD_PAIR_NOT_FOUND", "Breeding pair not found");
    const separatedAt = input.separatedAt === undefined ? undefined : date(input.separatedAt);
    if (separatedAt && separatedAt < existing.pairedAt) throw new AppError(400, "INVALID_PAIR_DATES", "Separation date cannot precede pairing date");
    const status = input.status ?? existing.status;
    const close = ["completed", "cancelled"].includes(status);
    const pair = await prisma.$transaction(async tx => {
      const updated = await tx.birdBreedingPair.update({ where: { id }, data: {
        ...input, ...(input.separatedAt !== undefined ? { separatedAt } : close && !existing.separatedAt ? { separatedAt: new Date() } : {}),
      } });
      if (close) await tx.reproductionCycle.update({ where: { id: existing.cycleId }, data: { status: status === "completed" ? "completed" : "cancelled", endedOn: separatedAt ?? new Date() } });
      else if (status === "active" || status === "paused") await tx.reproductionCycle.update({ where: { id: existing.cycleId }, data: { status: status === "active" ? "active" : "planned" } });
      return updated;
    });
    res.status(200).json({ pair });
  });

  router.get("/aviaries/:aviaryId/maintenance", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireBirds(auth.userId);
    const aviary = await ownedAviary(auth.userId, parseUuid(req.params.aviaryId));
    const records = await prisma.aviaryMaintenance.findMany({ where: { aviaryId: aviary.id }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 200 });
    res.status(200).json({ records });
  });

  router.post("/aviaries/:aviaryId/maintenance", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireBirds(auth.userId);
    const aviary = await ownedAviary(auth.userId, parseUuid(req.params.aviaryId));
    const input = parse(maintenanceSchema, req.body);
    const record = await prisma.aviaryMaintenance.create({ data: {
      aviaryId: aviary.id, ...input, occurredAt: new Date(input.occurredAt),
      nextDueAt: input.nextDueAt ? new Date(input.nextDueAt) : null,
    } });
    res.status(201).json({ record });
  });

  router.patch("/aviary-maintenance/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireBirds(auth.userId);
    const id = parseUuid(req.params.id);
    const input = parse(maintenancePatchSchema, req.body);
    const existing = await prisma.aviaryMaintenance.findFirst({ where: { id, aviary: { is: { userId: auth.userId } } }, select: { id: true, occurredAt: true } });
    if (!existing) throw new AppError(404, "AVIARY_MAINTENANCE_NOT_FOUND", "Maintenance record not found");
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : existing.occurredAt;
    const nextDueAt = input.nextDueAt === undefined ? undefined : input.nextDueAt ? new Date(input.nextDueAt) : null;
    if (nextDueAt && nextDueAt < occurredAt) throw new AppError(400, "INVALID_MAINTENANCE_DATES", "Next maintenance cannot precede the recorded maintenance");
    const record = await prisma.aviaryMaintenance.update({ where: { id }, data: {
      ...input, ...(input.occurredAt ? { occurredAt } : {}), ...(input.nextDueAt !== undefined ? { nextDueAt } : {}),
    } });
    res.status(200).json({ record });
  });

  router.delete("/aviary-maintenance/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireBirds(auth.userId);
    const id = parseUuid(req.params.id);
    const deleted = await prisma.aviaryMaintenance.deleteMany({ where: { id, aviary: { is: { userId: auth.userId } } } });
    if (!deleted.count) throw new AppError(404, "AVIARY_MAINTENANCE_NOT_FOUND", "Maintenance record not found");
    res.status(204).send();
  });

  return router;
}
