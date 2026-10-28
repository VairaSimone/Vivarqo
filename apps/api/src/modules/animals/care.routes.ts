import { Router } from "express";
import type { Response } from "express";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";
import { requireSession, type AuthContext } from "../auth/session.js";
import {
  feedingSessionSchema,
  noteSchema,
  pageQuerySchema,
  patchFeedingEntrySchema,
  patchNoteSchema,
  patchShedSchema,
  patchWeightSchema,
  shedSchema,
  weightSchema,
} from "./animals.schemas.js";

function parseBody<TSchema extends z.ZodType>(schema: TSchema, body: unknown): z.output<TSchema> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

function parseUuid(value: string, label = "id"): string {
  if (!z.string().uuid().safeParse(value).success) throw new AppError(400, "INVALID_ID", `Invalid ${label}`);
  return value;
}

async function getOwnedAnimal(userId: string, animalId: string, writable = false) {
  const animal = await prisma.animal.findFirst({ where: { id: animalId, userId } });
  if (!animal) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
  if (writable && (animal.status !== "active" || animal.archivedAt !== null)) {
    throw new AppError(409, "ANIMAL_NOT_ACTIVE", "New care records can only be added to active animals");
  }
  return animal;
}

function pageOptions(query: unknown) {
  return parseBody(pageQuerySchema, query);
}

export function createCareRouter() {
  const router = Router();

  router.get("/feeding-sessions", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const page = pageOptions(req.query);
    const where: Record<string, unknown> = { userId: auth.userId };
    const entryFilters: Array<Record<string, unknown>> = [{ animal: { is: { userId: auth.userId } } }];
    if (typeof req.query.animalId === "string") {
      entryFilters.push({ animalId: parseUuid(req.query.animalId, "animalId") });
    }
    if (typeof req.query.outcome === "string") {
      if (!["ate", "refused", "not_offered", "unknown"].includes(req.query.outcome)) {
        throw new AppError(400, "VALIDATION_ERROR", "Invalid feeding outcome filter");
      }
      entryFilters.push({ outcome: req.query.outcome });
    }
    if (entryFilters.length > 1) where.entries = { some: { AND: entryFilters } };
    else where.entries = { some: entryFilters[0] };
    if (typeof req.query.from === "string" || typeof req.query.to === "string") {
      const dateFilter: Record<string, Date> = {};
      if (typeof req.query.from === "string") {
        const from = new Date(req.query.from);
        if (Number.isNaN(from.getTime())) throw new AppError(400, "VALIDATION_ERROR", "Invalid from date");
        dateFilter.gte = from;
      }
      if (typeof req.query.to === "string") {
        const to = new Date(req.query.to);
        if (Number.isNaN(to.getTime())) throw new AppError(400, "VALIDATION_ERROR", "Invalid to date");
        dateFilter.lte = to;
      }
      where.performedAt = dateFilter;
    }
    const [total, sessions] = await Promise.all([
      prisma.feedingSession.count({ where: where as never }),
      prisma.feedingSession.findMany({
        where: where as never,
        orderBy: { performedAt: "desc" },
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
        include: {
          entries: {
            where: { animal: { is: { userId: auth.userId } } },
            include: { animal: { select: { id: true, name: true, identifier: true, species: true, status: true } } },
          },
        },
      }),
    ]);
    res.status(200).json({
      sessions,
      pagination: { page: page.page, pageSize: page.pageSize, total, totalPages: Math.ceil(total / page.pageSize) },
    });
  });

  router.post("/feeding-sessions", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parseBody(feedingSessionSchema, req.body);
    const ids = input.entries.map((entry) => entry.animalId);
    const created = await prisma.$transaction(async (tx) => {
      const owned = await tx.animal.findMany({
        where: { userId: auth.userId, id: { in: ids } },
        select: { id: true, status: true, archivedAt: true },
      });
      if (owned.length !== ids.length) throw new AppError(404, "ANIMAL_NOT_FOUND", "One or more animals were not found");
      if (owned.some((animal) => animal.status !== "active" || animal.archivedAt !== null)) {
        throw new AppError(409, "ANIMAL_NOT_ACTIVE", "Feeding sessions can only contain active animals");
      }

      const session = await tx.feedingSession.create({
        data: { userId: auth.userId, performedAt: new Date(input.performedAt), notes: input.notes ?? null },
      });
      await tx.feedingEntry.createMany({
        data: input.entries.map((entry) => ({
          sessionId: session.id,
          animalId: entry.animalId,
          outcome: entry.outcome,
          foodType: entry.foodType ?? null,
          foodSize: entry.foodSize ?? null,
          foodWeightG: entry.foodWeightG ?? null,
          notes: entry.notes ?? null,
        })),
      });
      await tx.auditEvent.create({
        data: {
          userId: auth.userId,
          action: input.entries.length > 1 ? "feeding.bulk_created" : "feeding.created",
          entityType: "feeding_session",
          entityId: session.id,
          metadata: { entries: input.entries.length },
        },
      });
      return tx.feedingSession.findFirstOrThrow({
        where: { id: session.id, userId: auth.userId },
        include: {
          entries: {
            where: { animal: { is: { userId: auth.userId } } },
            include: { animal: { select: { id: true, name: true, identifier: true, species: true } } },
          },
        },
      });
    });
    res.status(201).json({ session: created, createdCount: created.entries.length });
  });

  router.get("/feeding-sessions/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = parseUuid(req.params.id!);
    const session = await prisma.feedingSession.findFirst({
      where: { id, userId: auth.userId },
      include: {
        entries: {
          where: { animal: { is: { userId: auth.userId } } },
          include: { animal: { select: { id: true, name: true, identifier: true, species: true } } },
        },
      },
    });
    if (!session) throw new AppError(404, "FEEDING_SESSION_NOT_FOUND", "Feeding session not found");
    res.status(200).json({ session });
  });

  router.patch("/feeding-entries/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = parseUuid(req.params.id!);
    const input = parseBody(patchFeedingEntrySchema, req.body);
    const owned = await prisma.feedingEntry.findFirst({
      where: { id, session: { is: { userId: auth.userId } }, animal: { is: { userId: auth.userId } } },
    });
    if (!owned) throw new AppError(404, "FEEDING_ENTRY_NOT_FOUND", "Feeding entry not found");
    const entry = await prisma.feedingEntry.update({ where: { id }, data: input as never });
    res.status(200).json({ entry });
  });

  router.delete("/feeding-entries/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = parseUuid(req.params.id!);
    const owned = await prisma.feedingEntry.findFirst({
      where: { id, session: { is: { userId: auth.userId } }, animal: { is: { userId: auth.userId } } },
      select: { id: true, sessionId: true },
    });
    if (!owned) throw new AppError(404, "FEEDING_ENTRY_NOT_FOUND", "Feeding entry not found");
    await prisma.$transaction(async (tx) => {
      await tx.feedingEntry.delete({ where: { id } });
      const remaining = await tx.feedingEntry.count({ where: { sessionId: owned.sessionId } });
      if (remaining === 0) await tx.feedingSession.deleteMany({ where: { id: owned.sessionId, userId: auth.userId } });
    });
    res.status(204).send();
  });

  router.get("/animals/:animalId/weights", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const animalId = parseUuid(req.params.animalId!, "animalId");
    await getOwnedAnimal(auth.userId, animalId);
    const page = pageOptions(req.query);
    const [total, weights] = await Promise.all([
      prisma.weightMeasurement.count({ where: { animalId } }),
      prisma.weightMeasurement.findMany({
        where: { animalId },
        orderBy: { measuredAt: "desc" },
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
      }),
    ]);
    res.status(200).json({ weights, pagination: { page: page.page, pageSize: page.pageSize, total, totalPages: Math.ceil(total / page.pageSize) } });
  });

  router.post("/animals/:animalId/weights", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const animalId = parseUuid(req.params.animalId!, "animalId");
    await getOwnedAnimal(auth.userId, animalId, true);
    const input = parseBody(weightSchema, req.body);
    const weight = await prisma.weightMeasurement.create({
      data: { animalId, measuredAt: new Date(input.measuredAt), weightG: input.weightG, notes: input.notes ?? null },
    });
    res.status(201).json({ weight });
  });

  router.patch("/weights/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = parseUuid(req.params.id!);
    const input = parseBody(patchWeightSchema, req.body);
    const existing = await prisma.weightMeasurement.findFirst({ where: { id, animal: { is: { userId: auth.userId } } } });
    if (!existing) throw new AppError(404, "WEIGHT_NOT_FOUND", "Weight record not found");
    const weight = await prisma.weightMeasurement.update({
      where: { id },
      data: { ...input, ...(input.measuredAt ? { measuredAt: new Date(input.measuredAt) } : {}) } as never,
    });
    res.status(200).json({ weight });
  });

  router.delete("/weights/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = parseUuid(req.params.id!);
    const existing = await prisma.weightMeasurement.findFirst({ where: { id, animal: { is: { userId: auth.userId } } }, select: { id: true } });
    if (!existing) throw new AppError(404, "WEIGHT_NOT_FOUND", "Weight record not found");
    await prisma.weightMeasurement.delete({ where: { id } });
    res.status(204).send();
  });

  router.get("/animals/:animalId/sheds", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const animalId = parseUuid(req.params.animalId!, "animalId");
    await getOwnedAnimal(auth.userId, animalId);
    const page = pageOptions(req.query);
    const [total, sheds] = await Promise.all([
      prisma.shedRecord.count({ where: { animalId } }),
      prisma.shedRecord.findMany({
        where: { animalId },
        orderBy: { occurredAt: "desc" },
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
      }),
    ]);
    res.status(200).json({ sheds, pagination: { page: page.page, pageSize: page.pageSize, total, totalPages: Math.ceil(total / page.pageSize) } });
  });

  router.post("/animals/:animalId/sheds", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const animalId = parseUuid(req.params.animalId!, "animalId");
    await getOwnedAnimal(auth.userId, animalId, true);
    const input = parseBody(shedSchema, req.body);
    const shed = await prisma.shedRecord.create({ data: { animalId, occurredAt: new Date(input.occurredAt), outcome: input.outcome, notes: input.notes ?? null } });
    res.status(201).json({ shed });
  });

  router.patch("/sheds/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = parseUuid(req.params.id!);
    const input = parseBody(patchShedSchema, req.body);
    const existing = await prisma.shedRecord.findFirst({ where: { id, animal: { is: { userId: auth.userId } } } });
    if (!existing) throw new AppError(404, "SHED_NOT_FOUND", "Shed record not found");
    const shed = await prisma.shedRecord.update({
      where: { id },
      data: { ...input, ...(input.occurredAt ? { occurredAt: new Date(input.occurredAt) } : {}) } as never,
    });
    res.status(200).json({ shed });
  });

  router.delete("/sheds/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = parseUuid(req.params.id!);
    const existing = await prisma.shedRecord.findFirst({ where: { id, animal: { is: { userId: auth.userId } } }, select: { id: true } });
    if (!existing) throw new AppError(404, "SHED_NOT_FOUND", "Shed record not found");
    await prisma.shedRecord.delete({ where: { id } });
    res.status(204).send();
  });

  router.get("/animals/:animalId/notes", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const animalId = parseUuid(req.params.animalId!, "animalId");
    await getOwnedAnimal(auth.userId, animalId);
    const page = pageOptions(req.query);
    const includeArchived = req.query.includeArchived === "true";
    const where = { animalId, ...(includeArchived ? {} : { archivedAt: null }) };
    const [total, notes] = await Promise.all([
      prisma.animalNote.count({ where }),
      prisma.animalNote.findMany({
        where,
        orderBy: { occurredAt: "desc" },
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
      }),
    ]);
    res.status(200).json({ notes, pagination: { page: page.page, pageSize: page.pageSize, total, totalPages: Math.ceil(total / page.pageSize) } });
  });

  router.post("/animals/:animalId/notes", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const animalId = parseUuid(req.params.animalId!, "animalId");
    await getOwnedAnimal(auth.userId, animalId, true);
    const input = parseBody(noteSchema, req.body);
    const note = await prisma.animalNote.create({
      data: { animalId, occurredAt: new Date(input.occurredAt), title: input.title ?? null, category: input.category, body: input.body },
    });
    res.status(201).json({ note });
  });

  router.patch("/animal-notes/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = parseUuid(req.params.id!);
    const input = parseBody(patchNoteSchema, req.body);
    const existing = await prisma.animalNote.findFirst({ where: { id, archivedAt: null, animal: { is: { userId: auth.userId } } } });
    if (!existing) throw new AppError(404, "ANIMAL_NOTE_NOT_FOUND", "Animal note not found");
    const note = await prisma.animalNote.update({
      where: { id },
      data: { ...input, ...(input.occurredAt ? { occurredAt: new Date(input.occurredAt) } : {}) } as never,
    });
    res.status(200).json({ note });
  });

  router.delete("/animal-notes/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = parseUuid(req.params.id!);
    const existing = await prisma.animalNote.findFirst({ where: { id, animal: { is: { userId: auth.userId } } }, select: { id: true, archivedAt: true } });
    if (!existing) throw new AppError(404, "ANIMAL_NOTE_NOT_FOUND", "Animal note not found");
    if (existing.archivedAt === null) {
      await prisma.animalNote.update({ where: { id }, data: { archivedAt: new Date() } });
    }
    res.status(204).send();
  });

  router.get("/animals/:animalId/history", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const animalId = parseUuid(req.params.animalId!, "animalId");
    await getOwnedAnimal(auth.userId, animalId);
    const page = pageOptions(req.query);
    const take = Math.min(100, page.page * page.pageSize);
    const [feeding, weights, sheds, notes] = await Promise.all([
      prisma.feedingEntry.findMany({
        where: { animalId, session: { is: { userId: auth.userId } } },
        include: { session: { select: { id: true, performedAt: true, notes: true } } },
        orderBy: { session: { performedAt: "desc" } },
        take,
      }),
      prisma.weightMeasurement.findMany({ where: { animalId }, orderBy: { measuredAt: "desc" }, take }),
      prisma.shedRecord.findMany({ where: { animalId }, orderBy: { occurredAt: "desc" }, take }),
      prisma.animalNote.findMany({ where: { animalId, archivedAt: null }, orderBy: { occurredAt: "desc" }, take }),
    ]);
    const items = [
      ...feeding.map((record) => ({ type: "feeding" as const, occurredAt: record.session.performedAt, record })),
      ...weights.map((record) => ({ type: "weight" as const, occurredAt: record.measuredAt, record })),
      ...sheds.map((record) => ({ type: "shed" as const, occurredAt: record.occurredAt, record })),
      ...notes.map((record) => ({ type: "note" as const, occurredAt: record.occurredAt, record })),
    ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
    const start = (page.page - 1) * page.pageSize;
    res.status(200).json({
      items: items.slice(start, start + page.pageSize),
      pagination: {
        page: page.page,
        pageSize: page.pageSize,
        total: feeding.length + weights.length + sheds.length + notes.length,
        truncated: take === 100 && items.length >= 100,
      },
    });
  });

  return router;
}
