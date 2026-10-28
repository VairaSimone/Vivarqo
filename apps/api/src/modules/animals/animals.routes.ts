import { Router } from "express";
import type { Response } from "express";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";
import { requireSession, type AuthContext } from "../auth/session.js";
import { bulkAnimalsSchema, createAnimalSchema, pageQuerySchema, patchAnimalSchema } from "./animals.schemas.js";

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

function toAnimalData(input: z.output<typeof createAnimalSchema>) {
  return {
    ...input,
    birthDate: input.birthDate ? new Date(`${input.birthDate}T00:00:00.000Z`) : null,
    acquiredDate: input.acquiredDate ? new Date(`${input.acquiredDate}T00:00:00.000Z`) : null,
  };
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
    if (!["name", "createdAt", "updatedAt"].includes(sort)) {
      throw new AppError(400, "VALIDATION_ERROR", "Invalid sort option");
    }

    const where: Record<string, unknown> = { userId: auth.userId };
    if (status && status !== "all") where.status = status;
    else if (!status) where.status = "active";
    if (sex) where.sex = sex;
    if (species) where.species = { contains: species, mode: "insensitive" };
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
      }),
    ]);
    res.status(200).json({
      animals,
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
    try {
      const animal = await prisma.$transaction(async (tx) => {
        const created = await tx.animal.create({ data: { ...toAnimalData(input), userId: auth.userId } });
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
      res.status(201).json({ animal });
    } catch (error) {
      mapUniqueViolation(error);
    }
  });

  router.post("/bulk", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parseBody(bulkAnimalsSchema, req.body);
    const identifiers = input.animals.map((animal) => animal.identifier?.trim().toLocaleLowerCase("it-IT")).filter((value): value is string => Boolean(value));
    if (new Set(identifiers).size !== identifiers.length) {
      throw new AppError(400, "DUPLICATE_IDENTIFIERS_IN_REQUEST", "The request contains repeated animal identifiers");
    }
    try {
      const created = await prisma.$transaction(async (tx) => {
        const animals = [];
        for (const animalInput of input.animals) {
          animals.push(await tx.animal.create({ data: { ...toAnimalData(animalInput), userId: auth.userId } }));
        }
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
      res.status(201).json({ animals: created, createdCount: created.length });
    } catch (error) {
      mapUniqueViolation(error);
    }
  });

  router.get("/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = parseUuid(req.params.id!);
    const animal = await prisma.animal.findFirst({ where: { id, userId: auth.userId } });
    if (!animal) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
    res.status(200).json({ animal });
  });

  router.patch("/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = parseUuid(req.params.id!);
    const input = parseBody(patchAnimalSchema, req.body);
    const existing = await prisma.animal.findFirst({ where: { id, userId: auth.userId } });
    if (!existing) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
    if (existing.status === "archived" && "status" in input) {
      throw new AppError(409, "ANIMAL_ARCHIVED", "Use the restore action before changing an archived animal status");
    }

    const data: Record<string, unknown> = { ...input };
    if ("birthDate" in input) data.birthDate = input.birthDate ? new Date(`${input.birthDate}T00:00:00.000Z`) : null;
    if ("acquiredDate" in input) data.acquiredDate = input.acquiredDate ? new Date(`${input.acquiredDate}T00:00:00.000Z`) : null;
    try {
      const animal = await prisma.$transaction(async (tx) => {
        const updated = await tx.animal.update({ where: { id }, data: data as never });
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
      res.status(200).json({ animal });
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
      res.status(200).json({ animal });
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
    res.status(200).json({ animal: archived });
  });

  router.post("/:id/restore", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = parseUuid(req.params.id!);
    const animal = await prisma.animal.findFirst({ where: { id, userId: auth.userId } });
    if (!animal) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
    if (animal.status !== "archived") throw new AppError(409, "ANIMAL_NOT_ARCHIVED", "Only archived animals can be restored");
    const restored = await prisma.animal.update({ where: { id }, data: { status: "active", archivedAt: null } });
    res.status(200).json({ animal: restored });
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
    res.status(204).send();
  });

  return router;
}
