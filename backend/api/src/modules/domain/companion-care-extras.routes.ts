import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { AppError } from "../../errors/app-error.js";
import { requireSession, type AuthContext } from "../auth/session.js";

const uuid = z.string().uuid();
const dateTime = z.string().datetime({ offset: true });
const logSchema = z.object({
  animalId: uuid,
  kind: z.enum(["feeding", "behavior", "walk"]),
  occurredAt: dateTime,
  title: z.string().trim().min(1).max(160),
  foodType: z.string().trim().max(120).nullable().optional(),
  quantity: z.number().positive().max(100000).nullable().optional(),
  quantityUnit: z.enum(["g", "kg", "ml", "l", "portion"]).nullable().optional(),
  durationMinutes: z.number().int().min(1).max(1440).nullable().optional(),
  distanceKm: z.number().positive().max(500).nullable().optional(),
  mood: z.string().trim().max(40).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
}).superRefine((v, ctx) => {
  if (v.kind === "feeding" && (v.quantity == null || !v.quantityUnit)) ctx.addIssue({ code: "custom", path: ["quantity"], message: "Feeding logs require quantity and unit" });
  if (v.kind === "walk" && v.durationMinutes == null) ctx.addIssue({ code: "custom", path: ["durationMinutes"], message: "Walk logs require duration" });
});
const policySchema = z.object({
  animalId: uuid,
  kind: z.enum(["insurance", "document"]),
  title: z.string().trim().min(1).max(160),
  provider: z.string().trim().max(160).nullable().optional(),
  reference: z.string().trim().max(120).nullable().optional(),
  startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reminderDays: z.number().int().min(0).max(365).default(30),
  notes: z.string().max(5000).nullable().optional(),
});
function parse<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const result = schema.safeParse(body);
  if (!result.success) throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", { issues: result.error.issues });
  return result.data;
}
async function requireDogsCats(userId: string) {
  const config = await prisma.accountConfiguration.findUnique({ where: { userId }, select: { animalCategories: true } });
  if (!config?.animalCategories.includes("dogs_cats")) throw new AppError(403, "ANIMAL_CATEGORY_NOT_ENABLED", "Dogs and cats are not enabled for this account");
}
async function ownedAnimal(userId: string, animalId: string) {
  const animal = await prisma.animal.findFirst({ where: { id: animalId, userId, category: "dogs_cats", status: "active", archivedAt: null }, select: { id: true } });
  if (!animal) throw new AppError(404, "ANIMAL_NOT_FOUND", "Dog or cat not found");
}
function routeId(value: string | string[] | undefined) {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id || !uuid.safeParse(id).success) throw new AppError(400, "INVALID_ID", "Invalid id");
  return id;
}
export function createCompanionCareExtrasRouter() {
  const router = Router();
  router.get("/companion-care/logs", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireDogsCats(auth.userId);
    const animalId = req.query.animalId === undefined ? undefined : routeId(String(req.query.animalId));
    if (animalId) await ownedAnimal(auth.userId, animalId);
    const logs = await prisma.companionCareLog.findMany({ where: { userId: auth.userId, ...(animalId ? { animalId } : {}) }, include: { animal: { select: { id: true, name: true, species: true } } }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 200 });
    res.json({ logs });
  });
  router.post("/companion-care/logs", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireDogsCats(auth.userId);
    const input = parse(logSchema, req.body);
    await ownedAnimal(auth.userId, input.animalId);
    const log = await prisma.companionCareLog.create({ data: {
      ...input, userId: auth.userId, occurredAt: new Date(input.occurredAt),
      quantity: input.quantity ?? null, distanceKm: input.distanceKm ?? null,
      foodType: input.foodType ?? null, quantityUnit: input.quantityUnit ?? null,
      durationMinutes: input.durationMinutes ?? null, mood: input.mood ?? null, notes: input.notes ?? null,
    }, include: { animal: { select: { id: true, name: true, species: true } } } });
    res.status(201).json({ log });
  });
  router.delete("/companion-care/logs/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeId(req.params.id);
    const deleted = await prisma.companionCareLog.deleteMany({ where: { id, userId: auth.userId } });
    if (!deleted.count) throw new AppError(404, "COMPANION_LOG_NOT_FOUND", "Log not found");
    res.status(204).end();
  });
  router.get("/companion-care/policies", requireSession, async (_req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireDogsCats(auth.userId);
    const policies = await prisma.companionPolicy.findMany({ where: { userId: auth.userId }, include: { animal: { select: { id: true, name: true, species: true } } }, orderBy: [{ expiresAt: "asc" }, { createdAt: "desc" }], take: 200 });
    res.json({ policies });
  });
  router.post("/companion-care/policies", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireDogsCats(auth.userId);
    const input = parse(policySchema, req.body);
    await ownedAnimal(auth.userId, input.animalId);
    if (input.startsAt && input.startsAt > input.expiresAt) throw new AppError(400, "VALIDATION_ERROR", "Start date must not be after expiry");
    const policy = await prisma.$transaction(async tx => {
      const created = await tx.companionPolicy.create({ data: {
        userId: auth.userId, animalId: input.animalId, kind: input.kind, title: input.title,
        provider: input.provider ?? null, reference: input.reference ?? null,
        startsAt: input.startsAt ? new Date(input.startsAt + "T12:00:00.000Z") : null,
        expiresAt: new Date(input.expiresAt + "T12:00:00.000Z"),
        reminderDays: input.reminderDays, notes: input.notes ?? null,
      }, include: { animal: { select: { id: true, name: true, species: true } } } });
      const dueAt = new Date(created.expiresAt.getTime() - created.reminderDays * 86_400_000);
      const task = await tx.task.create({ data: { userId: auth.userId, animalId: created.animalId, title: "Scadenza: " + created.title, description: created.notes, category: "health", dueAt } });
      const linked = await tx.companionPolicy.update({ where: { id: created.id }, data: { taskId: task.id }, include: { animal: { select: { id: true, name: true, species: true } } } });
      return linked;
    });
    res.status(201).json({ policy });
  });
  router.patch("/companion-care/policies/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeId(req.params.id);
    const input = parse(policySchema.partial().extend({ animalId: uuid.optional() }), req.body);
    const existing = await prisma.companionPolicy.findFirst({ where: { id, userId: auth.userId } });
    if (!existing) throw new AppError(404, "COMPANION_POLICY_NOT_FOUND", "Policy not found");
    if (input.animalId) await ownedAnimal(auth.userId, input.animalId);
    const policy = await prisma.$transaction(async tx => {
      const updated = await tx.companionPolicy.update({ where: { id }, data: {
        ...input, ...(input.startsAt !== undefined ? { startsAt: input.startsAt ? new Date(input.startsAt + "T12:00:00.000Z") : null } : {}),
        ...(input.expiresAt ? { expiresAt: new Date(input.expiresAt + "T12:00:00.000Z") } : {}),
      }, include: { animal: { select: { id: true, name: true, species: true } } });
      const openTask = existing.taskId ? await tx.task.findFirst({ where: { id: existing.taskId, userId: auth.userId, status: "open" } }) : null;
      if (openTask) await tx.task.update({ where: { id: openTask.id }, data: {
        title: "Scadenza: " + updated.title, description: updated.notes,
        animalId: updated.animalId, dueAt: new Date(updated.expiresAt.getTime() - updated.reminderDays * 86_400_000),
      } });
      else if (!existing.taskId) { const task = await tx.task.create({ data: { userId: auth.userId, animalId: updated.animalId, title: "Scadenza: " + updated.title, description: updated.notes, category: "health", dueAt: new Date(updated.expiresAt.getTime() - updated.reminderDays * 86_400_000) } }); await tx.companionPolicy.update({ where: { id }, data: { taskId: task.id } }); }
      return updated;
    });
    res.json({ policy });
  });
  router.delete("/companion-care/policies/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeId(req.params.id);
    const existing = await prisma.companionPolicy.findFirst({ where: { id, userId: auth.userId } });
    if (!existing) throw new AppError(404, "COMPANION_POLICY_NOT_FOUND", "Policy not found");
    await prisma.$transaction(async tx => {
      if (existing.taskId) await tx.task.updateMany({ where: { id: existing.taskId, userId: auth.userId, status: "open" }, data: { status: "dismissed" } });
      await tx.companionPolicy.delete({ where: { id } });
    });
    res.status(204).end();
  });
  return router;
}
