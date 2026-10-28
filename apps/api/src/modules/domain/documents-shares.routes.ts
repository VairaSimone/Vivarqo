import { Router, raw } from "express";
import { randomBytes } from "node:crypto";
import { basename, extname } from "node:path";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { requireSession, type AuthContext } from "../auth/session.js";
import { deletePrivateObject, readPrivateObject, storePrivateObject, validatePrivateFile } from "./private-storage.js";

const uploadBody = raw({
  type: ["application/pdf", "image/jpeg", "image/png", "image/webp", "application/octet-stream"],
  limit: "10mb",
});
const shareFields = ["name", "species", "morph", "sex", "birthDate"] as const;
function parseBody<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", { issues: result.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) });
  return result.data;
}
function id(value: string | string[] | undefined, label: string): string {
  const result = Array.isArray(value) ? value[0] : value;
  if (!result || !z.string().uuid().safeParse(result).success) throw new AppError(400, "INVALID_ID", `Invalid ${label}`);
  return result;
}
function requestId(res: import("express").Response): string {
  return typeof res.locals.requestId === "string" ? res.locals.requestId : "unknown";
}
function safeFilename(raw: string): string {
  let name = raw;
  try { name = decodeURIComponent(raw); } catch { /* keep raw header */ }
  name = basename(name).replace(/[\r\n\0]/g, "").replace(/[^\p{L}\p{N} ._()-]/gu, "_").trim().slice(0, 255);
  if (!name || name === "." || name === "..") return "document";
  return name;
}
const createDocumentSchema = z.object({
  animalId: z.string().uuid().nullable().optional(),
  cycleId: z.string().uuid().nullable().optional(),
  category: z.string().trim().min(1).max(40),
  note: z.string().trim().max(10_000).nullable().optional(),
}).strict().refine((v) => Boolean(v.animalId || v.cycleId), "A document must be linked to an animal or a reproduction cycle");

export function createDocumentShareRouter() {
  const router = Router();

  router.get("/documents", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const query = parseBody(z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(25),
      animalId: z.string().uuid().optional(),
      cycleId: z.string().uuid().optional(),
      category: z.string().trim().max(40).optional(),
    }), req.query);
    const where: Record<string, unknown> = { userId: auth.userId, deletedAt: null };
    if (query.animalId) {
      const owned = await prisma.animal.findFirst({ where: { id: query.animalId, userId: auth.userId }, select: { id: true } });
      if (!owned) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
      where.animalId = query.animalId;
    }
    if (query.cycleId) {
      const owned = await prisma.reproductionCycle.findFirst({ where: { id: query.cycleId, userId: auth.userId }, select: { id: true } });
      if (!owned) throw new AppError(404, "REPRODUCTION_CYCLE_NOT_FOUND", "Reproduction cycle not found");
      where.cycleId = query.cycleId;
    }
    if (query.category) where.category = query.category;
    const [total, documents] = await Promise.all([
      prisma.document.count({ where: where as never }),
      prisma.document.findMany({
        where: where as never,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true, animalId: true, cycleId: true, originalFilename: true, mimeType: true, sizeBytes: true,
          category: true, note: true, createdAt: true,
        },
      }),
    ]);
    res.status(200).json({ documents, pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } });
  });

  router.post("/documents", requireSession, uploadBody, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    if (!Buffer.isBuffer(req.body)) throw new AppError(400, "FILE_REQUIRED", "Upload the document bytes as the request body");
    const metadata = parseBody(createDocumentSchema, {
      animalId: req.get("X-Animal-Id") ?? null,
      cycleId: req.get("X-Cycle-Id") ?? null,
      category: req.get("X-Document-Category") ?? "other",
      note: req.get("X-Document-Note") ?? null,
    });
    if (metadata.animalId) {
      const animal = await prisma.animal.findFirst({ where: { id: metadata.animalId, userId: auth.userId }, select: { id: true } });
      if (!animal) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
    }
    if (metadata.cycleId) {
      const cycle = await prisma.reproductionCycle.findFirst({ where: { id: metadata.cycleId, userId: auth.userId }, select: { id: true } });
      if (!cycle) throw new AppError(404, "REPRODUCTION_CYCLE_NOT_FOUND", "Reproduction cycle not found");
    }
    const declaredMime = (req.get("content-type") ?? "application/octet-stream").split(";")[0]!.trim();
    const detected = validatePrivateFile(req.body, declaredMime);
    const filename = safeFilename(req.get("X-Document-Name") ?? `document.${detected.extension}`);
    const ext = extname(filename).toLowerCase().replace(".", "");
    const extensionMatch = ext === detected.extension || (ext === "jpeg" && detected.extension === "jpg");
    if (!extensionMatch) throw new AppError(400, "FILE_EXTENSION_MISMATCH", "Filename extension does not match detected content");

    const storageKey = await storePrivateObject("documents", detected.extension as "pdf" | "jpg" | "png" | "webp", req.body);
    try {
      const document = await prisma.$transaction(async (tx) => {
        const created = await tx.document.create({
          data: {
            userId: auth.userId, animalId: metadata.animalId ?? null, cycleId: metadata.cycleId ?? null,
            originalFilename: filename, storageKey, mimeType: detected.mimeType, sizeBytes: BigInt(req.body.length),
            category: metadata.category, note: metadata.note ?? null,
          },
          select: {
            id: true, animalId: true, cycleId: true, originalFilename: true, mimeType: true,
            sizeBytes: true, category: true, note: true, createdAt: true,
          },
        });
        await tx.auditEvent.create({ data: { userId: auth.userId, action: "document.created", entityType: "document", entityId: created.id, requestId: requestId(res) } });
        return document;
      });
      res.status(201).json({ document: { ...document, sizeBytes: document.sizeBytes.toString() } });
    } catch (error) {
      await deletePrivateObject(storageKey);
      throw error;
    }
  });

  router.get("/documents/:id/download", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const documentId = id(req.params.id, "document id");
    const document = await prisma.document.findFirst({ where: { id: documentId, userId: auth.userId, deletedAt: null } });
    if (!document) throw new AppError(404, "DOCUMENT_NOT_FOUND", "Document not found");
    const bytes = await readPrivateObject(document.storageKey);
    res.setHeader("Content-Type", document.mimeType);
    res.setHeader("Content-Length", bytes.length);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(document.originalFilename)}`);
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).send(bytes);
  });

  router.delete("/documents/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const documentId = id(req.params.id, "document id");
    const document = await prisma.document.findFirst({ where: { id: documentId, userId: auth.userId, deletedAt: null } });
    if (!document) throw new AppError(404, "DOCUMENT_NOT_FOUND", "Document not found");
    await prisma.document.update({ where: { id: documentId }, data: { deletedAt: new Date() } });
    await deletePrivateObject(document.storageKey);
    res.status(204).send();
  });

  router.post("/animals/:id/public-share", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const animalId = id(req.params.id, "animal id");
    const animal = await prisma.animal.findFirst({ where: { id: animalId, userId: auth.userId }, select: { id: true } });
    if (!animal) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
    const input = parseBody(z.object({
      visibleFields: z.array(z.enum(shareFields)).min(1).max(shareFields.length).optional(),
      publicDescription: z.string().trim().max(5000).nullable().optional(),
      isEnabled: z.boolean().optional(),
    }).strict(), req.body ?? {});
    const existing = await prisma.publicShare.findFirst({ where: { animalId, userId: auth.userId } });
    const share = existing
      ? await prisma.publicShare.update({
          where: { id: existing.id },
          data: {
            ...(input.visibleFields ? { visibleFields: input.visibleFields as never } : {}),
            ...(input.publicDescription !== undefined ? { publicDescription: input.publicDescription } : {}),
            ...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled, ...(input.isEnabled ? { revokedAt: null } : { revokedAt: new Date() }) } : {}),
          },
        })
      : await prisma.publicShare.create({
          data: {
            userId: auth.userId, animalId, slug: randomBytes(24).toString("base64url"),
            visibleFields: (input.visibleFields ?? ["name", "species", "morph"]) as never,
            publicDescription: input.publicDescription ?? null, isEnabled: input.isEnabled ?? false,
          },
        });
    res.status(201).json({ share: { ...share, url: `${env.API_ORIGIN}/api/v1/public/animals/${share.slug}` } });
  });

  router.patch("/public-shares/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const shareId = id(req.params.id, "public share id");
    const existing = await prisma.publicShare.findFirst({ where: { id: shareId, userId: auth.userId } });
    if (!existing) throw new AppError(404, "PUBLIC_SHARE_NOT_FOUND", "Public share not found");
    const input = parseBody(z.object({
      isEnabled: z.boolean().optional(),
      visibleFields: z.array(z.enum(shareFields)).min(1).max(shareFields.length).optional(),
      publicDescription: z.string().trim().max(5000).nullable().optional(),
      revoke: z.boolean().optional(),
    }).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required"), req.body);
    const share = await prisma.publicShare.update({
      where: { id: shareId },
      data: {
        ...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled, ...(input.isEnabled ? { revokedAt: null } : {}) } : {}),
        ...(input.visibleFields ? { visibleFields: input.visibleFields as never } : {}),
        ...(input.publicDescription !== undefined ? { publicDescription: input.publicDescription } : {}),
        ...(input.revoke ? { isEnabled: false, revokedAt: new Date() } : {}),
      },
    });
    res.status(200).json({ share, url: `${env.API_ORIGIN}/api/v1/public/animals/${share.slug}` });
  });

  router.get("/public/animals/:slug", async (req, res) => {
    const slug = req.params.slug;
    if (!slug || !/^[A-Za-z0-9_-]{32}$/.test(slug)) throw new AppError(404, "PUBLIC_PAGE_NOT_FOUND", "Public page not found");
    const share = await prisma.publicShare.findFirst({
      where: { slug, isEnabled: true, revokedAt: null, animal: { is: { archivedAt: null } } },
      include: { animal: true },
    });
    if (!share) throw new AppError(404, "PUBLIC_PAGE_NOT_FOUND", "Public page not found");
    const allowlist = Array.isArray(share.visibleFields) ? share.visibleFields.filter((field): field is string => typeof field === "string" && (shareFields as readonly string[]).includes(field)) : [];
    const animal = share.animal;
    const publicAnimal: Record<string, unknown> = {};
    for (const field of allowlist) {
      switch (field) {
        case "name": publicAnimal.name = animal.name; break;
        case "species": publicAnimal.species = animal.species; break;
        case "morph": if (animal.morph !== null) publicAnimal.morph = animal.morph; break;
        case "sex": publicAnimal.sex = animal.sex; break;
        case "birthDate": if (animal.birthDate !== null) publicAnimal.birthDate = animal.birthDate.toISOString().slice(0, 10); break;
      }
    }
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=30");
    res.setHeader("X-Robots-Tag", "noindex");
    res.status(200).json({ animal: publicAnimal, description: share.publicDescription, updatedAt: share.updatedAt });
  });

  return router;
}
