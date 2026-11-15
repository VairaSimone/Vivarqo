import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";
import { requireSession, type AuthContext } from "../auth/session.js";
import { calculateGenetics, calculateInbreeding, type GeneticLocusInput } from "./genetic-engine.js";

function parseBody<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", {
    issues: result.error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message })),
  });
  return result.data;
}
function uuid(value: string | string[] | undefined, label: string): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id || !z.string().uuid().safeParse(id).success) throw new AppError(400, "INVALID_ID", `Invalid ${label}`);
  return id;
}
const traitCreate = z.object({
  traitName: z.string().trim().min(1).max(160),
  traitValue: z.string().trim().min(1).max(240),
  sourceAnimalId: z.string().uuid().nullable().optional(),
  confidenceNote: z.string().trim().max(10_000).nullable().optional(),
  inheritanceMode: z.enum(["autosomal_recessive", "incomplete_dominant", "dominant", "codominant"]).nullable().optional(),
  genotype: z.string().max(32).regex(/^(?:[A-Za-z]{2}|(?:[A-Za-z][A-Za-z0-9_-]{0,11}|\?)\|(?:[A-Za-z][A-Za-z0-9_-]{0,11}|\?))$/).nullable().optional(),
  phenotypeRules: z.record(z.string(), z.string().trim().min(1).max(240)).nullable().optional(),
  certainty: z.enum(["confirmed", "visual", "possible", "carrier", "unverified"]).optional(),
  locusId: z.string().uuid().nullable().optional(),
  theoreticalGenotype: z.string().max(64).nullable().optional(),
  observedPhenotype: z.string().trim().max(240).nullable().optional(),
  confirmedGenotype: z.string().max(64).nullable().optional(),
}).strict();
const traitPatch = z.object({
  traitName: z.string().trim().min(1).max(160).optional(),
  traitValue: z.string().trim().min(1).max(240).optional(),
  sourceAnimalId: z.string().uuid().nullable().optional(),
  confidenceNote: z.string().trim().max(10_000).nullable().optional(),
  inheritanceMode: z.enum(["autosomal_recessive", "incomplete_dominant", "dominant", "codominant"]).nullable().optional(),
  genotype: z.string().max(32).regex(/^(?:[A-Za-z]{2}|(?:[A-Za-z][A-Za-z0-9_-]{0,11}|\?)\|(?:[A-Za-z][A-Za-z0-9_-]{0,11}|\?))$/).nullable().optional(),
  phenotypeRules: z.record(z.string(), z.string().trim().min(1).max(240)).nullable().optional(),
  certainty: z.enum(["confirmed", "visual", "possible", "carrier", "unverified"]).optional(),
  locusId: z.string().uuid().nullable().optional(),
  theoreticalGenotype: z.string().max(64).nullable().optional(),
  observedPhenotype: z.string().trim().max(240).nullable().optional(),
  confirmedGenotype: z.string().max(64).nullable().optional(),
}).strict().refine((v) => Object.keys(v).length > 0, "At least one field is required");

const traitListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(100),
});

async function ownedAnimal(userId: string, animalId: string) {
  const animal = await prisma.animal.findFirst({ where: { id: animalId, userId }, select: { id: true } });
  if (!animal) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
}
async function ownedLocus(userId: string, locusId: string | null | undefined) {
  if (!locusId) return;
  const locus = await prisma.geneticLocus.findFirst({ where: { id: locusId, gene: { is: { userId } } }, select: { id: true } });
  if (!locus) throw new AppError(404, "GENETIC_LOCUS_NOT_FOUND", "Genetic locus not found");
}
async function ownedSource(userId: string, sourceAnimalId: string | null | undefined, animalId: string) {
  if (!sourceAnimalId) return;
  if (sourceAnimalId === animalId) throw new AppError(400, "GENETIC_SOURCE_SELF_REFERENCE", "An animal cannot be its own genetic source");
  await ownedAnimal(userId, sourceAnimalId);
}

export function createGeneticTraitsRouter() {
  const router = Router();

  router.get("/animals/:animalId/genetic-traits", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const animalId = uuid(req.params.animalId, "animal id");
    await ownedAnimal(auth.userId, animalId);
    const query = parseBody(traitListQuery, req.query);
    const where = { animalId };
    const [total, traits] = await Promise.all([
      prisma.animalGeneticTrait.count({ where }),
      prisma.animalGeneticTrait.findMany({
        where,
        orderBy: [{ traitName: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { sourceAnimal: { select: { id: true, name: true, identifier: true, species: true } } },
      }),
    ]);
    res.status(200).json({ traits, pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } });
  });

  router.post("/animals/:animalId/genetic-traits", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const animalId = uuid(req.params.animalId, "animal id");
    await ownedAnimal(auth.userId, animalId);
    const input = parseBody(traitCreate, req.body);
    await ownedSource(auth.userId, input.sourceAnimalId, animalId);
    const trait = await prisma.$transaction(async (tx) => {
      const created = await tx.animalGeneticTrait.create({
        data: {
          animalId, traitName: input.traitName, traitValue: input.traitValue,
          sourceAnimalId: input.sourceAnimalId ?? null, confidenceNote: input.confidenceNote ?? null,
          inheritanceMode: input.inheritanceMode ?? null, genotype: input.genotype ?? null, phenotypeRules: input.phenotypeRules as never, certainty: input.certainty ?? "unverified",
          locusId: input.locusId ?? null, theoreticalGenotype: input.theoreticalGenotype ?? null, observedPhenotype: input.observedPhenotype ?? null, confirmedGenotype: input.confirmedGenotype ?? null,
        },
        include: { sourceAnimal: { select: { id: true, name: true, identifier: true, species: true } } },
      });
      await tx.animalGeneticTraitHistory.create({ data: { traitId: created.id, animalId, changedBy: auth.userId, snapshot: created as never } });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "animal_genetic_trait.created", entityType: "animal_genetic_trait", entityId: created.id } });
      return created;
    });
    res.status(201).json({ trait });
  });

  router.patch("/genetic-traits/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = uuid(req.params.id, "genetic trait id");
    const input = parseBody(traitPatch, req.body);
    const existing = await prisma.animalGeneticTrait.findFirst({ where: { id, animal: { is: { userId: auth.userId } } } });
    if (!existing) throw new AppError(404, "GENETIC_TRAIT_NOT_FOUND", "Genetic trait not found");
    const source = input.sourceAnimalId !== undefined ? input.sourceAnimalId : existing.sourceAnimalId;
    await ownedSource(auth.userId, source, existing.animalId);
    const trait = await prisma.$transaction(async (tx) => {
      await tx.animalGeneticTraitHistory.create({ data: { traitId: id, animalId: existing.animalId, changedBy: auth.userId, snapshot: existing as never } });
      const updated = await tx.animalGeneticTrait.update({ where: { id }, data: input as never, include: { sourceAnimal: { select: { id: true, name: true, identifier: true, species: true } } } });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "animal_genetic_trait.updated", entityType: "animal_genetic_trait", entityId: id } });
      return updated;
    });
    res.status(200).json({ trait });
  });

  router.delete("/genetic-traits/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = uuid(req.params.id, "genetic trait id");
    const existing = await prisma.animalGeneticTrait.findFirst({ where: { id, animal: { is: { userId: auth.userId } } }, select: { id: true } });
    if (!existing) throw new AppError(404, "GENETIC_TRAIT_NOT_FOUND", "Genetic trait not found");
    await prisma.$transaction(async (tx) => {
      const snapshot = await tx.animalGeneticTrait.findUniqueOrThrow({ where: { id } });
      await tx.animalGeneticTraitHistory.create({ data: { traitId: id, animalId: snapshot.animalId, changedBy: auth.userId, snapshot: snapshot as never } });
      await tx.animalGeneticTrait.delete({ where: { id } });
    });
    res.status(204).send();
  });

  return router;
}
