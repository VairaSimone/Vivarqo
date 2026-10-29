import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";
import { requireSession, type AuthContext } from "../auth/session.js";

const statuses = ["planned", "active", "completed", "cancelled"] as const;
const eventTypes = ["pairing", "observation", "ovulation", "gravid", "laying", "live_birth", "incubation_start", "hatch", "loss", "other"] as const;
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const nullableUuid = z.string().uuid().nullable().optional();
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(100),
});

function parseBody<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", {
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message })),
    });
  }
  return parsed.data;
}
function routeUuid(value: string | string[] | undefined, label: string): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id || !z.string().uuid().safeParse(id).success) throw new AppError(400, "INVALID_ID", `Invalid ${label}`);
  return id;
}
function validDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new AppError(400, "VALIDATION_ERROR", "Invalid calendar date");
  return date;
}
async function assertOwnedAnimals(userId: string, ids: Array<string | null | undefined>) {
  const expected = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!expected.length) return;
  const rows = await prisma.animal.findMany({ where: { userId, id: { in: expected } }, select: { id: true } });
  if (rows.length !== expected.length) throw new AppError(404, "ANIMAL_NOT_FOUND", "One or more animals were not found");
}
async function ownedCycle(userId: string, cycleId: string) {
  const cycle = await prisma.reproductionCycle.findFirst({ where: { id: cycleId, userId } });
  if (!cycle) throw new AppError(404, "REPRODUCTION_CYCLE_NOT_FOUND", "Reproduction cycle not found");
  return cycle;
}
async function ownedClutch(userId: string, clutchId: string) {
  const clutch = await prisma.clutch.findFirst({ where: { id: clutchId, cycle: { is: { userId } } } });
  if (!clutch) throw new AppError(404, "CLUTCH_NOT_FOUND", "Clutch not found");
  return clutch;
}
const createCycleSchema = z.object({
  name: z.string().trim().max(160).nullable().optional(),
  startedOn: dateOnly,
  endedOn: dateOnly.nullable().optional(),
  status: z.enum(statuses).default("planned"),
  parentAAnimalId: nullableUuid,
  parentBAnimalId: nullableUuid,
  notes: z.string().trim().max(20_000).nullable().optional(),
}).strict().superRefine((v, ctx) => {
  if (v.endedOn && v.endedOn < v.startedOn) ctx.addIssue({ code: "custom", path: ["endedOn"], message: "End date cannot precede start date" });
  if (v.parentAAnimalId && v.parentAAnimalId === v.parentBAnimalId) ctx.addIssue({ code: "custom", path: ["parentBAnimalId"], message: "Parents must be different animals" });
});
const patchCycleSchema = z.object({
  name: z.string().trim().max(160).nullable().optional(),
  startedOn: dateOnly.optional(),
  endedOn: dateOnly.nullable().optional(),
  status: z.enum(statuses).optional(),
  parentAAnimalId: nullableUuid,
  parentBAnimalId: nullableUuid,
  notes: z.string().trim().max(20_000).nullable().optional(),
}).strict().refine((v) => Object.keys(v).length > 0, "At least one field is required");
const createEventSchema = z.object({
  eventType: z.enum(eventTypes),
  occurredAt: z.string().datetime({ offset: true }),
  animalId: nullableUuid,
  details: z.string().trim().max(20_000).nullable().optional(),
  temperatureC: z.coerce.number().min(-100).max(100).nullable().optional(),
  humidityPct: z.coerce.number().min(0).max(100).nullable().optional(),
}).strict();
const createClutchSchema = z.object({
  cycleId: z.string().uuid(),
  laidOn: dateOnly,
  eggCount: z.coerce.number().int().min(0).max(10_000),
  status: z.string().trim().min(1).max(20).default("active"),
  incubatorLabel: z.string().trim().max(120).nullable().optional(),
  incubationStartedAt: z.string().datetime({ offset: true }).nullable().optional(),
  notes: z.string().trim().max(20_000).nullable().optional(),
}).strict();
const patchClutchSchema = z.object({
  laidOn: dateOnly.optional(),
  eggCount: z.coerce.number().int().min(0).max(10_000).optional(),
  status: z.string().trim().min(1).max(20).optional(),
  incubatorLabel: z.string().trim().max(120).nullable().optional(),
  incubationStartedAt: z.string().datetime({ offset: true }).nullable().optional(),
  notes: z.string().trim().max(20_000).nullable().optional(),
}).strict().refine((v) => Object.keys(v).length > 0, "At least one field is required");
const eggSchema = z.object({
  code: z.string().trim().max(80).nullable().optional(),
  status: z.string().trim().min(1).max(20).default("unknown"),
  notes: z.string().trim().max(10_000).nullable().optional(),
}).strict();
const patchEggSchema = z.object({
  code: z.string().trim().max(80).nullable().optional(),
  status: z.string().trim().min(1).max(20).optional(),
  notes: z.string().trim().max(10_000).nullable().optional(),
}).strict().refine((v) => Object.keys(v).length > 0, "At least one field is required");
const incubationSchema = z.object({
  recordedAt: z.string().datetime({ offset: true }),
  temperatureC: z.coerce.number().min(-100).max(100).nullable().optional(),
  humidityPct: z.coerce.number().min(0).max(100).nullable().optional(),
  eventType: z.string().trim().min(1).max(24),
  notes: z.string().trim().max(10_000).nullable().optional(),
}).strict();
const offspringSchema = z.object({
  cycleId: z.string().uuid(),
  clutchId: z.string().uuid().nullable().optional(),
  bornOn: dateOnly,
  count: z.coerce.number().int().min(0).max(10_000),
  notes: z.string().trim().max(20_000).nullable().optional(),
}).strict();
const newAnimalSchema = z.object({
  name: z.string().trim().min(1).max(120),
  identifier: z.string().trim().max(120).nullable().optional(),
  species: z.string().trim().min(1).max(160),
  sex: z.enum(["male", "female", "unknown"]).default("unknown"),
  morph: z.string().trim().max(200).nullable().optional(),
  birthDate: dateOnly.nullable().optional(),
}).strict();

export function createReproductionRouter() {
  const router = Router();

  router.get("/reproduction-cycles", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const page = parseBody(z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), status: z.enum(statuses).or(z.literal("all")).default("all") }), req.query);
    const where = { userId: auth.userId, ...(page.status === "all" ? {} : { status: page.status }) };
    const [total, cycles] = await Promise.all([
      prisma.reproductionCycle.count({ where }),
      prisma.reproductionCycle.findMany({
        where, orderBy: [{ startedOn: "desc" }, { createdAt: "desc" }],
        skip: (page.page - 1) * page.pageSize, take: page.pageSize,
        include: {
          parentA: { select: { id: true, name: true, identifier: true, species: true } },
          parentB: { select: { id: true, name: true, identifier: true, species: true } },
          _count: { select: { events: true, clutches: true, offspringBatches: true } },
        },
      }),
    ]);
    res.status(200).json({ cycles, pagination: { page: page.page, pageSize: page.pageSize, total, totalPages: Math.ceil(total / page.pageSize) } });
  });

  router.post("/reproduction-cycles", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parseBody(createCycleSchema, req.body);
    await assertOwnedAnimals(auth.userId, [input.parentAAnimalId, input.parentBAnimalId]);
    const cycle = await prisma.$transaction(async (tx) => {
      const created = await tx.reproductionCycle.create({
        data: {
          userId: auth.userId, name: input.name ?? null, startedOn: validDate(input.startedOn),
          endedOn: input.endedOn ? validDate(input.endedOn) : null, status: input.status,
          parentAAnimalId: input.parentAAnimalId ?? null, parentBAnimalId: input.parentBAnimalId ?? null, notes: input.notes ?? null,
        },
      });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "reproduction_cycle.created", entityType: "reproduction_cycle", entityId: created.id } });
      return created;
    });
    res.status(201).json({ cycle });
  });

  router.get("/reproduction-cycles/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const cycleId = routeUuid(req.params.id, "cycle id");
    const cycle = await prisma.reproductionCycle.findFirst({
      where: { id: cycleId, userId: auth.userId },
      include: {
        parentA: { select: { id: true, name: true, identifier: true, species: true } },
        parentB: { select: { id: true, name: true, identifier: true, species: true } },
        // Details are deliberately bounded. Full history is available through
        // the paginated child endpoints below.
        events: { orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 100, include: { animal: { select: { id: true, name: true } } } },
        clutches: { orderBy: [{ laidOn: "desc" }, { id: "desc" }], take: 100, include: { _count: { select: { eggs: true, incubationLogs: true } } } },
        offspringBatches: { orderBy: [{ bornOn: "desc" }, { id: "desc" }], take: 100 },
        _count: { select: { events: true, clutches: true, offspringBatches: true } },
      },
    });
    if (!cycle) throw new AppError(404, "REPRODUCTION_CYCLE_NOT_FOUND", "Reproduction cycle not found");
    res.status(200).json({ cycle });
  });

  router.get("/reproduction-cycles/:id/clutches", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const cycleId = routeUuid(req.params.id, "cycle id");
    await ownedCycle(auth.userId, cycleId);
    const query = parseBody(pageSchema, req.query);
    const where = { cycleId, cycle: { is: { userId: auth.userId } } };
    const [total, clutches] = await Promise.all([
      prisma.clutch.count({ where }),
      prisma.clutch.findMany({
        where,
        orderBy: [{ laidOn: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { _count: { select: { eggs: true, incubationLogs: true } } },
      }),
    ]);
    res.status(200).json({
      clutches,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    });
  });

  router.patch("/reproduction-cycles/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const cycleId = routeUuid(req.params.id, "cycle id");
    const input = parseBody(patchCycleSchema, req.body);
    const existing = await ownedCycle(auth.userId, cycleId);
    await assertOwnedAnimals(auth.userId, [input.parentAAnimalId, input.parentBAnimalId]);
    const start = input.startedOn ?? existing.startedOn.toISOString().slice(0, 10);
    const end = input.endedOn === undefined ? (existing.endedOn?.toISOString().slice(0, 10) ?? null) : input.endedOn;
    if (end && end < start) throw new AppError(400, "VALIDATION_ERROR", "End date cannot precede start date");
    const parentA = input.parentAAnimalId !== undefined ? input.parentAAnimalId : existing.parentAAnimalId;
    const parentB = input.parentBAnimalId !== undefined ? input.parentBAnimalId : existing.parentBAnimalId;
    if (parentA && parentA === parentB) {
      throw new AppError(400, "VALIDATION_ERROR", "Parents must be different animals");
    }
    const data: Record<string, unknown> = { ...input };
    if (input.startedOn) data.startedOn = validDate(input.startedOn);
    if (input.endedOn !== undefined) data.endedOn = input.endedOn ? validDate(input.endedOn) : null;
    const cycle = await prisma.reproductionCycle.update({ where: { id: cycleId }, data: data as never });
    res.status(200).json({ cycle });
  });

  router.get("/reproduction-cycles/:id/events", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const cycleId = routeUuid(req.params.id, "cycle id");
    await ownedCycle(auth.userId, cycleId);
    const query = parseBody(pageSchema, req.query);
    const where = { cycleId, cycle: { is: { userId: auth.userId } } };
    const [total, events] = await Promise.all([
      prisma.reproductiveEvent.count({ where }),
      prisma.reproductiveEvent.findMany({
        where,
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { animal: { select: { id: true, name: true } } },
      }),
    ]);
    res.status(200).json({ events, pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } });
  });

  router.post("/reproduction-cycles/:id/events", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const cycleId = routeUuid(req.params.id, "cycle id");
    await ownedCycle(auth.userId, cycleId);
    const input = parseBody(createEventSchema, req.body);
    await assertOwnedAnimals(auth.userId, [input.animalId]);
    const event = await prisma.$transaction(async (tx) => {
      const created = await tx.reproductiveEvent.create({
        data: {
          cycleId, eventType: input.eventType, occurredAt: new Date(input.occurredAt), animalId: input.animalId ?? null,
          details: input.details ?? null, temperatureC: input.temperatureC ?? null, humidityPct: input.humidityPct ?? null,
        },
      });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "reproductive_event.created", entityType: "reproductive_event", entityId: created.id } });
      return created;
    });
    res.status(201).json({ event });
  });

  router.post("/clutches", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parseBody(createClutchSchema, req.body);
    await ownedCycle(auth.userId, input.cycleId);
    const clutch = await prisma.$transaction(async (tx) => {
      const created = await tx.clutch.create({
        data: {
          cycleId: input.cycleId, laidOn: validDate(input.laidOn), eggCount: input.eggCount, status: input.status,
          incubatorLabel: input.incubatorLabel ?? null, incubationStartedAt: input.incubationStartedAt ? new Date(input.incubationStartedAt) : null, notes: input.notes ?? null,
        },
      });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "clutch.created", entityType: "clutch", entityId: created.id } });
      return created;
    });
    res.status(201).json({ clutch });
  });

  router.get("/clutches/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const clutchId = routeUuid(req.params.id, "clutch id");
    const clutch = await prisma.clutch.findFirst({
      where: { id: clutchId, cycle: { is: { userId: auth.userId } } },
      include: {
        cycle: { select: { id: true, name: true, status: true } },
        eggs: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 100 },
        incubationLogs: { orderBy: [{ recordedAt: "desc" }, { id: "desc" }], take: 100 },
        _count: { select: { eggs: true, incubationLogs: true } },
      },
    });
    if (!clutch) throw new AppError(404, "CLUTCH_NOT_FOUND", "Clutch not found");
    res.status(200).json({ clutch });
  });

  router.patch("/clutches/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const clutchId = routeUuid(req.params.id, "clutch id");
    await ownedClutch(auth.userId, clutchId);
    const input = parseBody(patchClutchSchema, req.body);
    const data: Record<string, unknown> = { ...input };
    if (input.laidOn) data.laidOn = validDate(input.laidOn);
    if (input.incubationStartedAt !== undefined) data.incubationStartedAt = input.incubationStartedAt ? new Date(input.incubationStartedAt) : null;
    const clutch = await prisma.clutch.update({ where: { id: clutchId }, data: data as never });
    res.status(200).json({ clutch });
  });

  router.get("/clutches/:id/eggs", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const clutchId = routeUuid(req.params.id, "clutch id");
    await ownedClutch(auth.userId, clutchId);
    const query = parseBody(pageSchema, req.query);
    const where = { clutchId };
    const [total, eggs] = await Promise.all([
      prisma.egg.count({ where }),
      prisma.egg.findMany({
        where,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    res.status(200).json({ eggs, pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } });
  });

  router.post("/clutches/:id/eggs", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const clutchId = routeUuid(req.params.id, "clutch id");
    const clutch = await ownedClutch(auth.userId, clutchId);
    const input = parseBody(z.object({ eggs: z.array(eggSchema).min(1).max(1000) }).strict(), req.body);
    const codes = input.eggs.map((egg) => egg.code?.trim().toLocaleLowerCase("it-IT")).filter((code): code is string => Boolean(code));
    if (new Set(codes).size !== codes.length) throw new AppError(400, "DUPLICATE_EGG_CODES", "Egg codes must be unique within the request");
    const eggs = await prisma.$transaction(async (tx) => {
      const results = [];
      for (const egg of input.eggs) results.push(await tx.egg.create({ data: { clutchId, code: egg.code ?? null, status: egg.status, notes: egg.notes ?? null } }));
      return results;
    });
    res.status(201).json({ eggs, createdCount: eggs.length });
  });

  router.patch("/eggs/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const eggId = routeUuid(req.params.id, "egg id");
    const input = parseBody(patchEggSchema, req.body);
    const existing = await prisma.egg.findFirst({ where: { id: eggId, clutch: { is: { cycle: { is: { userId: auth.userId } } } } } });
    if (!existing) throw new AppError(404, "EGG_NOT_FOUND", "Egg not found");
    const egg = await prisma.egg.update({ where: { id: eggId }, data: input as never });
    res.status(200).json({ egg });
  });

  router.get("/clutches/:id/incubation-logs", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const clutchId = routeUuid(req.params.id, "clutch id");
    await ownedClutch(auth.userId, clutchId);
    const query = parseBody(pageSchema, req.query);
    const where = { clutchId };
    const [total, logs] = await Promise.all([
      prisma.incubationLog.count({ where }),
      prisma.incubationLog.findMany({
        where,
        orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    res.status(200).json({ logs, pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } });
  });

  router.post("/clutches/:id/incubation-logs", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const clutchId = routeUuid(req.params.id, "clutch id");
    await ownedClutch(auth.userId, clutchId);
    const input = parseBody(incubationSchema, req.body);
    const log = await prisma.incubationLog.create({
      data: {
        clutchId, recordedAt: new Date(input.recordedAt), temperatureC: input.temperatureC ?? null,
        humidityPct: input.humidityPct ?? null, eventType: input.eventType, notes: input.notes ?? null,
      },
    });
    res.status(201).json({ log });
  });

  router.get("/offspring-batches", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const query = parseBody(pageSchema, req.query);
    const where = { cycle: { is: { userId: auth.userId } } };
    const [total, batches] = await Promise.all([
      prisma.offspringBatch.count({ where }),
      prisma.offspringBatch.findMany({
        where,
        orderBy: [{ bornOn: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { cycle: { select: { id: true, name: true } }, clutch: { select: { id: true, laidOn: true, eggCount: true } }, _count: { select: { originAnimals: true } } },
      }),
    ]);
    res.status(200).json({ offspringBatches: batches, pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } });
  });

  router.post("/offspring-batches", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parseBody(offspringSchema, req.body);
    await ownedCycle(auth.userId, input.cycleId);
    if (input.clutchId) {
      const clutch = await ownedClutch(auth.userId, input.clutchId);
      if (clutch.cycleId !== input.cycleId) throw new AppError(400, "CLUTCH_CYCLE_MISMATCH", "Clutch and offspring batch must belong to the same cycle");
    }
    const batch = await prisma.offspringBatch.create({
      data: { cycleId: input.cycleId, clutchId: input.clutchId ?? null, bornOn: validDate(input.bornOn), count: input.count, notes: input.notes ?? null },
    });
    res.status(201).json({ offspringBatch: batch });
  });

  router.post("/offspring-batches/:id/animals", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const batchId = routeUuid(req.params.id, "offspring batch id");
    const batch = await prisma.offspringBatch.findFirst({ where: { id: batchId, cycle: { is: { userId: auth.userId } } } });
    if (!batch) throw new AppError(404, "OFFSPRING_BATCH_NOT_FOUND", "Offspring batch not found");
    const input = parseBody(z.object({ animals: z.array(newAnimalSchema).min(1).max(500) }).strict(), req.body);
    const identifiers = input.animals.map((animal) => animal.identifier?.toLocaleLowerCase("it-IT")).filter((v): v is string => Boolean(v));
    if (new Set(identifiers).size !== identifiers.length) throw new AppError(400, "DUPLICATE_IDENTIFIERS", "Identifiers must be unique in this request");
    const created = await prisma.$transaction(async (tx) => {
      const animals = [];
      for (const animal of input.animals) {
        animals.push(await tx.animal.create({
          data: {
            userId: auth.userId, originOffspringBatchId: batchId, name: animal.name,
            identifier: animal.identifier ?? null, species: animal.species, sex: animal.sex, morph: animal.morph ?? null,
            birthDate: animal.birthDate ? validDate(animal.birthDate) : batch.bornOn,
          },
        }));
      }
      return animals;
    });
    res.status(201).json({ animals: created, createdCount: created.length, batchId });
  });


  router.patch("/reproductive-events/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const eventId = routeUuid(req.params.id, "reproductive event id");
    const input = parseBody(z.object({
      eventType: z.enum(eventTypes).optional(),
      occurredAt: z.string().datetime({ offset: true }).optional(),
      animalId: nullableUuid,
      details: z.string().trim().max(20_000).nullable().optional(),
      temperatureC: z.coerce.number().min(-100).max(100).nullable().optional(),
      humidityPct: z.coerce.number().min(0).max(100).nullable().optional(),
    }).strict().refine((v) => Object.keys(v).length > 0, "At least one field is required"), req.body);
    const existing = await prisma.reproductiveEvent.findFirst({
      where: { id: eventId, cycle: { is: { userId: auth.userId } } },
    });
    if (!existing) throw new AppError(404, "REPRODUCTIVE_EVENT_NOT_FOUND", "Reproductive event not found");
    if (input.animalId !== undefined) await assertOwnedAnimals(auth.userId, [input.animalId]);
    const data: Record<string, unknown> = { ...input };
    if (input.occurredAt) data.occurredAt = new Date(input.occurredAt);
    const event = await prisma.$transaction(async (tx) => {
      const updated = await tx.reproductiveEvent.update({ where: { id: eventId }, data: data as never });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "reproductive_event.updated", entityType: "reproductive_event", entityId: eventId } });
      return updated;
    });
    res.status(200).json({ event });
  });

  router.delete("/reproductive-events/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const eventId = routeUuid(req.params.id, "reproductive event id");
    const existing = await prisma.reproductiveEvent.findFirst({
      where: { id: eventId, cycle: { is: { userId: auth.userId } } },
      select: { id: true },
    });
    if (!existing) throw new AppError(404, "REPRODUCTIVE_EVENT_NOT_FOUND", "Reproductive event not found");
    await prisma.$transaction(async (tx) => {
      await tx.reproductiveEvent.delete({ where: { id: eventId } });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "reproductive_event.deleted", entityType: "reproductive_event", entityId: eventId } });
    });
    res.status(204).send();
  });

  router.patch("/incubation-logs/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const logId = routeUuid(req.params.id, "incubation log id");
    const input = parseBody(z.object({
      recordedAt: z.string().datetime({ offset: true }).optional(),
      temperatureC: z.coerce.number().min(-100).max(100).nullable().optional(),
      humidityPct: z.coerce.number().min(0).max(100).nullable().optional(),
      eventType: z.string().trim().min(1).max(24).optional(),
      notes: z.string().trim().max(10_000).nullable().optional(),
    }).strict().refine((v) => Object.keys(v).length > 0, "At least one field is required"), req.body);
    const existing = await prisma.incubationLog.findFirst({
      where: { id: logId, clutch: { is: { cycle: { is: { userId: auth.userId } } } } },
      select: { id: true },
    });
    if (!existing) throw new AppError(404, "INCUBATION_LOG_NOT_FOUND", "Incubation log not found");
    const data: Record<string, unknown> = { ...input };
    if (input.recordedAt) data.recordedAt = new Date(input.recordedAt);
    const log = await prisma.$transaction(async (tx) => {
      const updated = await tx.incubationLog.update({ where: { id: logId }, data: data as never });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "incubation_log.updated", entityType: "incubation_log", entityId: logId } });
      return updated;
    });
    res.status(200).json({ log });
  });

  router.delete("/incubation-logs/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const logId = routeUuid(req.params.id, "incubation log id");
    const existing = await prisma.incubationLog.findFirst({
      where: { id: logId, clutch: { is: { cycle: { is: { userId: auth.userId } } } } },
      select: { id: true },
    });
    if (!existing) throw new AppError(404, "INCUBATION_LOG_NOT_FOUND", "Incubation log not found");
    await prisma.$transaction(async (tx) => {
      await tx.incubationLog.delete({ where: { id: logId } });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "incubation_log.deleted", entityType: "incubation_log", entityId: logId } });
    });
    res.status(204).send();
  });

  router.patch("/offspring-batches/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const batchId = routeUuid(req.params.id, "offspring batch id");
    const input = parseBody(z.object({
      clutchId: nullableUuid,
      bornOn: dateOnly.optional(),
      count: z.coerce.number().int().min(0).max(10_000).optional(),
      notes: z.string().trim().max(20_000).nullable().optional(),
    }).strict().refine((v) => Object.keys(v).length > 0, "At least one field is required"), req.body);
    const existing = await prisma.offspringBatch.findFirst({
      where: { id: batchId, cycle: { is: { userId: auth.userId } } },
    });
    if (!existing) throw new AppError(404, "OFFSPRING_BATCH_NOT_FOUND", "Offspring batch not found");
    if (input.clutchId) {
      const clutch = await ownedClutch(auth.userId, input.clutchId);
      if (clutch.cycleId !== existing.cycleId) throw new AppError(400, "CLUTCH_CYCLE_MISMATCH", "Clutch and offspring batch must belong to the same cycle");
    }
    const data: Record<string, unknown> = { ...input };
    if (input.bornOn) data.bornOn = validDate(input.bornOn);
    const batch = await prisma.$transaction(async (tx) => {
      const updated = await tx.offspringBatch.update({ where: { id: batchId }, data: data as never });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "offspring_batch.updated", entityType: "offspring_batch", entityId: batchId } });
      return updated;
    });
    res.status(200).json({ offspringBatch: batch });
  });

  router.delete("/offspring-batches/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const batchId = routeUuid(req.params.id, "offspring batch id");
    const existing = await prisma.offspringBatch.findFirst({
      where: { id: batchId, cycle: { is: { userId: auth.userId } } },
      select: { id: true },
    });
    if (!existing) throw new AppError(404, "OFFSPRING_BATCH_NOT_FOUND", "Offspring batch not found");
    const linkedAnimals = await prisma.animal.count({ where: { userId: auth.userId, originOffspringBatchId: batchId } });
    if (linkedAnimals > 0) throw new AppError(409, "OFFSPRING_BATCH_HAS_ANIMALS", "This offspring batch has animal records. Remove or reassign those records before deleting the batch.");
    await prisma.$transaction(async (tx) => {
      await tx.offspringBatch.delete({ where: { id: batchId } });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "offspring_batch.deleted", entityType: "offspring_batch", entityId: batchId } });
    });
    res.status(204).send();
  });

  router.delete("/eggs/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const eggId = routeUuid(req.params.id, "egg id");
    const existing = await prisma.egg.findFirst({
      where: { id: eggId, clutch: { is: { cycle: { is: { userId: auth.userId } } } } },
      select: { id: true },
    });
    if (!existing) throw new AppError(404, "EGG_NOT_FOUND", "Egg not found");
    await prisma.$transaction(async (tx) => {
      await tx.egg.delete({ where: { id: eggId } });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "egg.deleted", entityType: "egg", entityId: eggId } });
    });
    res.status(204).send();
  });

  router.delete("/clutches/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const clutchId = routeUuid(req.params.id, "clutch id");
    const clutch = await ownedClutch(auth.userId, clutchId);
    const [offspring, linkedAnimals] = await Promise.all([
      prisma.offspringBatch.count({ where: { clutchId, cycle: { is: { userId: auth.userId } } } }),
      prisma.animal.count({ where: { userId: auth.userId, originClutchId: clutchId } }),
    ]);
    if (offspring > 0 || linkedAnimals > 0) {
      throw new AppError(409, "CLUTCH_HAS_OFFSPRING", "This clutch is linked to offspring records. Remove or reassign those records before deleting the clutch.");
    }
    await prisma.$transaction(async (tx) => {
      await tx.incubationLog.deleteMany({ where: { clutchId } });
      await tx.egg.deleteMany({ where: { clutchId } });
      await tx.clutch.delete({ where: { id: clutchId } });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "clutch.deleted", entityType: "clutch", entityId: clutchId } });
    });
    res.status(204).send();
  });

  router.delete("/reproduction-cycles/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const cycleId = routeUuid(req.params.id, "cycle id");
    await ownedCycle(auth.userId, cycleId);
    const [events, clutches, offspring, documents] = await Promise.all([
      prisma.reproductiveEvent.count({ where: { cycleId } }),
      prisma.clutch.count({ where: { cycleId } }),
      prisma.offspringBatch.count({ where: { cycleId } }),
      prisma.document.count({ where: { userId: auth.userId, cycleId } }),
    ]);
    if (events + clutches + offspring + documents > 0) {
      throw new AppError(409, "REPRODUCTION_CYCLE_HAS_RECORDS", "This cycle still has linked events, clutches, offspring batches, or documents. Remove those records first.");
    }
    await prisma.$transaction(async (tx) => {
      await tx.reproductionCycle.delete({ where: { id: cycleId } });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "reproduction_cycle.deleted", entityType: "reproduction_cycle", entityId: cycleId } });
    });
    res.status(204).send();
  });

  return router;
}
