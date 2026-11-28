import { Router } from "express";
import type { Response } from "express";
import { z } from "zod";
import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";
import { logger } from "../../logger.js";
import { deletePrivateObject } from "../domain/private-storage.js";
import { assertAnimalCapacity } from "../domain/billing-entitlements.js";
import { requireSession, type AuthContext } from "../auth/session.js";
import { bulkAnimalsSchema, createAnimalSchema, mergeAnimalDomainProfile, pageQuerySchema, patchAnimalSchema } from "./animals.schemas.js";

function requestId(res: Response): string {
  return typeof res.locals.requestId === "string" ? res.locals.requestId : "unknown";
}

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

function parseUuid(value: string | string[] | undefined, label = "id"): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id || !z.string().uuid().safeParse(id).success) {
    throw new AppError(400, "INVALID_ID", `Invalid ${label}`);
  }
  return id;
}


async function assertAnimalCategoryEnabled(userId: string, category: string) {
  const configuration = await prisma.accountConfiguration.findUnique({
    where: { userId },
    select: { animalCategories: true },
  });
  if (!configuration?.animalCategories.includes(category)) {
    throw new AppError(403, "ANIMAL_CATEGORY_NOT_ENABLED", "This animal category is not enabled for the account", {
      category,
      settingsPath: "/settings/categories",
    });
  }
}

function toAnimalData(input: z.output<typeof createAnimalSchema>) {
  return {
    ...input,
    domainProfile: input.domainProfile as Prisma.InputJsonValue,
    birthDate: input.birthDate ? new Date(`${input.birthDate}T00:00:00.000Z`) : null,
    acquiredDate: input.acquiredDate ? new Date(`${input.acquiredDate}T00:00:00.000Z`) : null,
  };
}


function animalResponse<T extends { id: string; photoKey: string | null; qrToken?: string | null; updatedAt: Date }>(animal: T) {
  const { photoKey, qrToken: _qrToken, ...safeAnimal } = animal;
  void _qrToken;
  return {
    ...safeAnimal,
    photoUrl: photoKey ? "/api/v1/animals/" + animal.id + "/photo?v=" + animal.updatedAt.getTime() : null,
  };
}

async function validateAnimalParents(
  userId: string,
  motherAnimalId: string | null | undefined,
  fatherAnimalId: string | null | undefined,
  childCategory: string,
  childSpecies: string,
  childId?: string,
) {
  if (motherAnimalId && fatherAnimalId && motherAnimalId === fatherAnimalId) {
    throw new AppError(400, "INVALID_ANIMAL_PARENT", "The same animal cannot be both parents");
  }
  const ids = [...new Set([motherAnimalId, fatherAnimalId].filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;
  if (childId && ids.includes(childId)) throw new AppError(400, "INVALID_ANIMAL_PARENT", "An animal cannot be its own parent");
  const parents = await prisma.animal.findMany({
    where: { id: { in: ids }, userId },
    select: { id: true, sex: true, category: true, species: true },
  });
  if (parents.length !== ids.length) throw new AppError(400, "INVALID_ANIMAL_PARENT", "Selected parent not found in this account");
  const incompatible = parents.find((parent) =>
    parent.category !== childCategory ||
    parent.species.trim().toLocaleLowerCase("it-IT") !== childSpecies.trim().toLocaleLowerCase("it-IT"),
  );
  if (incompatible) {
    throw new AppError(400, "INCOMPATIBLE_ANIMAL_PARENT", "Parents must belong to the same animal category and species as the offspring", {
      childCategory, childSpecies,
    });
  }
  if (motherAnimalId && parents.find((parent) => parent.id === motherAnimalId)?.sex !== "female") throw new AppError(400, "INVALID_MOTHER", "The selected mother must be female");
  if (fatherAnimalId && parents.find((parent) => parent.id === fatherAnimalId)?.sex !== "male") throw new AppError(400, "INVALID_FATHER", "The selected father must be male");
  if (childId) {
    const descendants = await prisma.$queryRaw<Array<{ id: string }>>`
      WITH RECURSIVE descendants(id) AS (
        SELECT id FROM animals WHERE mother_animal_id = ${childId}::uuid OR father_animal_id = ${childId}::uuid
        UNION
        SELECT child.id FROM animals child
        INNER JOIN descendants parent ON child.mother_animal_id = parent.id OR child.father_animal_id = parent.id
      )
      SELECT id FROM descendants WHERE id = ANY(${ids}::uuid[])
    `;
    if (descendants.length > 0) throw new AppError(400, "CYCLIC_ANIMAL_PARENTAGE", "A descendant cannot be selected as a parent");
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

function mapUniqueViolation(error: unknown): never {
  if (isUniqueViolation(error)) {
    throw new AppError(409, "ANIMAL_IDENTIFIER_CONFLICT", "The animal identifier is already used in this account");
  }
  throw error;
}

export function createAnimalRouter() {
  const router = Router();

  router.get("/", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const pageInput = parseBody(pageQuerySchema, req.query);
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const sex = typeof req.query.sex === "string" ? req.query.sex : undefined;
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 160) : "";
    const species = typeof req.query.species === "string" ? req.query.species.trim().slice(0, 160) : "";
    const speciesExact = typeof req.query.speciesExact === "string" ? req.query.speciesExact.trim().slice(0, 160) : "";
    const category = typeof req.query.category === "string" ? req.query.category : "";
    const morph = typeof req.query.morph === "string" ? req.query.morph.trim().slice(0, 200) : "";
    const location = typeof req.query.location === "string" ? req.query.location.trim().slice(0, 160) : "";
    const sort = typeof req.query.sort === "string" ? req.query.sort : "updatedAt";
    const allowedStatuses = ["active", "sold", "transferred", "deceased", "archived"];
    if (status && status !== "all" && !allowedStatuses.includes(status)) {
      throw new AppError(400, "VALIDATION_ERROR", "Invalid status filter");
    }
    if (sex && !["male", "female", "unknown"].includes(sex)) {
      throw new AppError(400, "VALIDATION_ERROR", "Invalid sex filter");
    }
    if (category && !["reptiles", "fish", "birds", "dogs_cats"].includes(category)) {
      throw new AppError(400, "VALIDATION_ERROR", "Invalid animal category filter");
    }
    if (!["name", "createdAt", "updatedAt"].includes(sort)) {
      throw new AppError(400, "VALIDATION_ERROR", "Invalid sort option");
    }

    const configuration = await prisma.accountConfiguration.findUnique({ where: { userId: auth.userId }, select: { animalCategories: true } });
    const enabledCategories = configuration?.animalCategories ?? [];
    const where: Record<string, unknown> = { userId: auth.userId, category: category || { in: enabledCategories } };
    if (status && status !== "all") where.status = status;
    else if (!status) where.status = "active";
    if (sex) where.sex = sex;
    if (speciesExact) where.species = { equals: speciesExact, mode: "insensitive" };
    else if (species) where.species = { contains: species, mode: "insensitive" };
    if (morph) where.morph = { contains: morph, mode: "insensitive" };
    if (location) where.locationLabel = { contains: location, mode: "insensitive" };
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { identifier: { contains: q, mode: "insensitive" } },
      ];
    }

    const [total, animals] = await Promise.all([
      prisma.animal.count({ where: where as never }),
      prisma.animal.findMany({
        where: where as never,
        orderBy: sort === "name" ? [{ name: "asc" }, { id: "asc" }] : sort === "createdAt" ? { createdAt: "desc" } : { updatedAt: "desc" },
        skip: (pageInput.page - 1) * pageInput.pageSize,
        take: pageInput.pageSize,
        include: { mother: { select: { id: true, name: true, morph: true, sex: true } }, father: { select: { id: true, name: true, morph: true, sex: true } } },
      }),
    ]);
    res.status(200).json({
      animals: animals.map(animalResponse),
      pagination: {
        page: pageInput.page,
        pageSize: pageInput.pageSize,
        total,
        totalPages: Math.ceil(total / pageInput.pageSize),
      },
    });
  });

  router.post("/", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parseBody(createAnimalSchema, req.body);
    await assertAnimalCategoryEnabled(auth.userId, input.category);
    await validateAnimalParents(auth.userId, input.motherAnimalId, input.fatherAnimalId, input.category, input.species);
    try {
      const animal = await prisma.$transaction(async (tx) => {
        await assertAnimalCapacity(tx, auth.userId, 1);
        const created = await tx.animal.create({ data: { ...toAnimalData(input), userId: auth.userId }, include: { mother: { select: { id: true, name: true, morph: true, sex: true } }, father: { select: { id: true, name: true, morph: true, sex: true } } } });
        await tx.auditEvent.create({
          data: {
            userId: auth.userId,
            action: "animal.created",
            entityType: "animal",
            entityId: created.id,
            requestId: requestId(res),
          },
        });
        return created;
      });
      res.status(201).json({ animal: animalResponse(animal) });
    } catch (error) {
      mapUniqueViolation(error);
    }
  });

  router.post("/bulk", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parseBody(bulkAnimalsSchema, req.body);
    await Promise.all([...new Set(input.animals.map((animal) => animal.category))].map((category) => assertAnimalCategoryEnabled(auth.userId, category)));
    // Keep parent compatibility, sex and pedigree-cycle rules identical to single creation.
    for (const animal of input.animals) {
      await validateAnimalParents(auth.userId, animal.motherAnimalId, animal.fatherAnimalId, animal.category, animal.species);
    }
    const identifiers = input.animals.map((animal) => animal.identifier?.trim().toLocaleLowerCase("it-IT")).filter((value): value is string => Boolean(value));
    if (new Set(identifiers).size !== identifiers.length) {
      throw new AppError(400, "DUPLICATE_IDENTIFIERS_IN_REQUEST", "The request contains repeated animal identifiers");
    }
    try {
      const created = await prisma.$transaction(async (tx) => {
        await assertAnimalCapacity(tx, auth.userId, input.animals.length);
        // PostgreSQL can insert and return the batch in one round-trip rather
        // than issuing one INSERT per animal inside the transaction.
        const animals = await tx.animal.createManyAndReturn({
          data: input.animals.map((animalInput) => ({ ...toAnimalData(animalInput), userId: auth.userId })),
        });
        await tx.auditEvent.create({
          data: {
            userId: auth.userId,
            action: "animal.bulk_created",
            entityType: "animal",
            requestId: requestId(res),
            metadata: { count: animals.length },
          },
        });
        return animals;
      });
      res.status(201).json({ animals: created.map(animalResponse), createdCount: created.length });
    } catch (error) {
      mapUniqueViolation(error);
    }
  });

  router.get("/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = parseUuid(req.params.id!);
    const animal = await prisma.animal.findFirst({ where: { id, userId: auth.userId }, include: { mother: { select: { id: true, name: true, morph: true, sex: true } }, father: { select: { id: true, name: true, morph: true, sex: true } } } });
    if (!animal) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
    await assertAnimalCategoryEnabled(auth.userId, animal.category);
    res.status(200).json({ animal: animalResponse(animal) });
  });

  router.patch("/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = parseUuid(req.params.id!);
    const input = parseBody(patchAnimalSchema, req.body);
    const existing = await prisma.animal.findFirst({ where: { id, userId: auth.userId } });
    if (!existing) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
    if (input.category && input.category !== existing.category) {
      throw new AppError(
        409,
        "ANIMAL_CATEGORY_IMMUTABLE",
        "An animal category cannot be changed after creation. Create a new animal in the target category and archive the original to preserve its history and module associations.",
        { currentCategory: existing.category, requestedCategory: input.category },
      );
    }
    const resultingSpecies = input.species ?? existing.species;
    await validateAnimalParents(
      auth.userId,
      input.motherAnimalId !== undefined ? input.motherAnimalId : existing.motherAnimalId,
      input.fatherAnimalId !== undefined ? input.fatherAnimalId : existing.fatherAnimalId,
      existing.category,
      resultingSpecies,
      id,
    );
    await assertAnimalCategoryEnabled(auth.userId, existing.category);
    let mergedDomainProfile: Record<string, unknown> | undefined;
    if ("domainProfile" in input) {
      const profile = mergeAnimalDomainProfile(
        existing.category as "reptiles" | "fish" | "birds" | "dogs_cats",
        existing.domainProfile,
        input.domainProfile ?? {},
      );
      if (!profile.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Invalid category-specific animal profile", { issues: profile.error.issues });
      }
      mergedDomainProfile = profile.data;
    }
    if (existing.status === "archived" && "status" in input) {
      throw new AppError(409, "ANIMAL_ARCHIVED", "Use the restore action before changing an archived animal status");
    }

    const data: Record<string, unknown> = {
      ...input,
      ...(mergedDomainProfile !== undefined ? { domainProfile: mergedDomainProfile } : {}),
    };
    // Category is immutable; repeating the current category is a harmless no-op.
    delete data.category;
    if ("birthDate" in input) data.birthDate = input.birthDate ? new Date(`${input.birthDate}T00:00:00.000Z`) : null;
    if ("acquiredDate" in input) data.acquiredDate = input.acquiredDate ? new Date(`${input.acquiredDate}T00:00:00.000Z`) : null;
    try {
      const animal = await prisma.$transaction(async (tx) => {
        const updated = await tx.animal.update({ where: { id }, data: data as never, include: { mother: { select: { id: true, name: true, morph: true, sex: true } }, father: { select: { id: true, name: true, morph: true, sex: true } } } });
        await tx.auditEvent.create({
          data: {
            userId: auth.userId,
            action: "animal.updated",
            entityType: "animal",
            entityId: id,
            requestId: requestId(res),
            metadata: { fields: Object.keys(input) },
          },
        });
        return updated;
      });
      res.status(200).json({ animal: animalResponse(animal) });
    } catch (error) {
      mapUniqueViolation(error);
    }
  });

  router.post("/:id/archive", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = parseUuid(req.params.id!);
    const animal = await prisma.animal.findFirst({ where: { id, userId: auth.userId } });
    if (!animal) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
    if (animal.status === "archived") {
      res.status(200).json({ animal: animalResponse(animal) });
      return;
    }
    const archived = await prisma.$transaction(async (tx) => {
      const result = await tx.animal.update({
        where: { id },
        data: { status: "archived", archivedAt: new Date() },
      });
      await tx.auditEvent.create({
        data: { userId: auth.userId, action: "animal.archived", entityType: "animal", entityId: id, requestId: requestId(res) },
      });
      return result;
    });
    res.status(200).json({ animal: animalResponse(archived) });
  });

  router.post("/:id/restore", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = parseUuid(req.params.id!);
    const animal = await prisma.animal.findFirst({ where: { id, userId: auth.userId } });
    if (!animal) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
    if (animal.status !== "archived") throw new AppError(409, "ANIMAL_NOT_ARCHIVED", "Only archived animals can be restored");
    const restored = await prisma.animal.update({ where: { id }, data: { status: "active", archivedAt: null } });
    res.status(200).json({ animal: animalResponse(restored) });
  });

  router.delete("/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = parseUuid(req.params.id!);
    const animal = await prisma.animal.findFirst({
      where: { id, userId: auth.userId },
      include: {
        _count: {
          select: {
            feedingEntries: true,
            weightMeasurements: true,
            shedRecords: true,
            notesHistory: true,
            reminderRules: true,
            tasks: true,
            parentCyclesA: true,
            parentCyclesB: true,
            reproductiveEvents: true,
            documents: true,
            financeEntries: true,
            geneticTraits: true,
            traitsAsSource: true,
            aviaryAssignments: true,
            aviaryMovements: true,
            companionReproductionsAsFemale: true,
            companionReproductionsAsMale: true,
          },
        },
        publicShare: true,
      },
    });
    if (!animal) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
    const linkedCount = Object.values(animal._count).reduce((sum, value) => sum + value, 0) + (animal.publicShare ? 1 : 0) + (animal.originClutchId ? 1 : 0) + (animal.originOffspringBatchId ? 1 : 0);
    if (linkedCount > 0) {
      throw new AppError(409, "ANIMAL_HAS_HISTORY", "This animal has linked history or records. Archive it instead of deleting it.", {
        linkedRecords: linkedCount,
      });
    }
    await prisma.animal.delete({ where: { id } });
    if (animal.photoKey) {
      try {
        await deletePrivateObject(animal.photoKey);
      } catch (error) {
        logger.error({ animalId: id, storageKey: animal.photoKey, error }, "Failed to delete an animal photo after deleting its animal record");
      }
    }
    res.status(204).send();
  });

  return router;
}
