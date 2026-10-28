import { Router } from "express";
import rateLimit from "express-rate-limit";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { PostgresRateLimitStore } from "../../middleware/postgres-rate-limit-store.js";
import { prisma } from "../../db/prisma.js";
import { issueSession, revokeCurrentSession, requireSession, type AuthContext } from "./session.js";
import { setCsrfCookie } from "./csrf.js";
import { createResendEmailSender, type EmailSender } from "./email-sender.js";
import {
  emailRequestSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "./auth.schemas.js";
import {
  authenticate,
  registerAccount,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  verifyEmail,
} from "./auth.service.js";

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

function rateLimitedResponse(res: Response): void {
  res.status(429).json({
    code: "RATE_LIMITED",
    message: "Too many requests",
    details: null,
    requestId: requestId(res),
  });
}

function authRateLimit(limit: number, namespace: string) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    // Integration suites create many synthetic accounts from one loopback IP.
    // Keep the middleware active in development/staging/production; the
    // PostgresRateLimitStore itself is tested independently in integration tests.
    skip: () => process.env.NODE_ENV === "test",
    store: new PostgresRateLimitStore(namespace),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req: Request, res: Response, _next: NextFunction) => rateLimitedResponse(res),
  });
}

// An IP-only limit is bypassable by a distributed credential-stuffing or
// mail-bombing source. A second shared counter is keyed by a normalized email;
// the store HMACs the key before it reaches PostgreSQL.
function emailRateLimit(limit: number, namespace: string): RequestHandler {
  const store = new PostgresRateLimitStore(namespace);
  return async (req, res, next) => {
    // See authRateLimit: test traffic should not poison shared persistent
    // counters for the other integration suites.
    if (process.env.NODE_ENV === "test") {
      next();
      return;
    }
    const email = typeof req.body === "object" && req.body !== null &&
      "email" in req.body && typeof (req.body as { email?: unknown }).email === "string"
      ? (req.body as { email: string }).email.trim().toLowerCase()
      : "";
    if (!email) {
      next();
      return;
    }

    try {
      const counter = await store.increment(email);
      if (counter.totalHits > limit) {
        rateLimitedResponse(res);
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

const registerLimiter = authRateLimit(10, "auth-register");
const registerEmailLimiter = emailRateLimit(5, "auth-register-email");
const loginLimiter = authRateLimit(10, "auth-login");
const loginEmailLimiter = emailRateLimit(10, "auth-login-email");
const tokenRequestLimiter = authRateLimit(5, "auth-token-request");
const resendVerificationEmailLimiter = emailRateLimit(5, "auth-resend-verification-email");
const forgotPasswordEmailLimiter = emailRateLimit(5, "auth-forgot-password-email");
const passwordResetLimiter = authRateLimit(5, "auth-password-reset");

const genericEmailResponse = {
  message: "If the address is eligible, an email with further instructions will be sent.",
};

export function createAuthRouter(sender?: EmailSender) {
  const router = Router();
  const emailSender = sender ?? createResendEmailSender();

  router.get("/csrf", (_req, res) => {
    const csrfToken = setCsrfCookie(res);
    res.status(200).json({ csrfToken });
  });

  router.post("/register", registerLimiter, registerEmailLimiter, async (req, res) => {
    const input = parseBody(registerSchema, req.body);
    await registerAccount(input, emailSender, requestId(res));
    res.status(202).json(genericEmailResponse);
  });

  router.post("/verify-email", tokenRequestLimiter, async (req, res) => {
    const input = parseBody(verifyEmailSchema, req.body);
    await verifyEmail(input.token);
    res.status(200).json({ message: "Email verified. You can now sign in." });
  });

  router.post("/resend-verification", tokenRequestLimiter, resendVerificationEmailLimiter, async (req, res) => {
    const input = parseBody(emailRequestSchema, req.body);
    await resendVerification(input.email, emailSender, requestId(res));
    res.status(202).json(genericEmailResponse);
  });

  router.post("/login", loginLimiter, loginEmailLimiter, async (req, res) => {
    const input = parseBody(loginSchema, req.body);
    const user = await authenticate(input);
    await issueSession(user.id, req, res);
    res.status(200).json({ message: "Signed in successfully" });
  });

  router.post("/logout", async (req, res) => {
    await revokeCurrentSession(req, res);
    res.status(200).json({ message: "Signed out successfully" });
  });

  router.post("/sessions/revoke-all", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    await prisma.userSession.deleteMany({ where: { userId: auth.userId } });
    await revokeCurrentSession(req, res);
    res.status(200).json({ message: "All sessions have been revoked" });
  });

  router.post("/forgot-password", tokenRequestLimiter, forgotPasswordEmailLimiter, async (req, res) => {
    const input = parseBody(emailRequestSchema, req.body);
    await requestPasswordReset(input.email, emailSender, requestId(res));
    res.status(202).json(genericEmailResponse);
  });

  router.post("/reset-password", passwordResetLimiter, async (req, res) => {
    const input = parseBody(resetPasswordSchema, req.body);
    await resetPassword(input);
    await revokeCurrentSession(req, res);
    res.status(200).json({ message: "Password reset successfully. Sign in with your new password." });
  });

  router.get("/me", requireSession, (_req, res) => {
    const auth = res.locals.auth as AuthContext;
    res.status(200).json({
      user: {
        id: auth.userId,
        email: auth.email,
        displayName: auth.displayName,
        locale: auth.locale,
        timezone: auth.timezone,
        emailVerifiedAt: auth.emailVerifiedAt,
      },
    });
  });

  return router;
}
