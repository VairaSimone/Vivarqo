import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { requireSession, type AuthContext } from "../auth/session.js";
import { deletePrivateObject, openPrivateObjectStream, storePrivateObjectFromFile } from "./private-storage.js";
import { singleBufferChunk, writeStreamingZip, type StreamingZipEntry } from "./streaming-zip.js";

const EXPORT_PAGE_SIZE = 250;

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
  if (/^[\u0000-\u0020]*[=+@\-]/.test(rendered) || /^[\t\r]/.test(rendered)) rendered = "'" + rendered;
  return "\"" + rendered.replace(/"/g, '\"\"') + "\"";
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
        "animals.csv": ["id", "userId", "name", "identifier", "species", "sex", "morph", "geneticsNotes", "birthDate", "birthDateEstimated", "acquiredDate", "originDescription", "previousBreeder", "locationLabel", "status", "notes", "photoKey", "photoArchivePath", "originClutchId", "originOffspringBatchId", "archivedAt", "createdAt", "updatedAt"],
        "feeding_sessions.csv": ["id", "userId", "performedAt", "notes", "createdAt", "updatedAt"],
        "feeding_entries.csv": ["id", "sessionId", "animalId", "outcome", "foodType", "foodSize", "foodWeightG", "notes", "createdAt", "updatedAt"],
        "weights.csv": ["id", "animalId", "measuredAt", "weightG", "notes", "createdAt", "updatedAt"],
        "sheds.csv": ["id", "animalId", "occurredAt", "outcome", "notes", "createdAt", "updatedAt"],
        "animal_notes.csv": ["id", "animalId", "occurredAt", "title", "category", "body", "createdAt", "updatedAt", "archivedAt"],
        "reproduction_cycles.csv": ["id", "userId", "parentAAnimalId", "parentBAnimalId", "name", "startedOn", "endedOn", "status", "notes", "createdAt", "updatedAt"],
        "reproductive_events.csv": ["id", "cycleId", "eventType", "occurredAt", "animalId", "details", "temperatureC", "humidityPct", "createdAt", "updatedAt"],
        "clutches.csv": ["id", "cycleId", "laidOn", "eggCount", "status", "incubatorLabel", "incubationStartedAt", "notes", "createdAt", "updatedAt"],
        "eggs.csv": ["id", "clutchId", "code", "status", "notes", "createdAt", "updatedAt", "photoArchivePath"],
        "incubation_logs.csv": ["id", "clutchId", "recordedAt", "temperatureC", "humidityPct", "eventType", "notes", "createdAt", "updatedAt"],
        "offspring_batches.csv": ["id", "cycleId", "clutchId", "bornOn", "count", "notes", "createdAt", "updatedAt"],
        "inventory_items.csv": ["id", "userId", "name", "category", "unit", "quantityOnHand", "minimumQuantity", "notes", "isActive", "createdAt", "updatedAt"],
        "inventory_suppliers.csv": ["id", "userId", "name", "email", "phone", "website", "notes", "createdAt", "updatedAt"],
        "inventory_lots.csv": ["id", "itemId", "supplierId", "lotCode", "quantityReceived", "quantityRemaining", "unitCostCents", "purchasedAt", "expiresAt", "notes", "createdAt"],
        "stock_movements.csv": ["id", "itemId", "movementType", "quantity", "unitCostCents", "occurredAt", "reference", "notes", "createdAt"],
        "finance_entries.csv": ["id", "userId", "animalId", "documentId", "reproductionCycleId", "clutchId", "offspringBatchId", "recurrenceId", "entryType", "occurredOn", "amountCents", "currency", "category", "description", "createdAt", "updatedAt"],
        "finance_budgets.csv": ["id", "userId", "period", "periodStart", "category", "amountCents", "currency", "createdAt", "updatedAt"],
        "finance_recurrences.csv": ["id", "userId", "entryType", "amountCents", "currency", "category", "description", "animalId", "documentId", "frequency", "nextOccurrenceOn", "anchorMonth", "anchorDay", "endOn", "isActive", "createdAt", "updatedAt"],
        "tasks.csv": ["id", "userId", "animalId", "title", "description", "category", "dueAt", "status", "completedAt", "reminderRuleId", "createdAt", "updatedAt"],
        "reminder_rules.csv": ["id", "userId", "animalId", "title", "category", "intervalDays", "nextDueAt", "isEnabled", "createdAt", "updatedAt"],
        "notifications.csv": ["id", "userId", "category", "title", "body", "targetPath", "readAt", "createdAt"],
        "animal_genetic_traits.csv": ["id", "animalId", "traitName", "traitValue", "sourceAnimalId", "confidenceNote", "createdAt", "updatedAt"],
        "public_shares.csv": ["id", "userId", "animalId", "slug", "visibleFields", "publicDescription", "isEnabled", "revokedAt", "createdAt", "updatedAt"],
        "notification_preferences.csv": ["id", "userId", "inAppEnabled", "pushEnabled", "categories", "quietHoursStart", "quietHoursEnd", "createdAt", "updatedAt"],
        "documents.csv": ["id", "animalId", "cycleId", "originalFilename", "mimeType", "sizeBytes", "category", "note", "createdAt", "archivePath"],
};

function exportTables(userId: string, includeDocuments: boolean, modules: string[]): ExportTable[] {
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
      rows: () => mapRows(
        paginateRows((cursor, take) => prisma.animal.findMany({ where: { userId }, ...page(cursor, take) })),
        (animal) => ({
          ...animal,
          photoArchivePath: animal.photoKey ? `animal-photos/${animal.id}.${String(animal.photoKey).split(".").pop()}` : null,
          photoKey: null,
        }),
      ),
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
      name: "inventory_suppliers.csv", emptyHeaders: EMPTY_HEADERS["inventory_suppliers.csv"]!,
      rows: () => paginateRows((cursor, take) => prisma.inventorySupplier.findMany({ where: { userId }, ...page(cursor, take) })),
    },
    {
      name: "inventory_lots.csv", emptyHeaders: EMPTY_HEADERS["inventory_lots.csv"]!,
      rows: () => paginateRows((cursor, take) => prisma.inventoryLot.findMany({ where: { item: { is: { userId } } }, ...page(cursor, take) })),
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
      name: "finance_budgets.csv", emptyHeaders: EMPTY_HEADERS["finance_budgets.csv"]!,
      rows: () => paginateRows((cursor, take) => prisma.financeBudget.findMany({ where: { userId }, ...page(cursor, take) })),
    },
    {
      name: "finance_recurrences.csv", emptyHeaders: EMPTY_HEADERS["finance_recurrences.csv"]!,
      rows: () => paginateRows((cursor, take) => prisma.financeRecurrence.findMany({ where: { userId }, ...page(cursor, take) })),
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
  const fullBackup = ["animals", "feedings", "reproduction", "finance", "inventory"].every((module) => modules.includes(module));
  const moduleByFile: Record<string, string> = {
    "animals.csv": "animals", "animal_genetic_traits.csv": "animals", "public_shares.csv": "animals",
    "feeding_sessions.csv": "feedings", "feeding_entries.csv": "feedings", "weights.csv": "feedings",
    "sheds.csv": "feedings", "animal_notes.csv": "feedings", "tasks.csv": "feedings",
    "reminder_rules.csv": "feedings", "notifications.csv": "feedings", "notification_preferences.csv": "feedings",
    "reproduction_cycles.csv": "reproduction", "reproductive_events.csv": "reproduction", "clutches.csv": "reproduction",
    "eggs.csv": "reproduction", "incubation_logs.csv": "reproduction", "offspring_batches.csv": "reproduction",
    "finance_entries.csv": "finance", "finance_budgets.csv": "finance", "finance_recurrences.csv": "finance",
    "inventory_items.csv": "inventory", "inventory_suppliers.csv": "inventory", "inventory_lots.csv": "inventory",
    "stock_movements.csv": "inventory",
  };
  return tables.filter((table) => {
    if (table.name === "account.csv" || table.name === "subscriptions.csv") return fullBackup;
    if (table.name === "documents.csv") return modules.includes("animals") || modules.includes("reproduction");
    return modules.includes(moduleByFile[table.name] ?? "");
  });
}

async function* exportEntries(
  userId: string,
  includeDocuments: boolean,
  modules: string[],
  createdAt: Date,
): AsyncGenerator<StreamingZipEntry> {
  const readme = Buffer.from(
    `Vivarqo export\nCreated: ${createdAt.toISOString()}\nAccount ID: ${userId}\n\nCSV files include stable IDs and foreign keys. Monetary amounts are in integer cents. Files are UTF-8 with BOM and CRLF line endings.\nThe archive contains manifest.json with SHA-256 checksums for every exported CSV and attachment. Verify these checksums before restoring data.\n`,
    "utf8",
  );
  yield { name: "README.txt", chunks: singleBufferChunk(readme) };

  const checksums: Record<string, string> = {};
  for (const table of exportTables(userId, includeDocuments, modules)) {
    const digest = createHash("sha256");
    const chunks = (async function* () {
      for await (const chunk of csvChunks(table.rows(), table.emptyHeaders)) {
        digest.update(chunk);
        yield chunk;
      }
      checksums[table.name] = digest.digest("hex");
    })();
    yield { name: table.name, chunks };
  }

  if (modules.includes("animals")) {
    const animals = paginateRows((cursor, take) => prisma.animal.findMany({
      where: { userId, photoKey: { not: null } }, select: { id: true, photoKey: true }, ...{
        take, orderBy: { id: "asc" as const }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      },
    }));
    for await (const animal of animals) {
      const key = String(animal.photoKey);
      const extension = key.split(".").pop() || "jpg";
      const archiveName = `animal-photos/${animal.id}.${extension}`;
      const stored = await openPrivateObjectStream(key, 5 * 1024 * 1024);
      const digest = createHash("sha256");
      const chunks = (async function* () {
        for await (const raw of stored.stream) {
          const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
          digest.update(chunk); yield chunk;
        }
        checksums[archiveName] = digest.digest("hex");
      })();
      yield { name: archiveName, chunks };
    }
  }
  if (modules.includes("reproduction")) {
    const eggs = paginateRows((cursor, take) => prisma.egg.findMany({
      where: { clutch: { is: { cycle: { is: { userId } } } }, photoKey: { not: null } },
      select: { id: true, photoKey: true }, ...{
        take, orderBy: { id: "asc" as const }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      },
    }));
    for await (const egg of eggs) {
      const key = String(egg.photoKey);
      const extension = key.split(".").pop() || "jpg";
      const archiveName = `egg-photos/${egg.id}.${extension}`;
      const stored = await openPrivateObjectStream(key, 5 * 1024 * 1024);
      const digest = createHash("sha256");
      const chunks = (async function* () {
        for await (const raw of stored.stream) {
          const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
          digest.update(chunk); yield chunk;
        }
        checksums[archiveName] = digest.digest("hex");
      })();
      yield { name: archiveName, chunks };
    }
  }

  if (!includeDocuments || (!modules.includes("animals") && !modules.includes("reproduction"))) {
    const manifest = {
      format: "vivarqo-account-backup", formatVersion: 1, createdAt: createdAt.toISOString(),
      accountId: userId, modules, includeDocuments: false, checksums,
    };
    yield { name: "manifest.json", chunks: singleBufferChunk(Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8")) };
    return;
  }
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
    const archiveName = `documents/${document.id}_${fileName}`;
    const digest = createHash("sha256");
    const chunks = (async function* () {
      for await (const raw of stored.stream) {
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        digest.update(chunk);
        yield chunk;
      }
      checksums[archiveName] = digest.digest("hex");
    })();
    yield { name: archiveName, chunks };
  }
  const manifest = {
    format: "vivarqo-account-backup", formatVersion: 1, createdAt: createdAt.toISOString(),
    accountId: userId, modules, includeDocuments: true, checksums,
  };
  yield { name: "manifest.json", chunks: singleBufferChunk(Buffer.from(JSON.stringify(manifest, null, 2) + "\\n", "utf8")) };
}

/**
 * Runs outside the HTTP request after a PostgreSQL worker has acquired the job lease.
 */
export async function processQueuedExportJob(jobId: string, userId: string, leaseToken: string): Promise<void> {
  const job = await prisma.exportJob.findFirst({
    where: { id: jobId, userId, status: "processing", leaseToken },
    select: { id: true, userId: true, createdAt: true, includeDocuments: true, modules: true },
  });
  if (!job) return;

  let temporaryDirectory: string | undefined;
  let storageKey: string | undefined;
  try {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "vivarqo-export-"));
    const archivePath = join(temporaryDirectory, "export.zip");
    await writeStreamingZip(archivePath, exportEntries(job.userId, job.includeDocuments, job.modules, job.createdAt));
    storageKey = await storePrivateObjectFromFile("exports", "zip", archivePath);
    await prisma.$transaction(async (tx) => {
      const completed = await tx.exportJob.updateMany({
        where: { id: job.id, userId: job.userId, status: "processing", leaseToken, expiresAt: { gt: new Date() } },
        data: { status: "completed", storageKey, processingStartedAt: null, leaseToken: null, lastErrorCode: null },
      });
      if (completed.count !== 1) throw new Error("Export processing lease was lost before commit");
      await tx.auditEvent.create({
        data: { userId: job.userId, action: "account.export_created", entityType: "export_job", entityId: job.id },
      });
    });
    storageKey = undefined;
  } catch (error) {
    if (storageKey) await deletePrivateObject(storageKey).catch(() => undefined);
    throw error;
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function createExportRouter() {
  const router = Router();
  router.post("/", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = z.object({
      includeDocuments: z.boolean().optional().default(false),
      modules: z.array(z.enum(["animals", "feedings", "reproduction", "finance", "inventory"])).min(1).max(5).default(["animals", "feedings", "reproduction", "finance", "inventory"]),
    }).strict().safeParse(req.body ?? {});
    if (!input.success) throw new AppError(400, "VALIDATION_ERROR", "Request validation failed");

    const job = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`WITH lock_acquired AS MATERIALIZED (
        SELECT pg_advisory_xact_lock(hashtextextended(${"vivarqo:export-limit:" + auth.userId}, 0))
      )
      SELECT TRUE AS acquired FROM lock_acquired`;
      const activeJobs = await tx.exportJob.count({
        where: { userId: auth.userId, status: { in: ["pending", "processing"] }, expiresAt: { gt: new Date() } },
      });
      if (activeJobs >= 2) throw new AppError(429, "EXPORT_QUEUE_LIMIT", "At most two exports can be queued or running for one account");
      const createdAt = new Date();
      return tx.exportJob.create({
        data: {
          userId: auth.userId, status: "pending", includeDocuments: input.data.includeDocuments, modules: [...new Set(input.data.modules)],
          expiresAt: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000),
        },
        select: { id: true, status: true, expiresAt: true, createdAt: true, includeDocuments: true, modules: true },
      });
    });
    res.status(202).json({
      export: job, ready: false,
      downloadPath: `/api/v1/exports/${job.id}/download`,
      includeDocuments: job.includeDocuments,
      modules: job.modules,
    });
  });

  router.get("/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeId(req.params.id);
    const job = await prisma.exportJob.findFirst({
      where: { id, userId: auth.userId },
      select: { id: true, status: true, expiresAt: true, createdAt: true, includeDocuments: true, modules: true, attempts: true, lastErrorCode: true },
    });
    if (!job) throw new AppError(404, "EXPORT_NOT_FOUND", "Export not found");
    res.status(200).json({ export: job, ready: job.status === "completed" && job.expiresAt > new Date() });
  });

  router.get("/:id/download", requireSession, async (req, res, next) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeId(req.params.id);
    const job = await prisma.exportJob.findFirst({ where: { id, userId: auth.userId } });
    if (!job) throw new AppError(404, "EXPORT_NOT_FOUND", "Export not found");
    if (job.expiresAt <= new Date() || job.status === "expired") {
      throw new AppError(410, "EXPORT_EXPIRED", "The export is not available or has expired");
    }
    if (job.status === "failed") throw new AppError(409, "EXPORT_FAILED", "The export could not be generated; request a new export");
    if (job.status !== "completed" || !job.storageKey) throw new AppError(409, "EXPORT_NOT_READY", "The export is still being generated");

    const stored = await openPrivateObjectStream(job.storageKey, env.EXPORT_MAX_ARCHIVE_BYTES);
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
