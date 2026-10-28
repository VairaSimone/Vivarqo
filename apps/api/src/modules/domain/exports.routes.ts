import { Router } from "express";
import { basename } from "node:path";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";
import { requireSession, type AuthContext } from "../auth/session.js";
import { deletePrivateObject, readPrivateObject, storePrivateObject } from "./private-storage.js";

type ExportFile = { name: string; content: Buffer };
const MAX_EXPORT_BYTES = 50 * 1024 * 1024;
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function archiveName(name: string): string {
  return name.replace(/^\/+/, "").replace(/\.\.(\/|\\)/g, "");
}
function assertZipSizeWithinLimit(files: ExportFile[]): void {
  // This ZIP writer stores entries uncompressed. Preflight the exact ZIP32
  // envelope (local header, central header, duplicate filename, end record)
  // before allocating the final multi-buffer archive.
  let size = 22;
  for (const file of files) {
    const filenameBytes = Buffer.byteLength(archiveName(file.name), "utf8");
    size += 30 + 46 + filenameBytes * 2 + file.content.length;
    if (size > MAX_EXPORT_BYTES) {
      throw new AppError(413, "EXPORT_TOO_LARGE", "The export exceeds the 50 MB limit");
    }
  }
}
function zipFiles(files: ExportFile[]): Buffer {
  assertZipSizeWithinLimit(files);
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const filename = Buffer.from(archiveName(file.name), "utf8");
    const data = file.content;
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    localParts.push(local, filename, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, filename);
    offset += local.length + filename.length + data.length;
  }
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, central, end]);
}
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let rendered: string;
  if (typeof value === "string") rendered = value;
  else if (typeof value === "bigint") rendered = value.toString();
  else if (value instanceof Date) rendered = value.toISOString();
  else if (typeof value === "object" && value !== null && "toString" in value && value.constructor?.name === "Decimal") rendered = String(value);
  else if (typeof value === "object") rendered = JSON.stringify(value);
  else rendered = String(value);
  // Prefix spreadsheet formula markers even when preceded by whitespace or
  // control characters that some CSV consumers may ignore.
  if (/^[\s\u0000-\u001f]*[=+@\-]/u.test(rendered)) rendered = `'${rendered}`;
  return `"${rendered.replace(/"/g, '""')}"`;
}
function csv(headers: string[], rows: Array<Record<string, unknown>>): Buffer {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(headers.map((key) => csvCell(row[key])).join(","));
  return Buffer.from(`\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
}
function recordRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => entry as Record<string, unknown>);
}
function routeId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id || !z.string().uuid().safeParse(id).success) throw new AppError(400, "INVALID_ID", "Invalid export id");
  return id;
}

export function createExportRouter() {
  const router = Router();

  router.post("/", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = z.object({ includeDocuments: z.boolean().optional().default(false) }).strict().safeParse(req.body ?? {});
    if (!input.success) throw new AppError(400, "VALIDATION_ERROR", "Request validation failed");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const job = await prisma.exportJob.create({ data: { userId: auth.userId, status: "pending", expiresAt } });
    let generatedStorageKey: string | null = null;
    try {
      const [
        animals, feedingSessions, feedingEntries, weights, sheds, notes, cycles, reproductiveEvents,
        clutches, eggs, incubationLogs, offspringBatches, inventoryItems, stockMovements, financeEntries,
        tasks, reminderRules, notifications, geneticTraits, publicShares, notificationPreferences, documents,
      ] = await Promise.all([
        prisma.animal.findMany({ where: { userId: auth.userId }, orderBy: { createdAt: "asc" } }),
        prisma.feedingSession.findMany({ where: { userId: auth.userId }, orderBy: { performedAt: "asc" } }),
        prisma.feedingEntry.findMany({ where: { session: { is: { userId: auth.userId } }, animal: { is: { userId: auth.userId } } }, orderBy: { createdAt: "asc" } }),
        prisma.weightMeasurement.findMany({ where: { animal: { is: { userId: auth.userId } } }, orderBy: { measuredAt: "asc" } }),
        prisma.shedRecord.findMany({ where: { animal: { is: { userId: auth.userId } } }, orderBy: { occurredAt: "asc" } }),
        prisma.animalNote.findMany({ where: { animal: { is: { userId: auth.userId } } }, orderBy: { occurredAt: "asc" } }),
        prisma.reproductionCycle.findMany({ where: { userId: auth.userId }, orderBy: { startedOn: "asc" } }),
        prisma.reproductiveEvent.findMany({ where: { cycle: { is: { userId: auth.userId } } }, orderBy: { occurredAt: "asc" } }),
        prisma.clutch.findMany({ where: { cycle: { is: { userId: auth.userId } } }, orderBy: { laidOn: "asc" } }),
        prisma.egg.findMany({ where: { clutch: { is: { cycle: { is: { userId: auth.userId } } } } }, orderBy: { createdAt: "asc" } }),
        prisma.incubationLog.findMany({ where: { clutch: { is: { cycle: { is: { userId: auth.userId } } } } }, orderBy: { recordedAt: "asc" } }),
        prisma.offspringBatch.findMany({ where: { cycle: { is: { userId: auth.userId } } }, orderBy: { bornOn: "asc" } }),
        prisma.inventoryItem.findMany({ where: { userId: auth.userId }, orderBy: { createdAt: "asc" } }),
        prisma.stockMovement.findMany({ where: { item: { is: { userId: auth.userId } } }, orderBy: { occurredAt: "asc" } }),
        prisma.financeEntry.findMany({ where: { userId: auth.userId }, orderBy: { occurredOn: "asc" } }),
        prisma.task.findMany({ where: { userId: auth.userId }, orderBy: { dueAt: "asc" } }),
        prisma.reminderRule.findMany({ where: { userId: auth.userId }, orderBy: { nextDueAt: "asc" } }),
        prisma.notification.findMany({ where: { userId: auth.userId }, orderBy: { createdAt: "asc" } }),
        prisma.animalGeneticTrait.findMany({ where: { animal: { is: { userId: auth.userId } } }, orderBy: { createdAt: "asc" } }),
        prisma.publicShare.findMany({ where: { userId: auth.userId }, orderBy: { createdAt: "asc" } }),
        prisma.notificationPreferences.findMany({ where: { userId: auth.userId } }),
        prisma.document.findMany({ where: { userId: auth.userId, deletedAt: null }, orderBy: { createdAt: "asc" } }),
      ]);

      const tableRows: Array<{ name: string; rows: Array<Record<string, unknown>>; headers?: string[] }> = [
        { name: "animals.csv", rows: recordRows(animals) },
        { name: "feeding_sessions.csv", rows: recordRows(feedingSessions) },
        { name: "feeding_entries.csv", rows: recordRows(feedingEntries) },
        { name: "weights.csv", rows: recordRows(weights) },
        { name: "sheds.csv", rows: recordRows(sheds) },
        { name: "animal_notes.csv", rows: recordRows(notes) },
        { name: "reproduction_cycles.csv", rows: recordRows(cycles) },
        { name: "reproductive_events.csv", rows: recordRows(reproductiveEvents) },
        { name: "clutches.csv", rows: recordRows(clutches) },
        { name: "eggs.csv", rows: recordRows(eggs) },
        { name: "incubation_logs.csv", rows: recordRows(incubationLogs) },
        { name: "offspring_batches.csv", rows: recordRows(offspringBatches) },
        { name: "inventory_items.csv", rows: recordRows(inventoryItems) },
        { name: "stock_movements.csv", rows: recordRows(stockMovements) },
        { name: "finance_entries.csv", rows: recordRows(financeEntries).map((entry) => ({ ...entry, amountCents: String(entry.amountCents) })) },
        { name: "tasks.csv", rows: recordRows(tasks) },
        { name: "reminder_rules.csv", rows: recordRows(reminderRules) },
        { name: "notifications.csv", rows: recordRows(notifications) },
        { name: "animal_genetic_traits.csv", rows: recordRows(geneticTraits) },
        { name: "public_shares.csv", rows: recordRows(publicShares) },
        { name: "notification_preferences.csv", rows: recordRows(notificationPreferences) },
        {
          name: "documents.csv",
          rows: recordRows(documents).map((document) => {
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
              archivePath: input.data.includeDocuments ? `documents/${document.id}_${fileName}` : null,
            };
          }),
        },
      ];
      const emptyHeaders: Record<string, string[]> = {
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
      const files: ExportFile[] = tableRows.map((table) => {
        // Every row in a table comes from the same Prisma model (or the same
        // explicit document projection), so its first row already defines the
        // complete header set. Avoid allocating an intermediate array of keys
        // for every exported row.
        const derivedHeaders = Object.keys(table.rows[0] ?? {});
        const headers = table.headers ?? (derivedHeaders.length > 0 ? derivedHeaders : (emptyHeaders[table.name] ?? []));
        return { name: table.name, content: csv(headers, table.rows) };
      });
      files.unshift({
        name: "README.txt",
        content: Buffer.from(
          `Vivarqo export\nCreated: ${new Date().toISOString()}\nAccount ID: ${auth.userId}\n\nCSV files include stable IDs and foreign keys. Monetary amounts are in integer cents. Files are UTF-8 with BOM and CRLF line endings.\n`,
          "utf8",
        ),
      });
      // Fail before loading document objects or allocating the final ZIP when
      // the CSV portion already exceeds the response/archive budget.
      assertZipSizeWithinLimit(files);
      if (input.data.includeDocuments) {
        for (const document of documents) {
          const fileName = basename(document.originalFilename).replace(/[^A-Za-z0-9 ._()-]/g, "_").slice(0, 160) || "document";
          const bytes = await readPrivateObject(document.storageKey);
          files.push({ name: `documents/${document.id}_${fileName}`, content: bytes });
          assertZipSizeWithinLimit(files);
        }
      }
      const zip = zipFiles(files);
      const storageKey = await storePrivateObject("exports", "zip", zip);
      generatedStorageKey = storageKey;
      const completed = await prisma.exportJob.update({
        where: { id: job.id },
        data: { status: "completed", storageKey },
        select: { id: true, status: true, expiresAt: true, createdAt: true },
      });
      await prisma.auditEvent.create({ data: { userId: auth.userId, action: "account.export_created", entityType: "export_job", entityId: job.id } });
      res.status(201).json({ export: completed, downloadPath: `/api/v1/exports/${job.id}/download`, includeDocuments: input.data.includeDocuments });
    } catch (error) {
      // If the database update or audit record fails after object upload, clean
      // up the orphaned archive and remove its stale reference from the job.
      if (generatedStorageKey) {
        await deletePrivateObject(generatedStorageKey).catch(() => undefined);
      }
      await prisma.exportJob.updateMany({
        where: { id: job.id, userId: auth.userId },
        data: { status: "failed", storageKey: null },
      }).catch(() => undefined);
      throw error;
    }
  });

  router.get("/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeId(req.params.id);
    const job = await prisma.exportJob.findFirst({ where: { id, userId: auth.userId }, select: { id: true, status: true, expiresAt: true, createdAt: true } });
    if (!job) throw new AppError(404, "EXPORT_NOT_FOUND", "Export not found");
    res.status(200).json({ export: job, ready: job.status === "completed" && job.expiresAt > new Date() });
  });

  router.get("/:id/download", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeId(req.params.id);
    const job = await prisma.exportJob.findFirst({ where: { id, userId: auth.userId } });
    if (!job) throw new AppError(404, "EXPORT_NOT_FOUND", "Export not found");
    if (job.status !== "completed" || !job.storageKey || job.expiresAt <= new Date()) throw new AppError(410, "EXPORT_EXPIRED", "The export is not available or has expired");
    const data = await readPrivateObject(job.storageKey);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Length", data.length);
    res.setHeader("Content-Disposition", `attachment; filename="vivarqo-export-${job.id}.zip"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).send(data);
  });

  return router;
}
