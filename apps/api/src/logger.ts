import pino from "pino";
import { env } from "./config/env.js";

export const logger = pino({
  level: env.NODE_ENV === "development" ? "debug" : "info",
  redact: {
    paths: [
      "password", "passwordHash", "token", "tokenHash", "authorization", "cookie", "set-cookie",
      "SESSION_SECRET", "CSRF_SECRET", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
      "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY",
    ],
    censor: "[REDACTED]",
  },
  base: { service: "vivarqo-api", environment: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
});
