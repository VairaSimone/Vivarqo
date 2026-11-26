import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { AppError } from "../../errors/app-error.js";
import { requireSession, type AuthContext } from "../auth/session.js";

const kinds = ["vaccination", "medication", "vet_visit", "parasite_prevention", "surgery", "grooming", "other"] as const;
const companionCareCreateSchema = z.object({
  animalId: z.string().uuid(), kind: z.enum(kinds), title: z.string().trim().min(1).max(160),
  occurredAt: z.string().datetime({ offset: true }),
  nextDueAt: z.string().datetime({ offset: true }).nullable().optional(),
  provider: z.string().trim().max(160).nullable().optional(),
  dosage: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
}).strict();
const companionCarePatchSchema = z.object({
  kind: z.enum(kinds).optional(), title: z.string().trim().min(1).max(160).optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  nextDueAt: z.string().datetime({ offset: true }).nullable().optional(),
  provider: z.string().trim().max(160).nullable().optional(),
  dosage: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");

function parseUuid(value: unknown): string {
  if (typeof value !== "string" || !z.string().uuid().safeParse(value).success) throw new AppError(400, "INVALID_ID", "Invalid id");
  return value;
}
function parse<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const result = schema.safeParse(body);
  if (!result.success) throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", { issues: result.error.issues });
  return result.data;
}
async function requireDogsCats(userId: string) {
  const config = await prisma.accountConfiguration.findUnique({ where: { userId }, select: { animalCategories: true } });
  if (!config?.animalCategories.includes("dogs_cats")) throw new AppError(403, "ANIMAL_CATEGORY_NOT_ENABLED", "Dogs and cats are not enabled for this account", { category: "dogs_cats", settingsPath: "/settings/categories" });
}
async function ownedAnimal(userId: string, animalId: string) {
  const animal = await prisma.animal.findFirst({ where: { id: animalId, userId, category: "dogs_cats" }, select: { id: true } });
  if (!animal) throw new AppError(404, "ANIMAL_NOT_FOUND", "Dog or cat not found");
}
async function ownedRecord(userId: string, id: string) {
  const record = await prisma.companionCareRecord.findFirst({ where: { id, userId, deletedAt: null }, select: { id: true } });
  if (!record) throw new AppError(404, "COMPANION_CARE_NOT_FOUND", "Care record not found");
}

export function createCompanionCareRouter() {
  const router = Router();
  router.get("/companion-care", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireDogsCats(auth.userId);
    const animalId = req.query.animalId === undefined ? undefined : parseUuid(req.query.animalId);
    if (animalId) await ownedAnimal(auth.userId, animalId);
    const upcomingOnly = req.query.upcomingOnly === "true";
    const records = await prisma.companionCareRecord.findMany({
      where: { userId: auth.userId, deletedAt: null, ...(animalId ? { animalId } : {}), ...(upcomingOnly ? { nextDueAt: { gte: new Date() } } : {}) },
      include: { animal: { select: { id: true, name: true, species: true } } },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 200,
    });
    res.status(200).json({ records });
  });
  router.post("/companion-care", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireDogsCats(auth.userId);
    const input = parse(companionCareCreateSchema, req.body);
    await ownedAnimal(auth.userId, input.animalId);
    const record = await prisma.companionCareRecord.create({
      data: { ...input, userId: auth.userId, occurredAt: new Date(input.occurredAt), nextDueAt: input.nextDueAt ? new Date(input.nextDueAt) : null },
      include: { animal: { select: { id: true, name: true, species: true } } },
    });
    res.status(201).json({ record });
  });
  router.patch("/companion-care/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireDogsCats(auth.userId);
    const id = parseUuid(req.params.id);
    await ownedRecord(auth.userId, id);
    const input = parse(companionCarePatchSchema, req.body);
    const record = await prisma.companionCareRecord.update({
      where: { id },
      data: { ...input, ...(input.occurredAt ? { occurredAt: new Date(input.occurredAt) } : {}), ...(input.nextDueAt !== undefined ? { nextDueAt: input.nextDueAt ? new Date(input.nextDueAt) : null } : {}) },
      include: { animal: { select: { id: true, name: true, species: true } } },
    });
    res.status(200).json({ record });
  });
  router.delete("/companion-care/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireDogsCats(auth.userId);
    const id = parseUuid(req.params.id);
    await ownedRecord(auth.userId, id);
    await prisma.companionCareRecord.update({ where: { id }, data: { deletedAt: new Date() } });
    res.status(200).json({ deleted: true });
  });
  return router;
}
