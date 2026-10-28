import { basename, join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";
import { requireSession, type AuthContext } from "../auth/session.js";
import { deletePrivateObject, openPrivateObjectStream, storePrivateObjectFromFile } from "./private-storage.js";
import { singleBufferChunk, writeStreamingZip, type StreamingZipEntry } from "./streaming-zip.js";

const EXPORT_PAGE_SIZE = 250;
const MAX_EXPORT_BYTES = 50 * 1024 * 1024;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let rendered: string;
  if (typeof value === "string") rendered = value;
  else if (typeof value === "bigint") rendered = value.toString();
  else if (value instanceof Date) rendered = value.toISOString();
  else if (typeof value === "object" && value !== null && "toString" in value && value.constructor?.name === "Decimal") rendered = String(value);
  else if (typeof value === "object") rendered = JSON.stringify(value);
  else rendered = String(value);

  // Spreadsheet apps may ignore leading whitespace/control characters
  // before formula prefixes, so protect those cells as well.
  if (/^[\u0000-\u0020]*[=+@\-]/.test(rendered)) rendered = \`'\${rendered}\`;
  return \`"\${rendered.replace(/"/g, '""')}"\`;
}

function routeId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id || !z.string().uuid().safeParse(id).success) throw new AppError(400, "INVALID_ID", "Invalid export id");
  return id;
}

type PageLoader = (cursor: string | undefined, take: number) => Promise<unknown[]>;
type ExportTable = {
  name: string;
  emptyHeaders: string[];
  rows: () => AsyncIterable<Record<string, unknown>>;
};

function paginateRows(loadPage: PageLoader): AsyncIterable<Record<string, unknown>> {
  return (async function* () {
    let cursor: string | undefined;
    while (true) {
      const page = await loadPage(cursor, EXPORT_PAGE_SIZE);
      if (page.length === 0) return;

      for (const row of page) {
        if (typeof row !== "object" || row === null) throw new Error("Unexpected non-object row in export query");
        yield row as Record<string, unknown>;
      }

      const lastId = (page[page.length - 1] as { id?: unknown }).id;
      if (typeof lastId !== "string") throw new Error("Export pagination requires a stable string ID");
      cursor = lastId;
      if (page.length < EXPORT_PAGE_SIZE) return;
    }
  })();
}

async function* mapRows(
  rows: AsyncIterable<Record<string, unknown>>,
  transform: (row: Record<string, unknown>) => Record<string, unknown>,
): AsyncGenerator<Record<string, unknown>> {
  for await (const row of rows) yield transform(row);
}

async function* csvChunks(
  rows: AsyncIterable<Record<string, unknown>>,
  emptyHeaders: string[],
): AsyncGenerator<Buffer> {
  const iterator = rows[Symbol.asyncIterator]();
  try {
    const first = await iterator.next();
    const headers = first.done ? emptyHeaders : Object.keys(first.value);
    yield Buffer.from(`\uFEFF${headers.map(csvCell).join(",")}\r\n`, "utf8");

    if (!first.done) {
      yield Buffer.from(`${headers.map((key) => csvCell(first.value[key])).join(",")}\r\n`, "utf8");
      while (true) {
        const next = await iterator.next();
        if (next.done) break;
        yield Buffer.from(`${headers.map((key) => csvCell(next.value[key])).join(",")}\r\n`, "utf8");
      }
    }
  } finally {
    await iterator.return?.();
  }
}

const EMPTY_HEADERS: Record<string, string[]> = {
        "account.csv": ["id", "email", "displayName", "locale", "timezone", "emailVerifiedAt", "createdAt"],
        "subscriptions.csv": ["id", "userId", "stripeCustomerId", "stripeSubscriptionId", "stripePriceId", "status", "currentPeriodStart", "currentPeriodEnd", "cancelAtPeriodEnd", "createdAt", "updatedAt"],
        "animals.csv": ["id", "userId", "name", "identifier", "species", "sex", "morph", "geneticsNotes", "birthDate", "birthDateEstimated", "acquiredDate", "originDescription", "previousBreeder", "locationLabel", "status", "notes", "photoKey", "originClutchId", "originOffspringBatchId", "archivedAt", "createdAt", "updatedAt"],
        "feeding_sessions.csv": ["id", "userId", "performedAt", "notes", "createdAt", "updatedAt"],
        "feeding_entries.csv": ["id", "sessionId", "animalId", "outcome", "foodType", "foodSize", "foodWeightG", "notes", "createdAt", "updatedAt"],
        "weights.csv": ["id", "animalId", "measuredAt", "weightG", "notes", "createdAt", "updatedAt"],
        "sheds.csv": ["id", "animalId", "occurredAt", "outcome", "notes", "createdAt", "updatedAt"],
        "animal_notes.csv": ["id", "animalId", "occurredAt", "title", "category", "body", "createdAt", "updatedAt", "archivedAt"],
        "reproduction_cycles.csv": ["id", "userId", "parentAAnimalId", "parentBAnimalId", "name", "startedOn", "endedOn", "status", "notes", "createdAt", "updatedAt"],
        "reproductive_events.csv": ["id", "cycleId", "eventType", "occurredAt", "animalId", "details", "temperatureC", "humidityPct", "createdAt", "updatedAt"],
        "clutches.csv": ["id", "cycleId", "laidOn", "eggCount", "status", "incubatorLabel", "incubationStartedAt", "notes", "createdAt", "updatedAt"],
        "eggs.csv": ["id", "clutchId", "code", "status", "notes", "createdAt", "updatedAt"],
        "incubation_logs.csv": ["id", "clutchId", "recordedAt", "temperatureC", "humidityPct", "eventType", "notes", "createdAt", "updatedAt"],
        "offspring_batches.csv": ["id", "cycleId", "clutchId", "bornOn", "count", "notes", "createdAt", "updatedAt"],
        "inventory_items.csv": ["id", "userId", "name", "category", "unit", "quantityOnHand", "minimumQuantity", "notes", "isActive", "createdAt", "updatedAt"],
        "stock_movements.csv": ["id", "itemId", "movementType", "quantity", "unitCostCents", "occurredAt", "reference", "notes", "createdAt"],
        "finance_entries.csv": ["id", "userId", "animalId", "documentId", "entryType", "occurredOn", "amountCents", "currency", "category", "description", "createdAt", "updatedAt"],
        "tasks.csv": ["id", "userId", "animalId", "title", "description", "category", "dueAt", "status", "completedAt", "reminderRuleId", "createdAt", "updatedAt"],
        "reminder_rules.csv": ["id", "userId", "animalId", "title", "category", "intervalDays", "nextDueAt", "isEnabled", "createdAt", "updatedAt"],
        "notifications.csv": ["id", "userId", "category", "title", "body", "targetPath", "readAt", "createdAt"],
        "animal_genetic_traits.csv": ["id", "animalId", "traitName", "traitValue", "sourceAnimalId", "confidenceNote", "createdAt", "updatedAt"],
        "public_shares.csv": ["id", "userId", "animalId", "slug", "visibleFields", "publicDescription", "isEnabled", "revokedAt", "createdAt", "updatedAt"],
        "notification_preferences.csv": ["id", "userId", "inAppEnabled", "pushEnabled", "categories", "quietHoursStart", "quietHoursEnd", "createdAt", "updatedAt"],
        "documents.csv": ["id", "animalId", "cycleId", "originalFilename", "mimeType", "sizeBytes", "category", "note", "createdAt", "archivePath"],
};

function exportTables(userId: string, includeDocuments: boolean): ExportTable[] {
  const page = (cursor: string | undefined, take: number) => ({
    take,
    orderBy: { id: "asc" as const },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  return [
    {
      name: "account.csv", emptyHeaders: EMPTY_HEADERS["account.csv"]!,
      rows: () => paginateRows((cursor, take) => prisma.user.findMany({
        where: { id: userId },
        select: { id: true, email: true, displayName: true, locale: true, timezone: true, emailVerifiedAt: true, createdAt: true },
        ...page(cursor, take),
      })),
    },
    {
      name: "subscriptions.csv", emptyHeaders: EMPTY_HEADERS["subscriptions.csv"]!,
      rows: () => paginateRows((cursor, take) => prisma.subscription.findMany({
        where: { userId },
        select: { id: true, userId: true, stripeCustomerId: true, stripeSubscriptionId: true, stripePriceId: true, status: true, currentPeriodStart: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, createdAt: true, updatedAt: true },
        ...page(cursor, take),
      })),
    },
    {
      name: "animals.csv", emptyHeaders: EMPTY_HEADERS["animals.csv"]!,
      rows: () => paginateRows((cursor, take) => prisma.animal.findMany({ where: { userId }, ...page(cursor, take) })),
    },
    {
      name: "feeding_sessions.csv", emptyHeaders: EMPTY_HEADERS["feeding_sessions.csv"]!,
      rows: () => paginateRows((cursor, take) => prisma.feedingSession.findMany({ where: { userId }, ...page(cursor, take) })),
    },
    {
      name: "feeding_entries.csv", emptyHeaders: EMPTY_HEADERS["feeding_entries.csv"]!,
      rows: () => paginateRows((cursor, take) => prisma.feedingEntry.findMany({
        where: { session: { is: { userId } }, animal: { is: { userId } } }, ...page(cursor, take),
      })),
    },
    {
      name: "weights.csv", emptyHeaders: EMPTY_HEADERS["weights.csv"]!,
      rows: () => paginateRows((cursor, take) => prisma.weightMeasurement.findMany({ where: { animal: { is: { userId } } }, ...page(cursor, take) })),
    },
    {
      name: "sheds.csv", emptyHeaders: EMPTY_HEADERS["sheds.csv"]!,
      rows: () => paginateRows((cursor, take) => prisma.shedRecord.findMany({ where: { animal: { is: { userId } } }, ...page(cursor, take) })),
    },
    {
      name: "animal_notes.csv", emptyHeaders: EMPTY_HEADERS["animal_notes.csv"]!,
      rows: () => paginateRows((cursor, take) => prisma.animalNote.findMany({ where: { animal: { is: { userId } } }, ...page(cursor, take) })),
    },
    {
      name: "reproduction_cycles.csv", emptyHeaders: EMPTY_HEADERS["reproduction_cycles.csv"]!,
      rows: () => paginateRows((cursor, take) => prisma.reproductionCycle.findMany({ where: { userId }, ...page(cursor, take) })),
    },
    {
      name: "reproductive_events.csv", emptyHeaders: EMPTY_HEADERS["reproductive_events.csv"]!,
      rows: () => paginateRows((cursor, take) => prisma.reproductiveEvent.findMany({ where: { cycle: { is: { userId } } }, ...page(cursor, take) })),
    },
    {
      name: "clutches.csv", emptyHeaders: EMPTY_HEADERS["clutches.csv"]!,
      rows: () => paginateRows((cursor, take) => prisma.clutch.findMany({ where: { cycle: { is: { userId } } }, ...page(cursor, take) })),
    },
    {
      name: "eggs.csv", emptyHeaders: EMPTY_HEADERS["eggs.csv"]!,
      rows: () => paginateRows((cursor, take) => prisma.egg.findMany({ where: { clutch: { is: { cycle: { is: { userId } } } } }, ...page(cursor, take) })),
    },
    {
      name: "incubation_logs.csv", emptyHeaders: EMPTY_HEADERS["incubation_logs.csv"]!,
      rows: () => paginateRows((cursor, take) => prisma.incubationLog.findMany({ where: { clutch: { is: { cycle: { is: { userId } } } } }, ...page(cursor, take) })),
    },
    {
      name: "offspring_batches.csv", emptyHeaders: EMPTY_HEADERS["offspring_batches.csv"]!,
      rows: () => paginateRows((cursor, take) => prisma.offspringBatch.findMany({ where: { cycle: { is: { userId } } }, ...page(cursor, take) })),
    },
    {
      name: "inventory_items.csv", emptyHeaders: EMPTY_HEADERS["inventory_items.csv"]!,
      rows: () => paginateRows((cursor, take) => prisma.inventoryItem.findMany({ where: { userId }, ...page(cursor, take) })),
    },
    {
      name: "stock_movements.csv", emptyHeaders: EMPTY_HEADERS["stock_movements.csv"]!,
      rows: () => paginateRows((cursor, take) => prisma.stockMovement.findMany({ where: { item: { is: { userId } } }, ...page(cursor, take) })),
    },
    {
      name: "finance_entries.csv", emptyHeaders: EMPTY_HEADERS["finance_entries.csv"]!,
      rows: () => paginateRows((cursor, take) => prisma.financeEntry.findMany({ where: { userId }, ...page(cursor, take) })),
    },
    {
      name: "tasks.csv", emptyHeaders: EMPTY_HEADERS["tasks.csv"]!,
      rows: () => paginateRows((cursor, take) => prisma.task.findMany({ where: { userId }, ...page(cursor, take) })),
    },
    {
      name: "reminder_rules.csv", emptyHeaders: EMPTY_HEADERS["reminder_rules.csv"]!,
      rows: () => paginateRows((cursor, take) => prisma.reminderRule.findMany({ where: { userId }, ...page(cursor, take) })),
    },
    {
      name: "notifications.csv", emptyHeaders: EMPTY_HEADERS["notifications.csv"]!,
      rows: () => paginateRows((cursor, take) => prisma.notification.findMany({ where: { userId }, ...page(cursor, take) })),
    },
    {
      name: "animal_genetic_traits.csv", emptyHeaders: EMPTY_HEADERS["animal_genetic_traits.csv"]!,
      rows: () => paginateRows((cursor, take) => prisma.animalGeneticTrait.findMany({ where: { animal: { is: { userId } } }, ...page(cursor, take) })),
    },
    {
      name: "public_shares.csv", emptyHeaders: EMPTY_HEADERS["public_shares.csv"]!,
      rows: () => paginateRows((cursor, take) => prisma.publicShare.findMany({ where: { userId }, ...page(cursor, take) })),
    },
    {
      name: "notification_preferences.csv", emptyHeaders: EMPTY_HEADERS["notification_preferences.csv"]!,
      rows: () => paginateRows((cursor, take) => prisma.notificationPreferences.findMany({ where: { userId }, ...page(cursor, take) })),
    },
    {
      name: "documents.csv", emptyHeaders: EMPTY_HEADERS["documents.csv"]!,
      rows: () => mapRows(
        paginateRows((cursor, take) => prisma.document.findMany({ where: { userId, deletedAt: null }, ...page(cursor, take) })),
        (document) => {
          const fileName = basename(String(document.originalFilename)).replace(/[^A-Za-z0-9 ._()-]/g, "_").slice(0, 160) || "document";
          return {
            id: document.id,
            animalId: document.animalId,
            cycleId: document.cycleId,
            originalFilename: document.originalFilename,
            mimeType: document.mimeType,
            sizeBytes: document.sizeBytes,
            category: document.category,
            note: document.note,
            createdAt: document.createdAt,
            archivePath: includeDocuments ? `documents/${document.id}_${fileName}` : null,
          };
        },
      ),
    },
  ];
}

async function* exportEntries(
  userId: string,
  includeDocuments: boolean,
  createdAt: Date,
): AsyncGenerator<StreamingZipEntry> {
  const readme = Buffer.from(
    `Vivarqo export\nCreated: ${createdAt.toISOString()}\nAccount ID: ${userId}\n\nCSV files include stable IDs and foreign keys. Monetary amounts are in integer cents. Files are UTF-8 with BOM and CRLF line endings.\n`,
    "utf8",
  );
  yield { name: "README.txt", chunks: singleBufferChunk(readme) };

  for (const table of exportTables(userId, includeDocuments)) {
    yield { name: table.name, chunks: csvChunks(table.rows(), table.emptyHeaders) };
  }

  if (!includeDocuments) return;
  const documents = paginateRows((cursor, take) => prisma.document.findMany({
    where: { userId, deletedAt: null },
    select: { id: true, originalFilename: true, storageKey: true },
    ...{
      take,
      orderBy: { id: "asc" as const },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    },
  }));
  for await (const document of documents) {
    const fileName = basename(String(document.originalFilename)).replace(/[^A-Za-z0-9 ._()-]/g, "_").slice(0, 160) || "document";
    const stored = await openPrivateObjectStream(String(document.storageKey), 10 * 1024 * 1024);
    yield { name: `documents/${document.id}_${fileName}`, chunks: stored.stream };
  }
}

const MAX_CONCURRENT_EXPORTS_PER_PROCESS = 2;

export function createExportRouter() {
  const router = Router();
  let activeExports = 0;

  router.post("/", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = z.object({ includeDocuments: z.boolean().optional().default(false) }).strict().safeParse(req.body ?? {});
    if (!input.success) throw new AppError(400, "VALIDATION_ERROR", "Request validation failed");
    if (activeExports >= MAX_CONCURRENT_EXPORTS_PER_PROCESS) {
      throw new AppError(503, "EXPORT_CAPACITY_EXCEEDED", "The server is already generating the maximum number of exports", {
        maxConcurrentExportsPerProcess: MAX_CONCURRENT_EXPORTS_PER_PROCESS,
      });
    }

    activeExports += 1;
    const createdAt = new Date();
    let tempDirectory: string | undefined;
    let storageKey: string | undefined;
    let jobId: string | undefined;
    try {
      const job = await prisma.exportJob.create({
        data: { userId: auth.userId, status: "pending", expiresAt: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000) },
      });
      jobId = job.id;
      tempDirectory = await mkdtemp(join(tmpdir(), "vivarqo-export-"));
      const archivePath = join(tempDirectory, "export.zip");
      await writeStreamingZip(archivePath, exportEntries(auth.userId, input.data.includeDocuments, createdAt), MAX_EXPORT_BYTES);
      storageKey = await storePrivateObjectFromFile("exports", "zip", archivePath);
      const completed = await prisma.exportJob.update({
        where: { id: job.id },
        data: { status: "completed", storageKey },
        select: { id: true, status: true, expiresAt: true, createdAt: true },
      });
      await prisma.auditEvent.create({
        data: { userId: auth.userId, action: "account.export_created", entityType: "export_job", entityId: job.id },
      });
      res.status(201).json({
        export: completed,
        downloadPath: `/api/v1/exports/${job.id}/download`,
        includeDocuments: input.data.includeDocuments,
      });
    } catch (error) {
      if (storageKey) await deletePrivateObject(storageKey).catch(() => undefined);
      if (jobId) {
        await prisma.exportJob.updateMany({
          where: { id: jobId, userId: auth.userId },
          data: { status: "failed", storageKey: null },
        }).catch(() => undefined);
      }
      throw error;
    } finally {
      activeExports -= 1;
      if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  router.get("/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeId(req.params.id);
    const job = await prisma.exportJob.findFirst({
      where: { id, userId: auth.userId },
      select: { id: true, status: true, expiresAt: true, createdAt: true },
    });
    if (!job) throw new AppError(404, "EXPORT_NOT_FOUND", "Export not found");
    res.status(200).json({ export: job, ready: job.status === "completed" && job.expiresAt > new Date() });
  });

  router.get("/:id/download", requireSession, async (req, res, next) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeId(req.params.id);
    const job = await prisma.exportJob.findFirst({ where: { id, userId: auth.userId } });
    if (!job) throw new AppError(404, "EXPORT_NOT_FOUND", "Export not found");
    if (job.status !== "completed" || !job.storageKey || job.expiresAt <= new Date()) {
      throw new AppError(410, "EXPORT_EXPIRED", "The export is not available or has expired");
    }

    const stored = await openPrivateObjectStream(job.storageKey, MAX_EXPORT_BYTES);
    res.setHeader("Content-Type", "application/zip");
    if (stored.sizeBytes !== null) res.setHeader("Content-Length", stored.sizeBytes);
    res.setHeader("Content-Disposition", `attachment; filename="vivarqo-export-${job.id}.zip"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200);

    stored.stream.on("error", (error: Error) => {
      if (res.headersSent) res.destroy(error);
      else next(error);
    });
    res.on("close", () => {
      if (!res.writableEnded) stored.stream.destroy();
    });
    stored.stream.pipe(res);
  });

  return router;
}
