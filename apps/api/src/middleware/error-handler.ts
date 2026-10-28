import type { ErrorRequestHandler } from "express";
import { AppError } from "../errors/app-error.js";
import { logger } from "../logger.js";

type ParserError = Error & { type?: string };

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next): void => {
  const requestId =
    typeof res.locals.requestId === "string" ? res.locals.requestId : "unknown";
  const candidate = error instanceof Error ? (error as ParserError) : undefined;

  if (candidate?.type === "entity.parse.failed") {
    res.status(400).json({
      code: "INVALID_JSON",
      message: "Malformed JSON request body",
      details: null,
      requestId,
    });
    return;
  }

  if (candidate?.type === "entity.too.large") {
    res.status(413).json({
      code: "PAYLOAD_TOO_LARGE",
      message: "Request body exceeds the permitted size",
      details: null,
      requestId,
    });
    return;
  }

  if (error instanceof AppError) {
    if (error.statusCode >= 500) logger.error({ requestId, code: error.code }, "Application request failed");
    res.status(error.statusCode).json({
      code: error.code,
      message: error.message,
      details: error.details,
      requestId,
    });
    return;
  }

  logger.error(
    { requestId, errorName: error instanceof Error ? error.name : "UnknownError" },
    "Unhandled request error",
  );
  res.status(500).json({
    code: "INTERNAL_SERVER_ERROR",
    message: "An unexpected error occurred",
    details: null,
    requestId,
  });
};
