import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";
import { requireSession, type AuthContext } from "../auth/session.js";

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
}).strict();
const traitPatch = z.object({
  traitName: z.string().trim().min(1).max(160).optional(),
  traitValue: z.string().trim().min(1).max(240).optional(),
  sourceAnimalId: z.string().uuid().nullable().optional(),
  confidenceNote: z.string().trim().max(10_000).nullable().optional(),
}).strict().refine((v) => Object.keys(v).length > 0, "At least one field is required");

async function ownedAnimal(userId: string, animalId: string) {
  const animal = await prisma.animal.findFirst({ where: { id: animalId, userId }, select: { id: true } });
  if (!animal) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
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
    const traits = await prisma.animalGeneticTrait.findMany({
      where: { animalId },
      orderBy: [{ traitName: "asc" }, { createdAt: "asc" }],
      include: { sourceAnimal: { select: { id: true, name: true, identifier: true, species: true } } },
    });
    res.status(200).json({ traits });
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
        },
        include: { sourceAnimal: { select: { id: true, name: true, identifier: true, species: true } } },
      });
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
    await prisma.animalGeneticTrait.delete({ where: { id } });
    res.status(204).send();
  });

  return router;
}
