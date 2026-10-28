import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { logger } from "../logger.js";

export const requestContext: RequestHandler = (req, res, next) => {
  const requestId = randomUUID();
  const startedAt = process.hrtime.bigint();

  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const entry = {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
    };
    if (res.statusCode >= 500) logger.error(entry, "HTTP request failed");
    else if (res.statusCode >= 400) logger.warn(entry, "HTTP request rejected");
    else logger.info(entry, "HTTP request completed");
  });

  next();
};
