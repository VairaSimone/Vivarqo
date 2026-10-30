import { Router } from "express";
import type { Response } from "express";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";
import { requireSession, clearSessionCookie, type AuthContext } from "../auth/session.js";
import { createResendEmailSender, type EmailSender } from "../auth/email-sender.js";
import { accountPatchSchema } from "../auth/auth.schemas.js";
import { patchAccount } from "../auth/auth.service.js";
import { deleteUserAccount } from "./account-deletion.service.js";

function requestId(res: Response): string {
  return typeof res.locals.requestId === "string" ? res.locals.requestId : "unknown";
}

function parseBody<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

const preferencesPatchSchema = z.object({
  weightUnit: z.enum(["g", "kg", "oz", "lb"]).optional(),
  temperatureUnit: z.enum(["c", "f"]).optional(),
  dateFormat: z.enum(["locale", "dd/MM/yyyy", "yyyy-MM-dd"]).optional(),
  defaultLandingPage: z.enum(["today", "animals", "calendar"]).optional(),
  compactTables: z.boolean().optional(),
  theme: z.enum(["system", "light", "dark"]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one preference is required");

export function createAccountRouter(sender?: EmailSender) {
  const router = Router();
  const emailSender = sender ?? createResendEmailSender();

  router.get("/preferences", requireSession, async (_req, res) => {
    const auth = res.locals.auth as AuthContext;
    const preferences = await prisma.userPreference.upsert({
      where: { userId: auth.userId },
      create: { userId: auth.userId },
      update: {},
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).json({ preferences });
  });

  router.patch("/preferences", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parseBody(preferencesPatchSchema, req.body);
    const preferences = await prisma.userPreference.upsert({
      where: { userId: auth.userId },
      create: { userId: auth.userId, ...input },
      update: input,
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).json({ preferences });
  });

  router.patch("/", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const result = await patchAccount(auth.userId, parseBody(accountPatchSchema, req.body), emailSender, requestId(res));
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

  router.delete("/", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parseBody(z.object({
      currentPassword: z.string().min(1).max(256),
      confirmation: z.literal("DELETE"),
    }).strict(), req.body);
    await deleteUserAccount(auth.userId, input.currentPassword);
    clearSessionCookie(res);
    res.status(204).send();
  });

  return router;
}
