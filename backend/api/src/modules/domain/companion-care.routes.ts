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
  recurrenceIntervalDays: z.number().int().min(1).max(3650).nullable().optional(),
  provider: z.string().trim().max(160).nullable().optional(),
  clinic: z.string().trim().max(160).nullable().optional(),
  treatmentStartAt: z.string().datetime({ offset: true }).nullable().optional(),
  treatmentEndAt: z.string().datetime({ offset: true }).nullable().optional(),
  isOngoing: z.boolean().optional(),
  dosage: z.string().trim().max(120).nullable().optional(),
  frequency: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
}).strict().refine((value) => !value.recurrenceIntervalDays || Boolean(value.nextDueAt), { path: ["nextDueAt"], message: "A recurring reminder requires a next due date" }).refine((value) => !value.recurrenceIntervalDays || ["vaccination", "parasite_prevention"].includes(value.kind), { path: ["recurrenceIntervalDays"], message: "Only vaccinations and parasite prevention can use this recurring schedule" }).refine((value) => !value.treatmentStartAt || !value.treatmentEndAt || new Date(value.treatmentEndAt).getTime() >= new Date(value.treatmentStartAt).getTime(), { path: ["treatmentEndAt"], message: "Therapy end must not precede its start" }).refine((value) => !value.isOngoing || (value.kind === "medication" && !value.treatmentEndAt), { path: ["isOngoing"], message: "Only medication records without an end date can be ongoing therapies" });
const companionCarePatchSchema = z.object({
  kind: z.enum(kinds).optional(), title: z.string().trim().min(1).max(160).optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  nextDueAt: z.string().datetime({ offset: true }).nullable().optional(),
  recurrenceIntervalDays: z.number().int().min(1).max(3650).nullable().optional(),
  provider: z.string().trim().max(160).nullable().optional(),
  clinic: z.string().trim().max(160).nullable().optional(),
  treatmentStartAt: z.string().datetime({ offset: true }).nullable().optional(),
  treatmentEndAt: z.string().datetime({ offset: true }).nullable().optional(),
  isOngoing: z.boolean().optional(),
  dosage: z.string().trim().max(120).nullable().optional(),
  frequency: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
}).strict()
  .refine((value) => !value.treatmentStartAt || !value.treatmentEndAt || new Date(value.treatmentEndAt).getTime() >= new Date(value.treatmentStartAt).getTime(), { path: ["treatmentEndAt"], message: "Therapy end must not precede its start" })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

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
    const now = new Date();
    const status = typeof req.query.status === "string" ? req.query.status : "all";
    if (!["all", "overdue", "imminent", "future", "upcoming", "completed"].includes(status)) throw new AppError(400, "VALIDATION_ERROR", "Invalid care due status");
    const imminentLimit = new Date(now.getTime() + 7 * 86_400_000);
    const dueFilter = status === "overdue" ? { completedAt: null, nextDueAt: { not: null, lt: now } }
      : status === "imminent" ? { completedAt: null, nextDueAt: { gte: now, lte: imminentLimit } }
      : status === "future" ? { completedAt: null, nextDueAt: { gt: imminentLimit } }
      : status === "upcoming" ? { completedAt: null, nextDueAt: { gte: now } }
      : status === "completed" ? { completedAt: { not: null } } : {};
    const upcomingOnly = req.query.upcomingOnly === "true";
    const records = await prisma.companionCareRecord.findMany({
      where: { userId: auth.userId, deletedAt: null, ...(animalId ? { animalId } : {}), ...dueFilter,
        ...(upcomingOnly ? { completedAt: null, nextDueAt: { gte: now } } : {}) },
      include: { animal: { select: { id: true, name: true, species: true } }, task: { select: { id: true, status: true } }, reminderRule: { select: { id: true, intervalDays: true, isEnabled: true } } },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 200,
    });
    res.status(200).json({ records: records.map((record) => ({ ...record, recurrenceIntervalDays: record.reminderRule?.intervalDays ?? null, dueStatus: record.completedAt ? "completed" : !record.nextDueAt ? "none" : record.nextDueAt < now ? "overdue" : record.nextDueAt.getTime() <= now.getTime() + 7 * 86_400_000 ? "imminent" : "future" })) });
  });
  router.post("/companion-care", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireDogsCats(auth.userId);
    const input = parse(companionCareCreateSchema, req.body);
    await ownedAnimal(auth.userId, input.animalId);
    const record = await prisma.$transaction(async (tx) => {
      const { recurrenceIntervalDays, ...careInput } = input;
      const created = await tx.companionCareRecord.create({
        data: { ...careInput, userId: auth.userId, occurredAt: new Date(input.occurredAt), nextDueAt: input.nextDueAt ? new Date(input.nextDueAt) : null, treatmentStartAt: input.treatmentStartAt ? new Date(input.treatmentStartAt) : null, treatmentEndAt: input.treatmentEndAt ? new Date(input.treatmentEndAt) : null },
        include: { animal: { select: { id: true, name: true, species: true } } },
      });
      let reminderRuleId: string | null = null;
      if (recurrenceIntervalDays && created.nextDueAt) {
        const rule = await tx.reminderRule.create({ data: {
          userId: auth.userId, animalId: created.animalId, title: created.title,
          description: created.notes, category: "health", intervalDays: recurrenceIntervalDays,
          nextDueAt: created.nextDueAt, isEnabled: true,
        } });
        reminderRuleId = rule.id;
        await tx.companionCareRecord.update({ where: { id: created.id }, data: { reminderRuleId } });
      }
      if (created.nextDueAt) {
        await tx.task.create({ data: {
          userId: auth.userId, animalId: created.animalId, title: created.title,
          description: created.notes, category: "health", dueAt: created.nextDueAt,
          companionCareRecordId: created.id, ...(reminderRuleId ? { reminderRuleId } : {}),
        } });
      }
      return { ...created, reminderRuleId };
    });
    res.status(201).json({ record });
  });
  router.patch("/companion-care/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireDogsCats(auth.userId);
    const id = parseUuid(req.params.id);
    await ownedRecord(auth.userId, id);
    const input = parse(companionCarePatchSchema, req.body);
    const record = await prisma.$transaction(async (tx) => {
      const previous = await tx.companionCareRecord.findFirst({
        where: { id, userId: auth.userId, deletedAt: null },
        select: { nextDueAt: true, completedAt: true, kind: true, isOngoing: true, treatmentStartAt: true, treatmentEndAt: true, reminderRuleId: true },
      });
      if (!previous) throw new AppError(404, "COMPANION_CARE_NOT_FOUND", "Care record not found");
      const resultingKind = input.kind ?? previous.kind;
      const resultingOngoing = input.isOngoing ?? previous.isOngoing;
      const resultingStartAt = input.treatmentStartAt === undefined ? previous.treatmentStartAt : input.treatmentStartAt ? new Date(input.treatmentStartAt) : null;
      const resultingEndAt = input.treatmentEndAt === undefined ? previous.treatmentEndAt : input.treatmentEndAt ? new Date(input.treatmentEndAt) : null;
      if (resultingStartAt && resultingEndAt && resultingEndAt.getTime() < resultingStartAt.getTime()) {
        throw new AppError(400, "VALIDATION_ERROR", "Therapy end must not precede its start");
      }
      if (resultingOngoing && (resultingKind !== "medication" || resultingEndAt !== null)) {
        throw new AppError(400, "VALIDATION_ERROR", "Only medication records without an end date can be ongoing therapies");
      }
      const requestedDueAt = input.nextDueAt === undefined ? undefined : input.nextDueAt ? new Date(input.nextDueAt) : null;
      const dueDateChanged = requestedDueAt !== undefined
        && (requestedDueAt?.getTime() ?? null) !== (previous.nextDueAt?.getTime() ?? null);
      const { recurrenceIntervalDays, ...careInput } = input;
      const updated = await tx.companionCareRecord.update({
        where: { id },
        data: { ...careInput, ...(input.occurredAt ? { occurredAt: new Date(input.occurredAt) } : {}), ...(input.treatmentStartAt !== undefined ? { treatmentStartAt: input.treatmentStartAt ? new Date(input.treatmentStartAt) : null } : {}), ...(input.treatmentEndAt !== undefined ? { treatmentEndAt: input.treatmentEndAt ? new Date(input.treatmentEndAt) : null } : {}),
          ...(requestedDueAt !== undefined ? { nextDueAt: requestedDueAt, ...(dueDateChanged ? { completedAt: null } : {}) } : {}) },
        include: { animal: { select: { id: true, name: true, species: true } } },
      });
      let reminderRuleId = previous.reminderRuleId;
      if (recurrenceIntervalDays !== undefined) {
        if (recurrenceIntervalDays === null) {
          if (reminderRuleId) {
            await tx.task.updateMany({ where: { reminderRuleId, status: "open" }, data: { status: "dismissed" } });
            await tx.reminderRule.update({ where: { id: reminderRuleId }, data: { isEnabled: false } });
          }
          reminderRuleId = null;
        } else {
          if (!updated.nextDueAt) throw new AppError(400, "VALIDATION_ERROR", "A recurring reminder requires a next due date");
          if (!["vaccination", "parasite_prevention"].includes(updated.kind)) throw new AppError(400, "VALIDATION_ERROR", "Only vaccinations and parasite prevention can use this recurring schedule");
          const ruleData = { title: updated.title, description: updated.notes, category: "health", intervalDays: recurrenceIntervalDays, nextDueAt: updated.nextDueAt, animalId: updated.animalId, isEnabled: true };
          if (reminderRuleId) await tx.reminderRule.update({ where: { id: reminderRuleId }, data: ruleData });
          else reminderRuleId = (await tx.reminderRule.create({ data: { ...ruleData, userId: auth.userId } })).id;
        }
        await tx.companionCareRecord.update({ where: { id }, data: { reminderRuleId } });
      } else if (reminderRuleId && !updated.nextDueAt) {
        await tx.task.updateMany({ where: { reminderRuleId, status: "open" }, data: { status: "dismissed" } });
        await tx.reminderRule.update({ where: { id: reminderRuleId }, data: { isEnabled: false } });
        reminderRuleId = null;
        await tx.companionCareRecord.update({ where: { id }, data: { reminderRuleId: null } });
      } else if (reminderRuleId) {
        await tx.reminderRule.update({ where: { id: reminderRuleId }, data: { title: updated.title, description: updated.notes, nextDueAt: updated.nextDueAt!, animalId: updated.animalId } });
      }
      const dueTask = await tx.task.findFirst({ where: { companionCareRecordId: id } });
      if (!updated.nextDueAt) {
        if (dueTask?.status === "open") await tx.task.update({ where: { id: dueTask.id }, data: { status: "dismissed" } });
      } else if (dueTask?.status === "open") {
        await tx.task.update({ where: { id: dueTask.id }, data: {
          title: updated.title, description: updated.notes, dueAt: updated.nextDueAt,
          animalId: updated.animalId, reminderRuleId,
        } });
      } else if (!dueTask || dueDateChanged) {
        await tx.task.create({ data: {
          userId: auth.userId, animalId: updated.animalId, title: updated.title,
          description: updated.notes, category: "health", dueAt: updated.nextDueAt,
          ...(dueTask?.status === "completed" ? (reminderRuleId ? { reminderRuleId } : {}) : { companionCareRecordId: updated.id, ...(reminderRuleId ? { reminderRuleId } : {}) }),
        } });
      }
      return updated;
    });
    res.status(200).json({ record });
  });
  router.delete("/companion-care/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await requireDogsCats(auth.userId);
    const id = parseUuid(req.params.id);
    await ownedRecord(auth.userId, id);
    await prisma.$transaction(async (tx) => {
      await tx.companionCareRecord.update({ where: { id }, data: { deletedAt: new Date() } });
      await tx.task.updateMany({ where: { companionCareRecordId: id, status: "open" }, data: { status: "dismissed" } });
      const record = await tx.companionCareRecord.findFirst({ where: { id, userId: auth.userId }, select: { reminderRuleId: true } });
      if (record?.reminderRuleId) {
        await tx.task.updateMany({ where: { reminderRuleId: record.reminderRuleId, status: "open" }, data: { status: "dismissed" } });
        await tx.reminderRule.update({ where: { id: record.reminderRuleId }, data: { isEnabled: false } });
      }
    });
    res.status(200).json({ deleted: true });
  });
  return router;
}
