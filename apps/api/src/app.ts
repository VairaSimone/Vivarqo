import cors from "cors";
import express from "express";
import type { Express, Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { env } from "./config/env.js";
import { AppError } from "./errors/app-error.js";
import { checkDatabaseConnection } from "./db/prisma.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requestContext } from "./middleware/request-context.js";
import { csrfProtection } from "./modules/auth/csrf.js";
import { createAuthRouter } from "./modules/auth/auth.routes.js";
import { loadOptionalSession } from "./modules/auth/session.js";
import { createAccountRouter } from "./modules/account/account.routes.js";
import type { EmailSender } from "./modules/auth/email-sender.js";
import { createAnimalRouter } from "./modules/animals/animals.routes.js";
import { createCareRouter } from "./modules/animals/care.routes.js";
import { createImportRouter } from "./modules/animals/import.routes.js";
import { createTasksRouter } from "./modules/operations/tasks.routes.js";
import { createHomeCalendarRouter } from "./modules/operations/home-calendar.routes.js";
import { createReproductionRouter } from "./modules/domain/reproduction.routes.js";
import { createInventoryRouter } from "./modules/domain/inventory.routes.js";
import { createDocumentShareRouter } from "./modules/domain/documents-shares.routes.js";
import { createFinanceRouter, createNotificationRouter } from "./modules/domain/finance-notifications.routes.js";
import { createBillingRouter, type BillingRouterOptions } from "./modules/domain/billing.routes.js";
import { createExportRouter } from "./modules/domain/exports.routes.js";
import { createCareImportRouter } from "./modules/domain/care-import.routes.js";
import { createDomainImportRouter } from "./modules/domain/domain-import.routes.js";
import { createGeneticTraitsRouter } from "./modules/domain/genetic-traits.routes.js";

export interface AppDependencies {
  checkDatabase?: () => Promise<void>;
  emailSender?: EmailSender;
  billing?: BillingRouterOptions;
}

export function createApp(dependencies: AppDependencies = {}): Express {
  const app = express();
  const checkDatabase = dependencies.checkDatabase ?? checkDatabaseConnection;

  app.disable("x-powered-by");
  app.use(requestContext);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: "same-site" },
    }),
  );
  app.use(
    cors({
      origin: env.APP_ORIGIN,
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "X-CSRF-Token", "X-Request-Id", "X-Document-Name", "X-Document-Category", "X-Animal-Id", "X-Cycle-Id"],
      maxAge: 600,
    }),
  );
  app.use("/api/v1/webhooks/stripe", express.raw({ type: "application/json", limit: "1mb" }));
  app.use(express.json({ limit: "1mb", strict: true }));

  app.use(
    "/api/v1",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (_req: Request, res: Response, _next: NextFunction) => {
        const requestId =
          typeof res.locals.requestId === "string" ? res.locals.requestId : "unknown";
        res.status(429).json({
          code: "RATE_LIMITED",
          message: "Too many requests",
          details: null,
          requestId,
        });
      },
    }),
  );

  // Validate browser intent before touching a server-side session.
  app.use("/api/v1", csrfProtection);
  app.use("/api/v1", loadOptionalSession);
  app.use("/api/v1/auth", createAuthRouter(dependencies.emailSender));
  app.use("/api/v1/account", createAccountRouter(dependencies.emailSender));
  app.use("/api/v1/animals", createAnimalRouter());
  app.use("/api/v1", createCareRouter());
  app.use("/api/v1/imports", createImportRouter());
  app.use("/api/v1/imports", createDomainImportRouter());
  app.use("/api/v1/imports", createCareImportRouter());
  app.use("/api/v1/tasks", createTasksRouter());
  app.use("/api/v1", createHomeCalendarRouter());
  app.use("/api/v1", createReproductionRouter());
  app.use("/api/v1", createInventoryRouter());
  app.use("/api/v1", createDocumentShareRouter());
  app.use("/api/v1", createGeneticTraitsRouter());
  app.use("/api/v1", createFinanceRouter());
  app.use("/api/v1", createNotificationRouter());
  app.use("/api/v1", createBillingRouter(dependencies.billing));
  app.use("/api/v1/exports", createExportRouter());

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok", requestId: res.locals.requestId });
  });

  app.get("/readyz", async (_req, res, next) => {
    try {
      await checkDatabase();
      res.status(200).json({ status: "ready", requestId: res.locals.requestId });
    } catch {
      next(new AppError(503, "SERVICE_UNAVAILABLE", "Service temporarily unavailable"));
    }
  });

  app.use((_req, _res, next) => {
    next(new AppError(404, "NOT_FOUND", "Route not found"));
  });
  app.use(errorHandler);
  return app;
}
