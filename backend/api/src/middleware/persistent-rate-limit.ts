import rateLimit from "express-rate-limit";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Options } from "express-rate-limit";
import { PostgresRateLimitStore } from "./postgres-rate-limit-store.js";

function rateLimitedResponse(res: Response): void {
  const requestId = typeof res.locals.requestId === "string" ? res.locals.requestId : "unknown";
  res.status(429).json({
    code: "RATE_LIMITED",
    message: "Too many requests",
    details: null,
    requestId,
  });
}

/**
 * Shared persistent IP-based limits for sensitive endpoints. The store HMACs
 * the key before persistence, so raw client IPs are not stored in PostgreSQL.
 */
export function persistentRateLimit(
  limit: number,
  namespace: string,
  windowMs = 15 * 60 * 1000,
): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    skip: () => process.env.NODE_ENV === "test",
    store: new PostgresRateLimitStore(namespace),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req: Request, res: Response, _next: NextFunction, _options: Options) => rateLimitedResponse(res),
  });
}
