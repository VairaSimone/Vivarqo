import { createHmac, randomBytes } from "node:crypto";
import type { Request, RequestHandler, Response, CookieOptions } from "express";
import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { AppError } from "../../errors/app-error.js";
import { readCookie } from "../../http/cookies.js";
import { hashOpaqueToken } from "./token-utils.js";

const IDLE_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const ABSOLUTE_SESSION_MS = 90 * 24 * 60 * 60 * 1000;
const RENEW_WHEN_REMAINING_MS = 7 * 24 * 60 * 60 * 1000;
const LAST_SEEN_UPDATE_INTERVAL_MS = 5 * 60 * 1000;

export const SESSION_COOKIE_NAME =
  env.NODE_ENV === "production" ? "__Host-vivarqo_session" : "vivarqo_session";

const sessionCookieOptions: CookieOptions = {
  path: "/",
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax",
};

export interface AuthContext {
  userId: string;
  sessionId: string;
  email: string;
  displayName: string;
  locale: string;
  timezone: string;
  weightUnit: string;
  temperatureUnit: string;
  displayPreferences: Record<string, unknown>;
  emailVerifiedAt: Date;
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions);
}

function hashIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return createHmac("sha256", env.CSRF_SECRET).update(ip).digest("hex");
}

export async function issueSession(userId: string, req: Request, res: Response): Promise<void> {
  const rawToken = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + IDLE_SESSION_MS);

  await prisma.userSession.create({
    data: {
      userId,
      tokenHash: hashOpaqueToken(rawToken),
      expiresAt,
      lastSeenAt: now,
      userAgent: req.get("user-agent")?.slice(0, 1000) ?? null,
      ipHash: hashIp(req.ip),
    },
  });

  res.cookie(SESSION_COOKIE_NAME, rawToken, {
    ...sessionCookieOptions,
    expires: expiresAt,
    maxAge: IDLE_SESSION_MS,
  });
}

export async function revokeCurrentSession(req: Request, res: Response): Promise<void> {
  const rawToken = readCookie(req, SESSION_COOKIE_NAME);
  if (rawToken) {
    await prisma.userSession.deleteMany({ where: { tokenHash: hashOpaqueToken(rawToken) } });
  }
  clearSessionCookie(res);
}

export const loadOptionalSession: RequestHandler = async (req, res, next) => {
  try {
    const rawToken = readCookie(req, SESSION_COOKIE_NAME);
    if (!rawToken || rawToken.length > 128) {
      next();
      return;
    }

    const tokenHash = hashOpaqueToken(rawToken);
    const session = await prisma.userSession.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            locale: true,
            timezone: true,
            weightUnit: true,
            temperatureUnit: true,
            displayPreferences: true,
            emailVerifiedAt: true,
            deletedAt: true,
            accountStatus: true,
          },
        },
      },
    });

    if (!session) {
      clearSessionCookie(res);
      next();
      return;
    }

    const now = new Date();
    const absoluteExpiry = new Date(session.createdAt.getTime() + ABSOLUTE_SESSION_MS);
    if (
      session.expiresAt <= now ||
      absoluteExpiry <= now ||
      session.user.deletedAt !== null ||
      session.user.accountStatus !== "active"
    ) {
      await prisma.userSession.deleteMany({ where: { id: session.id } });
      clearSessionCookie(res);
      next();
      return;
    }

    let expiresAt = session.expiresAt;
    const shouldRenew = session.expiresAt.getTime() - now.getTime() <= RENEW_WHEN_REMAINING_MS;
    if (shouldRenew) {
      expiresAt = new Date(Math.min(now.getTime() + IDLE_SESSION_MS, absoluteExpiry.getTime()));
    }

    // Avoid a write on every authenticated request. Session activity is
    // useful for operational visibility, but persisting it more than once
    // every few minutes adds needless database load under concurrent traffic.
    const shouldUpdateLastSeen = now.getTime() - (session.lastSeenAt?.getTime() ?? 0) >= LAST_SEEN_UPDATE_INTERVAL_MS;
    if (shouldRenew || shouldUpdateLastSeen) {
      await prisma.userSession.update({
        where: { id: session.id },
        data: {
          ...(shouldUpdateLastSeen ? { lastSeenAt: now } : {}),
          ...(shouldRenew ? { expiresAt } : {}),
        },
      });
    }

    if (shouldRenew) {
      res.cookie(SESSION_COOKIE_NAME, rawToken, {
        ...sessionCookieOptions,
        expires: expiresAt,
        maxAge: expiresAt.getTime() - now.getTime(),
      });
    }

    if (session.user.emailVerifiedAt !== null) {
      res.locals.auth = {
        userId: session.user.id,
        sessionId: session.id,
        email: session.user.email,
        displayName: session.user.displayName,
        locale: session.user.locale,
        timezone: session.user.timezone,
        weightUnit: session.user.weightUnit,
        temperatureUnit: session.user.temperatureUnit,
        displayPreferences: (session.user.displayPreferences ?? {}) as Record<string, unknown>,
        emailVerifiedAt: session.user.emailVerifiedAt,
      } satisfies AuthContext;
    }

    next();
  } catch (error) {
    next(error);
  }
};

export const requireSession: RequestHandler = (_req, res, next) => {
  const auth = res.locals.auth as AuthContext | undefined;
  if (!auth) {
    next(new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication required"));
    return;
  }
  next();
};
