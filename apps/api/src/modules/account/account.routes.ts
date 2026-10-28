import { Router } from "express";
import type { Response } from "express";
import { AppError } from "../../errors/app-error.js";
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

  return router;
}
