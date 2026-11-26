import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";
import { requireSession, type AuthContext } from "../auth/session.js";

const date = z.string().datetime({ offset: true });
export const reptileFastingPeriodSchema = z.object({
  periodType: z.enum(["fasting", "refusal"]).default("fasting"),
  startedAt: date,
  endedAt: date.nullable().optional(),
  lastAcceptedMealAt: date.nullable().optional(),
  refusedMealsCount: z.coerce.number().int().min(0).max(10000).default(0),
  reason: z.string().trim().max(240).nullable().optional(),
  startWeightG: z.coerce.number().positive().max(10000000).nullable().optional(),
  endWeightG: z.coerce.number().positive().max(10000000).nullable().optional(),
  notes: z.string().trim().max(20000).nullable().optional(),
}).strict().superRefine((v, ctx) => {
  if (v.endedAt && Date.parse(v.endedAt) < Date.parse(v.startedAt)) ctx.addIssue({ code: "custom", path: ["endedAt"], message: "End date cannot precede start date" });
});
export const reptileBrumationPeriodSchema = z.object({
  startedAt: date,
  endedAt: date.nullable().optional(),
  startWeightG: z.coerce.number().positive().max(10000000).nullable().optional(),
  endWeightG: z.coerce.number().positive().max(10000000).nullable().optional(),
  temperatureC: z.coerce.number().min(-20).max(60).nullable().optional(),
  humidityPct: z.coerce.number().min(0).max(100).nullable().optional(),
  conditions: z.string().trim().max(10000).nullable().optional(),
  notes: z.string().trim().max(20000).nullable().optional(),
}).strict().superRefine((v, ctx) => {
  if (v.endedAt && v.endedAt < v.startedAt) ctx.addIssue({ code: "custom", path: ["endedAt"], message: "End date cannot precede start date" });
});
function idOf(value: string | string[] | undefined) {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id || !z.string().uuid().safeParse(id).success) throw new AppError(400, "INVALID_ID", "Invalid id");
  return id;
}
function bodyOf<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", {
    issues: result.error.issues.map(issue => ({ path: issue.path.map(String).join("."), message: issue.message })),
  });
  return result.data;
}
async function animal(userId: string, animalId: string, write = false) {
  const row = await prisma.animal.findFirst({ where: { id: animalId, userId }, select: { id: true, category: true, status: true, archivedAt: true } });
  if (!row) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
  if (row.category !== "reptiles") throw new AppError(400, "REPTILE_ONLY", "This register is available only for reptiles");
  if (write && (row.status !== "active" || row.archivedAt)) throw new AppError(409, "ANIMAL_NOT_ACTIVE", "Archived animals cannot be changed");
  return row;
}
export function createReptileCareRouter() {
  const router = Router();
  router.get("/animals/:animalId/reptile-care", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const animalId = idOf(req.params.animalId);
    await animal(auth.userId, animalId);
    const [fastingPeriods, brumationPeriods] = await Promise.all([
      prisma.reptileFastingPeriod.findMany({ where: { animalId }, orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }], take: 200 }),
      prisma.reptileBrumationPeriod.findMany({ where: { animalId }, orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }], take: 100 }),
    ]);
    res.status(200).json({ fastingPeriods, brumationPeriods });
  });
  router.post("/animals/:animalId/fasting-periods", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext, animalId = idOf(req.params.animalId);
    await animal(auth.userId, animalId, true);
    const input = bodyOf(reptileFastingPeriodSchema, req.body);
    const created = await prisma.reptileFastingPeriod.create({ data: {
      animalId, ...input, startedAt: new Date(input.startedAt),
      endedAt: input.endedAt ? new Date(input.endedAt) : null,
      lastAcceptedMealAt: input.lastAcceptedMealAt ? new Date(input.lastAcceptedMealAt) : null,
    } });
    await prisma.auditEvent.create({ data: { userId: auth.userId, action: "reptile_fasting.created", entityType: "reptile_fasting", entityId: created.id } });
    res.status(201).json({ period: created });
  });
  router.patch("/fasting-periods/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext, id = idOf(req.params.id);
    const existing = await prisma.reptileFastingPeriod.findFirst({ where: { id, animal: { is: { userId: auth.userId } } }, select: { id: true, animalId: true } });
    if (!existing) throw new AppError(404, "FASTING_PERIOD_NOT_FOUND", "Fasting period not found");
    await animal(auth.userId, existing.animalId, true);
    const input = bodyOf(fastingSchema, req.body);
    const updated = await prisma.reptileFastingPeriod.update({ where: { id }, data: {
      ...input, startedAt: new Date(input.startedAt), endedAt: input.endedAt ? new Date(input.endedAt) : null,
      lastAcceptedMealAt: input.lastAcceptedMealAt ? new Date(input.lastAcceptedMealAt) : null,
    } });
    res.status(200).json({ period: updated });
  });
  router.delete("/fasting-periods/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext, id = idOf(req.params.id);
    const existing = await prisma.reptileFastingPeriod.findFirst({ where: { id, animal: { is: { userId: auth.userId } } }, select: { id: true, animalId: true } });
    if (!existing) throw new AppError(404, "FASTING_PERIOD_NOT_FOUND", "Fasting period not found");
    await animal(auth.userId, existing.animalId, true);
    await prisma.reptileFastingPeriod.delete({ where: { id } });
    res.status(204).send();
  });
  router.post("/animals/:animalId/brumation-periods", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext, animalId = idOf(req.params.animalId);
    await animal(auth.userId, animalId, true);
    const input = bodyOf(reptileBrumationPeriodSchema, req.body);
    const created = await prisma.reptileBrumationPeriod.create({ data: {
      animalId, ...input, startedAt: new Date(input.startedAt), endedAt: input.endedAt ? new Date(input.endedAt) : null,
    } });
    await prisma.auditEvent.create({ data: { userId: auth.userId, action: "reptile_brumation.created", entityType: "reptile_brumation", entityId: created.id } });
    res.status(201).json({ period: created });
  });
  router.patch("/brumation-periods/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext, id = idOf(req.params.id);
    const existing = await prisma.reptileBrumationPeriod.findFirst({ where: { id, animal: { is: { userId: auth.userId } } }, select: { id: true, animalId: true } });
    if (!existing) throw new AppError(404, "BRUMATION_PERIOD_NOT_FOUND", "Brumation period not found");
    await animal(auth.userId, existing.animalId, true);
    const input = bodyOf(brumationSchema, req.body);
    const updated = await prisma.reptileBrumationPeriod.update({ where: { id }, data: {
      ...input, startedAt: new Date(input.startedAt), endedAt: input.endedAt ? new Date(input.endedAt) : null,
    } });
    res.status(200).json({ period: updated });
  });
  router.delete("/brumation-periods/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext, id = idOf(req.params.id);
    const existing = await prisma.reptileBrumationPeriod.findFirst({ where: { id, animal: { is: { userId: auth.userId } } }, select: { id: true, animalId: true } });
    if (!existing) throw new AppError(404, "BRUMATION_PERIOD_NOT_FOUND", "Brumation period not found");
    await animal(auth.userId, existing.animalId, true);
    await prisma.reptileBrumationPeriod.delete({ where: { id } });
    res.status(204).send();
  });
  return router;
}
