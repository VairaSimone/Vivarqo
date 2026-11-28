import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { AppError } from "../../errors/app-error.js";
import { requireSession, type AuthContext } from "../auth/session.js";

const dateOnly = z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/).refine((value) => {
  const parsed = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");
const statuses = ["mated", "pregnant", "delivered", "unsuccessful", "cancelled"] as const;

export const companionReproductionCreateSchema = z.object({
  femaleAnimalId: z.string().uuid(),
  maleAnimalId: z.string().uuid(),
  matedAt: dateOnly,
  pregnancyConfirmedAt: dateOnly.nullable().optional(),
  expectedDueAt: dateOnly.nullable().optional(),
  deliveredAt: dateOnly.nullable().optional(),
  status: z.enum(statuses).default("mated"),
  totalBorn: z.number().int().min(0).max(100).nullable().optional(),
  liveBorn: z.number().int().min(0).max(100).nullable().optional(),
  stillborn: z.number().int().min(0).max(100).nullable().optional(),
  notes: z.string().trim().max(10000).nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.pregnancyConfirmedAt && value.pregnancyConfirmedAt < value.matedAt) {
    ctx.addIssue({ code: "custom", path: ["pregnancyConfirmedAt"], message: "Pregnancy confirmation cannot precede mating" });
  }
  if (value.expectedDueAt && value.expectedDueAt < (value.pregnancyConfirmedAt ?? value.matedAt)) {
    ctx.addIssue({ code: "custom", path: ["expectedDueAt"], message: "Expected due date cannot precede mating or pregnancy confirmation" });
  }
  if (value.deliveredAt && value.deliveredAt < value.matedAt) {
    ctx.addIssue({ code: "custom", path: ["deliveredAt"], message: "Delivery date cannot precede mating" });
  }
  if (value.status === "pregnant" && !value.pregnancyConfirmedAt) {
    ctx.addIssue({ code: "custom", path: ["pregnancyConfirmedAt"], message: "Confirm the pregnancy before setting this status" });
  }
  if (value.status === "delivered" && !value.deliveredAt) {
    ctx.addIssue({ code: "custom", path: ["deliveredAt"], message: "Enter the delivery date before completing the record" });
  }
  if ((value.liveBorn != null || value.stillborn != null) && value.totalBorn == null) {
    ctx.addIssue({ code: "custom", path: ["totalBorn"], message: "Total offspring count is required when live-born or stillborn counts are entered" });
  }
  if (value.totalBorn != null && (value.liveBorn ?? 0) + (value.stillborn ?? 0) > value.totalBorn) {
    ctx.addIssue({ code: "custom", path: ["totalBorn"], message: "Live-born and stillborn counts cannot exceed total offspring" });
  }
});

export const companionReproductionPatchSchema = z.object({
  matedAt: dateOnly.optional(),
  pregnancyConfirmedAt: dateOnly.nullable().optional(),
  expectedDueAt: dateOnly.nullable().optional(),
  deliveredAt: dateOnly.nullable().optional(),
  status: z.enum(statuses).optional(),
  totalBorn: z.number().int().min(0).max(100).nullable().optional(),
  liveBorn: z.number().int().min(0).max(100).nullable().optional(),
  stillborn: z.number().int().min(0).max(100).nullable().optional(),
  notes: z.string().trim().max(10000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");

function parse<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const result = schema.safeParse(body);
  if (!result.success) throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", { issues: result.error.issues });
  return result.data;
}

function asDate(value: string | null | undefined): Date | null | undefined {
  return value == null ? value : new Date(value + "T00:00:00.000Z");
}
function asDateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function validateTimeline(value: {
  matedAt: string;
  pregnancyConfirmedAt: string | null;
  expectedDueAt: string | null;
  deliveredAt: string | null;
  status: typeof statuses[number];
  totalBorn: number | null;
  liveBorn: number | null;
  stillborn: number | null;
}) {
  const result = companionReproductionCreateSchema.safeParse({
    femaleAnimalId: "00000000-0000-4000-8000-000000000001",
    maleAnimalId: "00000000-0000-4000-8000-000000000002",
    ...value,
  });
  if (!result.success) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid mating, pregnancy or litter timeline", { issues: result.error.issues });
  }
}

async function ownedParents(userId: string, femaleAnimalId: string, maleAnimalId: string) {
  if (femaleAnimalId === maleAnimalId) {
    throw new AppError(400, "INVALID_COMPANION_REPRODUCTION_PARENTS", "The female and male must be different animals");
  }
  const parents = await prisma.animal.findMany({
    where: { userId, id: { in: [femaleAnimalId, maleAnimalId] } },
    select: { id: true, name: true, species: true, category: true, sex: true, status: true, archivedAt: true },
  });
  if (parents.length !== 2) throw new AppError(404, "ANIMAL_NOT_FOUND", "One or both breeding animals were not found");

  const female = parents.find((animal) => animal.id === femaleAnimalId)!;
  const male = parents.find((animal) => animal.id === maleAnimalId)!;
  if (female.category !== "dogs_cats" || male.category !== "dogs_cats") {
    throw new AppError(400, "INVALID_COMPANION_REPRODUCTION_PARENTS", "Only dogs and cats can be selected for companion reproduction");
  }
  if (female.sex !== "female" || male.sex !== "male") {
    throw new AppError(400, "INVALID_COMPANION_REPRODUCTION_PARENTS", "Select a female as mother and a male as father");
  }
  if (female.species.trim().toLocaleLowerCase("it-IT") !== male.species.trim().toLocaleLowerCase("it-IT")) {
    throw new AppError(400, "INCOMPATIBLE_ANIMAL_PARENT", "The two parents must belong to the same species");
  }
  if ([female, male].some((animal) => animal.status !== "active" || animal.archivedAt !== null)) {
    throw new AppError(409, "ANIMAL_NOT_ACTIVE", "Only active animals can be used for a new mating record");
  }
  return { female, male };
}

export function createCompanionReproductionRouter() {
  const router = Router();

  router.get("/companion-reproductions", requireSession, async (_req, res) => {
    const auth = res.locals.auth as AuthContext;
    const records = await prisma.companionReproduction.findMany({
      where: { userId: auth.userId },
      include: {
        female: { select: { id: true, name: true, species: true, sex: true } },
        male: { select: { id: true, name: true, species: true, sex: true } },
      },
      orderBy: [{ matedAt: "desc" }, { createdAt: "desc" }],
      take: 200,
    });
    res.status(200).json({ records });
  });

  router.post("/companion-reproductions", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parse(companionReproductionCreateSchema, req.body);
    const { female, male } = await ownedParents(auth.userId, input.femaleAnimalId, input.maleAnimalId);
    const record = await prisma.$transaction(async (tx) => {
      const created = await tx.companionReproduction.create({
        data: {
          userId: auth.userId,
          femaleAnimalId: female.id,
          maleAnimalId: male.id,
          matedAt: new Date(input.matedAt + "T00:00:00.000Z"),
          pregnancyConfirmedAt: asDate(input.pregnancyConfirmedAt ?? null),
          expectedDueAt: asDate(input.expectedDueAt ?? null),
          deliveredAt: asDate(input.deliveredAt ?? null),
          status: input.status,
          totalBorn: input.totalBorn ?? null,
          liveBorn: input.liveBorn ?? null,
          stillborn: input.stillborn ?? null,
          notes: input.notes ?? null,
        },
        include: {
          female: { select: { id: true, name: true, species: true, sex: true } },
          male: { select: { id: true, name: true, species: true, sex: true } },
        },
      });
      await tx.auditEvent.create({
        data: {
          userId: auth.userId,
          action: "companion_reproduction.created",
          entityType: "companion_reproduction",
          entityId: created.id,
        },
      });
      return created;
    });
    res.status(201).json({ record });
  });

  router.patch("/companion-reproductions/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = req.params.id!;
    if (!z.string().uuid().safeParse(id).success) throw new AppError(400, "INVALID_ID", "Invalid id");
    const input = parse(companionReproductionPatchSchema, req.body);
    const existing = await prisma.companionReproduction.findFirst({ where: { id, userId: auth.userId } });
    if (!existing) throw new AppError(404, "COMPANION_REPRODUCTION_NOT_FOUND", "Reproduction record not found");

    const merged = {
      matedAt: input.matedAt ?? asDateOnly(existing.matedAt)!,
      pregnancyConfirmedAt: input.pregnancyConfirmedAt !== undefined ? input.pregnancyConfirmedAt : asDateOnly(existing.pregnancyConfirmedAt),
      expectedDueAt: input.expectedDueAt !== undefined ? input.expectedDueAt : asDateOnly(existing.expectedDueAt),
      deliveredAt: input.deliveredAt !== undefined ? input.deliveredAt : asDateOnly(existing.deliveredAt),
      status: input.status ?? (existing.status as typeof statuses[number]),
      totalBorn: input.totalBorn !== undefined ? input.totalBorn : existing.totalBorn,
      liveBorn: input.liveBorn !== undefined ? input.liveBorn : existing.liveBorn,
      stillborn: input.stillborn !== undefined ? input.stillborn : existing.stillborn,
    };
    validateTimeline(merged);

    const record = await prisma.companionReproduction.update({
      where: { id },
      data: {
        ...(input.matedAt !== undefined ? { matedAt: new Date(input.matedAt + "T00:00:00.000Z") } : {}),
        ...(input.pregnancyConfirmedAt !== undefined ? { pregnancyConfirmedAt: asDate(input.pregnancyConfirmedAt) } : {}),
        ...(input.expectedDueAt !== undefined ? { expectedDueAt: asDate(input.expectedDueAt) } : {}),
        ...(input.deliveredAt !== undefined ? { deliveredAt: asDate(input.deliveredAt) } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.totalBorn !== undefined ? { totalBorn: input.totalBorn } : {}),
        ...(input.liveBorn !== undefined ? { liveBorn: input.liveBorn } : {}),
        ...(input.stillborn !== undefined ? { stillborn: input.stillborn } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
      include: {
        female: { select: { id: true, name: true, species: true, sex: true } },
        male: { select: { id: true, name: true, species: true, sex: true } },
      },
    });
    res.status(200).json({ record });
  });

  router.delete("/companion-reproductions/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = req.params.id!;
    if (!z.string().uuid().safeParse(id).success) throw new AppError(400, "INVALID_ID", "Invalid id");
    const deleted = await prisma.companionReproduction.deleteMany({ where: { id, userId: auth.userId } });
    if (deleted.count === 0) throw new AppError(404, "COMPANION_REPRODUCTION_NOT_FOUND", "Reproduction record not found");
    res.status(204).send();
  });

  return router;
}
