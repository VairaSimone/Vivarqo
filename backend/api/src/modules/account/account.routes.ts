import { Router } from "express";
import argon2 from "argon2";
import { z } from "zod";
import type { Response } from "express";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";
import { enqueueAccountDeletion } from "../domain/background-jobs.js";
import { requireSession, clearSessionCookie, type AuthContext } from "../auth/session.js";
import { createResendEmailSender, type EmailSender } from "../auth/email-sender.js";
import { accountPatchSchema } from "../auth/auth.schemas.js";
import { patchAccount } from "../auth/auth.service.js";

function requestId(res: Response): string {
  return typeof res.locals.requestId === "string" ? res.locals.requestId : "unknown";
}

function parsePatch(body: unknown) {
  const result = accountPatchSchema.safeParse(body);
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

export function createAccountRouter(sender?: EmailSender) {
  const router = Router();
  const emailSender = sender ?? createResendEmailSender();

  router.patch("/", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const result = await patchAccount(auth.userId, parsePatch(req.body), emailSender, requestId(res));
    res.locals.responseLocale = result.user.locale;

    if (result.emailChanged || result.passwordChanged) {
      clearSessionCookie(res);
    }

    if (result.emailChanged) {
      res.status(202).json({
        message: "Email change requested. Verify the new address before signing in again.",
      });
      return;
    }

    if (result.passwordChanged) {
      res.status(200).json({ message: "Password updated. Sign in again with the new password." });
      return;
    }

    res.status(200).json({ user: result.user });
  });


  // Self-service erasure is explicit, requires a password re-check, immediately
  // revokes all sessions/public shares, and is completed by a durable worker.
  router.delete("/", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const parsed = z.object({
      currentPassword: z.string().min(1).max(128),
      confirmation: z.literal("DELETE"),
    }).strict().safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", "Enter your current password and the exact confirmation DELETE");
    }

    const user = await prisma.user.findFirst({
      where: { id: auth.userId, deletedAt: null, accountStatus: "active" },
      select: { id: true, passwordHash: true },
    });
    if (!user) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication required");

    let passwordMatches = false;
    try {
      passwordMatches = await argon2.verify(user.passwordHash, parsed.data.currentPassword);
    } catch {
      passwordMatches = false;
    }
    if (!passwordMatches) throw new AppError(401, "INVALID_CREDENTIALS", "Current password is incorrect");

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      const marked = await tx.user.updateMany({
        where: { id: user.id, accountStatus: "active", deletedAt: null },
        data: { accountStatus: "deletion_pending", deletedAt: now },
      });
      if (marked.count !== 1) throw new AppError(409, "ACCOUNT_DELETION_IN_PROGRESS", "Account deletion is already in progress");
      await tx.userSession.deleteMany({ where: { userId: user.id } });
      await tx.authToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: now },
      });
      await tx.publicShare.updateMany({
        where: { userId: user.id, isEnabled: true },
        data: { isEnabled: false, revokedAt: now },
      });
    });

    clearSessionCookie(res);
    try {
      await enqueueAccountDeletion(user.id);
    } catch {
      // Restore login access if the durable job could not be recorded; sessions
      // remain revoked and public shares stay disabled as a safe default.
      await prisma.user.updateMany({
        where: { id: user.id, accountStatus: "deletion_pending" },
        data: { accountStatus: "active", deletedAt: null },
      });
      throw new AppError(503, "ACCOUNT_DELETION_QUEUE_UNAVAILABLE", "Account deletion could not be queued. Sign in again and retry later.");
    }

    res.status(202).json({
      status: "deletion_pending",
      message: "Account deletion has started. Access is disabled while private files and related records are securely removed.",
    });
  });

  return router;
}
