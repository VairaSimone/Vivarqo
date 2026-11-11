import { Router, raw } from "express";
import type { Response, NextFunction } from "express";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { logger } from "../../logger.js";
import { prisma } from "../../db/prisma.js";
import { requireSession, type AuthContext } from "../auth/session.js";
import { persistentRateLimit } from "../../middleware/persistent-rate-limit.js";
import { deletePrivateObject, openPrivateObjectStream, storePrivateObject, validatePrivateImage } from "./private-storage.js";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const uploadBody = raw({
  type: ["image/jpeg", "image/png", "image/webp", "application/octet-stream"],
  limit: "5mb",
});

function parseAnimalId(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !z.string().uuid().safeParse(candidate).success) {
    throw new AppError(400, "INVALID_ID", "Invalid animal id");
  }
  return candidate;
}

function photoMimeType(storageKey: string): string {
  const extension = storageKey.split(".").at(-1)?.toLowerCase();
  if (extension === "jpg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  throw new AppError(500, "ANIMAL_PHOTO_INVALID", "Stored animal photo reference is invalid");
}

function privatePhotoUrl(animalId: string, updatedAt: Date): string {
  return "/api/v1/animals/" + animalId + "/photo?v=" + updatedAt.getTime();
}

function sendPhoto(
  storageKey: string,
  res: Response,
  next: NextFunction,
  visibility: "private" | "public",
): Promise<void> {
  return openPrivateObjectStream(storageKey, MAX_PHOTO_BYTES).then(({ stream, sizeBytes }) => {
    res.setHeader("Content-Type", photoMimeType(storageKey));
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", visibility === "private" ? "private, no-store" : "no-store");
    if (visibility === "public") res.setHeader("X-Robots-Tag", "noindex");
    if (sizeBytes !== null) res.setHeader("Content-Length", String(sizeBytes));
    res.status(200);
    stream.on("error", (error: Error) => {
      if (res.headersSent) res.destroy(error);
      else next(error);
    });
    res.on("close", () => {
      if (!res.writableEnded) stream.destroy();
    });
    stream.pipe(res);
  });
}

export function createAnimalPhotoRouter() {
  const router = Router();

  router.get("/public/animals/:slug/photo", persistentRateLimit(60, "animal-photo-public"), async (req, res, next) => {
    const slug = req.params.slug;
    if (!slug || !/^[A-Za-z0-9_-]{32}$/.test(slug)) {
      throw new AppError(404, "PUBLIC_PAGE_NOT_FOUND", "Public page not found");
    }
    const share = await prisma.publicShare.findFirst({
      where: { slug, isEnabled: true, revokedAt: null, animal: { is: { archivedAt: null } } },
      select: {
        visibleFields: true,
        animal: { select: { photoKey: true } },
      },
    });
    const visibleFields = Array.isArray(share?.visibleFields) ? share.visibleFields : [];
    if (!share || !visibleFields.includes("photo") || !share.animal.photoKey) {
      throw new AppError(404, "PUBLIC_PHOTO_NOT_FOUND", "Public photo not found");
    }
    await sendPhoto(share.animal.photoKey, res, next, "public");
  });

  router.get("/animals/:id/photo", requireSession, async (req, res, next) => {
    const auth = res.locals.auth as AuthContext;
    const animalId = parseAnimalId(req.params.id);
    const animal = await prisma.animal.findFirst({
      where: { id: animalId, userId: auth.userId },
      select: { photoKey: true },
    });
    if (!animal) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
    if (!animal.photoKey) throw new AppError(404, "ANIMAL_PHOTO_NOT_FOUND", "This animal has no photo");
    await sendPhoto(animal.photoKey, res, next, "private");
  });

  router.post(
    "/animals/:id/photo",
    requireSession,
    persistentRateLimit(20, "animal-photo-upload"),
    async (req, res, next) => {
      const auth = res.locals.auth as AuthContext;
      const animalId = parseAnimalId(req.params.id);
      const ownedAnimal = await prisma.animal.findFirst({
        where: { id: animalId, userId: auth.userId },
        select: { id: true },
      });
      if (!ownedAnimal) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
      res.locals.animalPhotoAnimalId = animalId;
      next();
    },
    uploadBody,
    async (req, res) => {
      const auth = res.locals.auth as AuthContext;
      const animalId = res.locals.animalPhotoAnimalId as string;
      if (!Buffer.isBuffer(req.body)) throw new AppError(400, "FILE_REQUIRED", "Upload the image bytes as the request body");

      const declaredMime = (req.get("content-type") ?? "application/octet-stream").split(";")[0]!.trim();
      const detected = validatePrivateImage(req.body, declaredMime);
      const storageKey = await storePrivateObject("animal-photos", detected.extension, req.body);

      try {
        const updated = await prisma.$transaction(async (tx) => {
          const existing = await tx.animal.findFirst({
            where: { id: animalId, userId: auth.userId },
            select: { id: true, photoKey: true },
          });
          if (!existing) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
          const animal = await tx.animal.update({
            where: { id: animalId },
            data: { photoKey: storageKey },
            select: { id: true, updatedAt: true },
          });
          await tx.auditEvent.create({
            data: {
              userId: auth.userId,
              action: existing.photoKey ? "animal.photo_replaced" : "animal.photo_uploaded",
              entityType: "animal",
              entityId: animalId,
              requestId: typeof res.locals.requestId === "string" ? res.locals.requestId : "unknown",
              metadata: { mimeType: detected.mimeType, sizeBytes: req.body.length },
            },
          });
          return { animal, previousPhotoKey: existing.photoKey };
        });

        if (updated.previousPhotoKey && updated.previousPhotoKey !== storageKey) {
          try {
            await deletePrivateObject(updated.previousPhotoKey);
          } catch (error) {
            logger.error({ animalId, storageKey: updated.previousPhotoKey, error }, "Failed to delete the replaced animal photo");
          }
        }
        res.setHeader("Cache-Control", "no-store");
        res.status(200).json({ photoUrl: privatePhotoUrl(animalId, updated.animal.updatedAt) });
      } catch (error) {
        try {
          await deletePrivateObject(storageKey);
        } catch (cleanupError) {
          logger.error({ animalId, storageKey, error: cleanupError }, "Failed to clean up an animal photo after an unsuccessful update");
        }
        throw error;
      }
    },
  );

  router.delete("/animals/:id/photo", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const animalId = parseAnimalId(req.params.id);
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.animal.findFirst({
        where: { id: animalId, userId: auth.userId },
        select: { id: true, photoKey: true },
      });
      if (!existing) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
      if (!existing.photoKey) return { photoKey: null };
      await tx.animal.update({ where: { id: animalId }, data: { photoKey: null } });
      await tx.auditEvent.create({
        data: {
          userId: auth.userId,
          action: "animal.photo_deleted",
          entityType: "animal",
          entityId: animalId,
          requestId: typeof res.locals.requestId === "string" ? res.locals.requestId : "unknown",
        },
      });
      return { photoKey: existing.photoKey };
    });

    if (result.photoKey) {
      try {
        await deletePrivateObject(result.photoKey);
      } catch (error) {
        logger.error({ animalId, storageKey: result.photoKey, error }, "Failed to delete an animal photo after removing its database reference");
      }
    }
    res.setHeader("Cache-Control", "no-store");
    res.status(204).end();
  });

  return router;
}
