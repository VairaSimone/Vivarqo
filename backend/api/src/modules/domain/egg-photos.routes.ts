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
const uploadBody = raw({ type: ["image/jpeg", "image/png", "image/webp", "application/octet-stream"], limit: "5mb" });

function parseEggId(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !z.string().uuid().safeParse(candidate).success) throw new AppError(400, "INVALID_ID", "Invalid egg id");
  return candidate;
}
function photoMimeType(storageKey: string): string {
  const extension = storageKey.split(".").at(-1)?.toLowerCase();
  if (extension === "jpg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  throw new AppError(500, "EGG_PHOTO_INVALID", "Stored egg photo reference is invalid");
}
function photoUrl(eggId: string, updatedAt: Date): string {
  return "/api/v1/eggs/" + eggId + "/photo?v=" + updatedAt.getTime();
}
function sendPhoto(storageKey: string, res: Response, next: NextFunction): Promise<void> {
  return openPrivateObjectStream(storageKey, MAX_PHOTO_BYTES).then(({ stream, sizeBytes }) => {
    res.setHeader("Content-Type", photoMimeType(storageKey));
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    if (sizeBytes !== null) res.setHeader("Content-Length", String(sizeBytes));
    res.status(200);
    stream.on("error", (error: Error) => { if (res.headersSent) res.destroy(error); else next(error); });
    res.on("close", () => { if (!res.writableEnded) stream.destroy(); });
    stream.pipe(res);
  });
}

export function createEggPhotoRouter() {
  const router = Router();

  router.get("/eggs/:id/photo", requireSession, async (req, res, next) => {
    const auth = res.locals.auth as AuthContext;
    const eggId = parseEggId(req.params.id);
    const egg = await prisma.egg.findFirst({
      where: { id: eggId, clutch: { is: { cycle: { is: { userId: auth.userId } } } } },
      select: { photoKey: true },
    });
    if (!egg) throw new AppError(404, "EGG_NOT_FOUND", "Egg not found");
    if (!egg.photoKey) throw new AppError(404, "EGG_PHOTO_NOT_FOUND", "This egg has no photo");
    await sendPhoto(egg.photoKey, res, next);
  });

  router.post("/eggs/:id/photo", requireSession, persistentRateLimit(20, "egg-photo-upload"), async (req, res, next) => {
    const auth = res.locals.auth as AuthContext;
    const eggId = parseEggId(req.params.id);
    const egg = await prisma.egg.findFirst({
      where: { id: eggId, clutch: { is: { cycle: { is: { userId: auth.userId } } } } },
      select: { id: true },
    });
    if (!egg) throw new AppError(404, "EGG_NOT_FOUND", "Egg not found");
    res.locals.eggPhotoEggId = eggId;
    next();
  }, uploadBody, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const eggId = res.locals.eggPhotoEggId as string;
    if (!Buffer.isBuffer(req.body)) throw new AppError(400, "FILE_REQUIRED", "Upload image bytes as the request body");
    const declaredMime = (req.get("content-type") ?? "application/octet-stream").split(";")[0]!.trim();
    const detected = validatePrivateImage(req.body, declaredMime);
    const storageKey = await storePrivateObject("egg-photos", detected.extension, req.body);
    try {
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.egg.findFirst({
          where: { id: eggId, clutch: { is: { cycle: { is: { userId: auth.userId } } } } },
          select: { id: true, photoKey: true },
        });
        if (!existing) throw new AppError(404, "EGG_NOT_FOUND", "Egg not found");
        const egg = await tx.egg.update({ where: { id: eggId }, data: { photoKey: storageKey }, select: { id: true, updatedAt: true } });
        await tx.auditEvent.create({ data: { userId: auth.userId, action: existing.photoKey ? "egg.photo_replaced" : "egg.photo_uploaded", entityType: "egg", entityId: eggId, metadata: { mimeType: detected.mimeType, sizeBytes: req.body.length } } });
        return { egg, previousPhotoKey: existing.photoKey };
      });
      if (updated.previousPhotoKey && updated.previousPhotoKey !== storageKey) {
        try { await deletePrivateObject(updated.previousPhotoKey); }
        catch (error) { logger.error({ eggId, storageKey: updated.previousPhotoKey, error }, "Failed to delete replaced egg photo"); }
      }
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({ photoUrl: photoUrl(eggId, updated.egg.updatedAt) });
    } catch (error) {
      try { await deletePrivateObject(storageKey); }
      catch (cleanupError) { logger.error({ eggId, storageKey, error: cleanupError }, "Failed to clean up egg photo after unsuccessful update"); }
      throw error;
    }
  });

  router.delete("/eggs/:id/photo", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const eggId = parseEggId(req.params.id);
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.egg.findFirst({
        where: { id: eggId, clutch: { is: { cycle: { is: { userId: auth.userId } } } } },
        select: { id: true, photoKey: true },
      });
      if (!existing) throw new AppError(404, "EGG_NOT_FOUND", "Egg not found");
      if (!existing.photoKey) return { photoKey: null };
      await tx.egg.update({ where: { id: eggId }, data: { photoKey: null } });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "egg.photo_deleted", entityType: "egg", entityId: eggId } });
      return { photoKey: existing.photoKey };
    });
    if (result.photoKey) {
      try { await deletePrivateObject(result.photoKey); }
      catch (error) { logger.error({ eggId, storageKey: result.photoKey, error }, "Failed to delete egg photo after removing its reference"); }
    }
    res.setHeader("Cache-Control", "no-store");
    res.status(204).end();
  });

  return router;
}
