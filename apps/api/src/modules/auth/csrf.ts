import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { CookieOptions, RequestHandler, Response } from "express";
import { env } from "../../config/env.js";
import { AppError } from "../../errors/app-error.js";
import { readCookie } from "../../http/cookies.js";

export const CSRF_COOKIE_NAME = "vivarqo_csrf";
const CSRF_TTL_MS = 24 * 60 * 60 * 1000;
const csrfCookieOptions: CookieOptions = {
  path: "/",
  httpOnly: false,
  secure: env.NODE_ENV === "production",
  sameSite: "lax",
  maxAge: CSRF_TTL_MS,
};

function signature(payload: string): string {
  return createHmac("sha256", env.CSRF_SECRET).update(payload).digest("base64url");
}

export function createCsrfToken(): string {
  const issuedAt = Date.now().toString(36);
  const nonce = randomBytes(32).toString("base64url");
  const payload = `${issuedAt}.${nonce}`;
  return `${payload}.${signature(payload)}`;
}

export function setCsrfCookie(res: Response, token = createCsrfToken()): string {
  res.cookie(CSRF_COOKIE_NAME, token, csrfCookieOptions);
  return token;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function isValidToken(token: string): boolean {
  const parts = token.split(".");
  if (
    parts.length !== 3 ||
    !/^[0-9a-z]+$/.test(parts[0]!) ||
    !/^[A-Za-z0-9_-]{43}$/.test(parts[1]!) ||
    !/^[A-Za-z0-9_-]{43}$/.test(parts[2]!)
  ) {
    return false;
  }

  const issuedAt = Number.parseInt(parts[0]!, 36);
  const now = Date.now();
  if (!Number.isSafeInteger(issuedAt) || issuedAt > now || now - issuedAt > CSRF_TTL_MS) {
    return false;
  }

  const payload = `${parts[0]}.${parts[1]}`;
  return safeEqual(parts[2]!, signature(payload));
}

export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }

  // Stripe authenticates webhooks using its request signature and raw payload, not browser cookies.
  if (req.path === "/webhooks/stripe") {
    next();
    return;
  }

  const origin = req.get("origin");
  if (origin !== undefined && origin !== env.APP_ORIGIN) {
    next(new AppError(403, "CSRF_INVALID", "CSRF validation failed"));
    return;
  }

  const cookieToken = readCookie(req, CSRF_COOKIE_NAME);
  const headerToken = req.get("X-CSRF-Token");
  if (
    !cookieToken ||
    !headerToken ||
    !safeEqual(cookieToken, headerToken) ||
    !isValidToken(headerToken)
  ) {
    next(new AppError(403, "CSRF_INVALID", "CSRF validation failed"));
    return;
  }

  next();
};
