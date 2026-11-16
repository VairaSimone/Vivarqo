import { createHash } from "node:crypto";
import { Router, raw } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";
import { persistentRateLimit } from "../../middleware/persistent-rate-limit.js";
import { requireSession, type AuthContext } from "../auth/session.js";
import { deletePrivateObject, storePrivateObject, validatePrivateFile } from "./private-storage.js";

const MAX_ENTRIES = 20_000;
const MAX_ROWS = 100_000;
const MAX_ENTRY_BYTES = env.EXPORT_MAX_ARCHIVE_BYTES;
const FULL_MODULES = ["animals", "feedings", "reproduction", "finance", "inventory"];

type ArchiveEntry = { name: string; bytes: Buffer };
type CsvRow = Record<string, string>;

function fail(code: string, message: string, status = 400): never {
  throw new AppError(status, code, message);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function safeArchiveName(name: string): boolean {
  const parts = name.replace(/\\\\/g, "/").split("/");
  return Boolean(name) && !name.startsWith("/") && !name.includes("\\0") &&
    !parts.some((part) => !part || part === "." || part === "..");
}

/** Reads the uncompressed ZIP64 format emitted by Vivarqo's streaming ZIP writer. */
function readBackupZip(archive: Buffer): ArchiveEntry[] {
  if (archive.length < 98 || archive.length > env.EXPORT_MAX_ARCHIVE_BYTES) fail("BACKUP_SIZE_INVALID", "Backup archive size is invalid", 413);
  const classicEocd = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (classicEocd < 20) fail("BACKUP_ZIP_INVALID", "ZIP end record is missing");
  const locatorOffset = classicEocd - 20;
  if (archive.readUInt32LE(locatorOffset) !== 0x07064b50) fail("BACKUP_ZIP_UNSUPPORTED", "Only Vivarqo ZIP64 backups are supported");
  const zip64OffsetBig = archive.readBigUInt64LE(locatorOffset + 8);
  if (zip64OffsetBig > BigInt(Number.MAX_SAFE_INTEGER)) fail("BACKUP_ZIP_INVALID", "ZIP directory offset is invalid");
  const zip64Offset = Number(zip64OffsetBig);
  if (archive.readUInt32LE(zip64Offset) !== 0x06064b50) fail("BACKUP_ZIP_INVALID", "ZIP64 directory record is invalid");
  const countBig = archive.readBigUInt64LE(zip64Offset + 32);
  const centralSizeBig = archive.readBigUInt64LE(zip64Offset + 40);
  const centralOffsetBig = archive.readBigUInt64LE(zip64Offset + 48);
  if (countBig > BigInt(MAX_ENTRIES) || centralSizeBig > BigInt(archive.length) || centralOffsetBig > BigInt(archive.length)) {
    fail("BACKUP_ZIP_LIMIT", "Backup contains too many files or invalid directory offsets", 413);
  }
  const count = Number(countBig), centralSize = Number(centralSizeBig), centralOffset = Number(centralOffsetBig);
  if (centralOffset + centralSize > archive.length) fail("BACKUP_ZIP_INVALID", "ZIP directory exceeds archive bounds");
  const entries: ArchiveEntry[] = [];
  const names = new Set<string>();
  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > centralOffset + centralSize || archive.readUInt32LE(offset) !== 0x02014b50) {
      fail("BACKUP_ZIP_INVALID", "ZIP central directory entry is invalid");
    }
    const flags = archive.readUInt16LE(offset + 8);
    const method = archive.readUInt16LE(offset + 10);
    const crc = archive.readUInt32LE(offset + 16);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const extraStart = nameStart + nameLength;
    const nextOffset = extraStart + extraLength + commentLength;
    if (nextOffset > centralOffset + centralSize || (flags & 0x0001) !== 0 || (flags & ~0x0808) !== 0 || method !== 0) {
      fail("BACKUP_ZIP_UNSUPPORTED", "Backup uses unsupported ZIP features");
    }
    const name = archive.subarray(nameStart, nameStart + nameLength).toString("utf8");
    if (!safeArchiveName(name) || names.has(name)) fail("BACKUP_ZIP_INVALID", "Backup contains an unsafe or duplicate file path");
    names.add(name);
    const extra = archive.subarray(extraStart, extraStart + extraLength);
    let compressedSize = archive.readUInt32LE(offset + 20);
    let uncompressedSize = archive.readUInt32LE(offset + 24);
    let localOffset = archive.readUInt32LE(offset + 42);
    if (compressedSize === 0xffff_ffff || uncompressedSize === 0xffff_ffff || localOffset === 0xffff_ffff) {
      let cursor = 0, found = false;
      while (cursor + 4 <= extra.length) {
        const id = extra.readUInt16LE(cursor), length = extra.readUInt16LE(cursor + 2);
        const start = cursor + 4;
        if (start + length > extra.length) fail("BACKUP_ZIP_INVALID", "ZIP64 extra field is invalid");
        if (id === 0x0001) {
          let p = start;
          if (uncompressedSize === 0xffff_ffff) { uncompressedSize = Number(extra.readBigUInt64LE(p)); p += 8; }
          if (compressedSize === 0xffff_ffff) { compressedSize = Number(extra.readBigUInt64LE(p)); p += 8; }
          if (localOffset === 0xffff_ffff) localOffset = Number(extra.readBigUInt64LE(p));
          found = true; break;
        }
        cursor = start + length;
      }
      if (!found) fail("BACKUP_ZIP_INVALID", "ZIP64 size information is missing");
    }
    if (!Number.isSafeInteger(uncompressedSize) || !Number.isSafeInteger(compressedSize) ||
        uncompressedSize !== compressedSize || uncompressedSize > MAX_ENTRY_BYTES) {
      fail("BACKUP_ENTRY_LIMIT", "Backup entry is too large or compressed unexpectedly", 413);
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > env.EXPORT_MAX_ARCHIVE_BYTES) fail("BACKUP_SIZE_INVALID", "Backup expands beyond the configured size limit", 413);
    if (localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== 0x04034b50) fail("BACKUP_ZIP_INVALID", "ZIP local header is invalid");
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > archive.length) fail("BACKUP_ZIP_INVALID", "ZIP entry exceeds archive bounds");
    const bytes = archive.subarray(dataStart, dataEnd);
    if (crc32(bytes) !== crc) fail("BACKUP_CHECKSUM_MISMATCH", "A ZIP entry failed its CRC check");
    entries.push({ name, bytes });
    offset = nextOffset;
  }
  return entries;
}

function parseCsv(bytes: Buffer): CsvRow[] {
  let source = bytes.toString("utf8").replace(/^\\uFEFF/, "");
  if (source.includes("\\0")) fail("BACKUP_CSV_INVALID", "CSV contains invalid null characters");
  const matrix: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!;
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\\n") { row.push(cell.replace(/\\r$/, "")); matrix.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (quoted) fail("BACKUP_CSV_INVALID", "CSV contains an unterminated quoted field");
  if (cell.length || row.length) { row.push(cell.replace(/\\r$/, "")); matrix.push(row); }
  while (matrix.length && matrix[matrix.length - 1]!.every((value) => value === "")) matrix.pop();
  if (!matrix.length) return [];
  const headers = matrix[0]!;
  if (!headers.length || headers.some((header) => !header) || new Set(headers).size !== headers.length) {
    fail("BACKUP_CSV_INVALID", "CSV headers are missing or duplicated");
  }
  return matrix.slice(1).map((values) => {
    if (values.length !== headers.length) fail("BACKUP_CSV_INVALID", "CSV row has a different number of columns than its header");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function sha256(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function snakeCase(value: string): string { return value.replace(/[A-Z]/g, (letter) => "_" + letter.toLowerCase()); }

const TABLES = [
  { file: "animals.csv", table: "animals", deferred: ["motherAnimalId", "fatherAnimalId", "originClutchId", "originOffspringBatchId"], user: true },
  { file: "feeding_sessions.csv", table: "feeding_sessions", user: true },
  { file: "reproduction_cycles.csv", table: "reproduction_cycles", user: true },
  { file: "inventory_suppliers.csv", table: "inventory_suppliers", user: true },
  { file: "inventory_items.csv", table: "inventory_items", user: true },
  { file: "reminder_rules.csv", table: "reminder_rules", user: true },
  { file: "weights.csv", table: "weight_measurements" },
  { file: "sheds.csv", table: "shed_records" },
  { file: "animal_notes.csv", table: "animal_notes" },
  { file: "reproductive_events.csv", table: "reproductive_events" },
  { file: "clutches.csv", table: "clutches" },
  { file: "eggs.csv", table: "eggs" },
  { file: "incubation_logs.csv", table: "incubation_logs" },
  { file: "offspring_batches.csv", table: "offspring_batches" },
  { file: "inventory_lots.csv", table: "inventory_lots" },
  { file: "stock_movements.csv", table: "stock_movements" },
  { file: "documents.csv", table: "documents", user: true },
  { file: "finance_recurrences.csv", table: "finance_recurrences", user: true },
  { file: "finance_budgets.csv", table: "finance_budgets", user: true },
  { file: "finance_entries.csv", table: "finance_entries", user: true },
  { file: "feeding_entries.csv", table: "feeding_entries" },
  { file: "tasks.csv", table: "tasks", user: true },
  { file: "notifications.csv", table: "notifications", user: true },
  { file: "animal_genetic_traits.csv", table: "animal_genetic_traits" },
  { file: "public_shares.csv", table: "public_shares", user: true },
  { file: "notification_preferences.csv", table: "notification_preferences", user: true },
] as const;

type TableSpec = { file: string; table: string; user?: boolean; deferred?: readonly string[] };
type ColumnInfo = { column_name: string; data_type: string; udt_name: string };

function normalizeCell(value: string, column: ColumnInfo): unknown {
  if (value === "") return null;
  if (column.data_type === "time without time zone" || column.data_type === "time with time zone") {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) fail("BACKUP_VALUE_INVALID", "Backup contains an invalid time value");
    return parsed.toISOString().slice(11, 23);
  }
  if (column.data_type === "boolean") {
    if (value === "true" || value === "t" || value === "1") return true;
    if (value === "false" || value === "f" || value === "0") return false;
    fail("BACKUP_VALUE_INVALID", "Backup contains an invalid boolean value");
  }
  if (column.data_type === "json" || column.data_type === "jsonb") {
    try { return JSON.stringify(JSON.parse(value)); }
    catch { fail("BACKUP_VALUE_INVALID", "Backup contains invalid JSON data"); }
  }
  if (column.data_type === "ARRAY") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!Array.isArray(parsed)) fail("BACKUP_VALUE_INVALID", "Backup contains an invalid array value");
      return "{" + parsed.map((entry) => String(entry).replace(/[{},"]/g, "")).join(",") + "}";
    } catch { fail("BACKUP_VALUE_INVALID", "Backup contains invalid array data"); }
  }
  return value;
}

async function insertRows(
  tx: Pick<typeof prisma, "$executeRawUnsafe">,
  spec: TableSpec,
  rows: CsvRow[],
  ownerId: string,
  sourceOwnerId: string,
  columnsByTable: Map<string, ColumnInfo[]>,
  documentKeys: Map<string, string>,
): Promise<number> {
  const columns = columnsByTable.get(spec.table) ?? [];
  const columnByName = new Map(columns.map((column) => [column.column_name, column]));
  let count = 0;
  for (const row of rows) {
    const id = row.id;
    if (!id || !z.string().uuid().safeParse(id).success) fail("BACKUP_ROW_ID_INVALID", "Backup contains a row with an invalid ID");
    if (spec.user && row.userId !== sourceOwnerId) fail("BACKUP_OWNER_MISMATCH", "A backup row belongs to a different source account");
    const names: string[] = [], values: unknown[] = [];
    for (const [field, rawValue] of Object.entries(row)) {
      if (field === "archivePath" || field === "photoArchivePath" || (spec.deferred ?? []).includes(field)) continue;
      if (field === "locationId" || field === "incubatorId" || field === "locusId" || field === "healthRecordId" || field === "sourceTransferId") {
        if (rawValue) fail("BACKUP_RELATION_UNSUPPORTED", "This backup contains relationships to data not included in its archive");
        continue;
      }
      if (field === "photoKey") {
        if (rawValue) fail("BACKUP_ATTACHMENT_MISSING", "Backup references a photo without an archived photo file");
        continue;
      }
      const columnName = snakeCase(field);
      const column = columnByName.get(columnName);
      if (!column) fail("BACKUP_SCHEMA_MISMATCH", "Backup contains a field that is not supported by this database schema");
      names.push(columnName);
      if (field === "userId") values.push(ownerId);
      else values.push(normalizeCell(rawValue, column));
    }
    if (row.photoArchivePath) {
      const key = documentKeys.get(row.photoArchivePath);
      if (!key) fail("BACKUP_ATTACHMENT_MISSING", "A referenced animal or egg photo is missing from the backup");
      names.push("photo_key"); values.push(key);
    }
    if (!names.includes("id")) fail("BACKUP_ROW_ID_INVALID", "Backup row is missing its ID");
    if (spec.user && !names.includes("user_id")) {
      names.push("user_id"); values.push(ownerId);
    }
    if (spec.table === "documents") {
      const archivePath = row.archivePath;
      const storageKey = archivePath ? documentKeys.get(archivePath) : undefined;
      if (!storageKey) fail("BACKUP_ATTACHMENT_MISSING", "A document attachment is missing from the backup");
      names.push("storage_key"); values.push(storageKey);
    }
    const placeholders = values.map((_, index) => "$" + (index + 1)).join(", ");
    const sql = `INSERT INTO "${spec.table}" (${names.map((name) => `"${name}"`).join(", ")}) VALUES (${placeholders})`;
    await tx.$executeRawUnsafe(sql, ...values as never[]);
    count += 1;
  }
  return count;
}

export function createBackupRestoreRouter() {
  const router = Router();
  const upload = raw({ type: ["application/zip", "application/x-zip-compressed", "application/octet-stream"], limit: env.EXPORT_MAX_ARCHIVE_BYTES });
  router.post("/restore", requireSession, persistentRateLimit(2, "backup-restore"), upload, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) fail("BACKUP_REQUIRED", "Upload a Vivarqo backup ZIP");
    const archive = readBackupZip(req.body);
    const byName = new Map(archive.map((entry) => [entry.name, entry.bytes]));
    const manifestBytes = byName.get("manifest.json");
    if (!manifestBytes) fail("BACKUP_MANIFEST_MISSING", "Backup manifest is missing");
    let manifest: { format?: unknown; formatVersion?: unknown; accountId?: unknown; modules?: unknown; checksums?: unknown; includeDocuments?: unknown };
    try { manifest = JSON.parse(manifestBytes.toString("utf8")) as typeof manifest; }
    catch { return fail("BACKUP_MANIFEST_INVALID", "Backup manifest is not valid JSON"); }
    if (manifest.format !== "vivarqo-account-backup" || manifest.formatVersion !== 1 ||
        typeof manifest.accountId !== "string" || !z.string().uuid().safeParse(manifest.accountId).success ||
        !Array.isArray(manifest.modules) || !FULL_MODULES.every((module) => manifest.modules!.includes(module)) || manifest.includeDocuments !== true ||
        typeof manifest.checksums !== "object" || manifest.checksums === null || Array.isArray(manifest.checksums)) {
      fail("BACKUP_FORMAT_UNSUPPORTED", "Only complete Vivarqo account backups can be restored");
    }
    const checksums = manifest.checksums as Record<string, unknown>;
    for (const spec of TABLES) {
      if (typeof checksums[spec.file] !== "string") fail("BACKUP_CHECKSUM_MISSING", "Backup is missing a required file checksum");
    }
    for (const entry of archive) {
      if (entry.name !== "manifest.json" && entry.name !== "README.txt" && typeof checksums[entry.name] !== "string") {
        fail("BACKUP_CHECKSUM_MISSING", "Backup contains a file without a SHA-256 checksum");
      }
    }
    for (const [name, expected] of Object.entries(checksums)) {
      const bytes = byName.get(name);
      if (!bytes || typeof expected !== "string" || sha256(bytes) !== expected) fail("BACKUP_CHECKSUM_MISMATCH", "Backup file is missing or its SHA-256 checksum is invalid");
    }
    const sourceAccount = byName.get("account.csv");
    if (!sourceAccount || parseCsv(sourceAccount).length !== 1 || parseCsv(sourceAccount)[0]!.id !== manifest.accountId) {
      fail("BACKUP_OWNER_MISMATCH", "Backup account metadata does not match its manifest");
    }
    const parsedTables = new Map<string, CsvRow[]>();
    let totalRows = 0;
    for (const spec of TABLES) {
      const bytes = byName.get(spec.file);
      if (!bytes) fail("BACKUP_FILE_MISSING", `Backup is missing ${spec.file}`);
      const rows = parseCsv(bytes);
      totalRows += rows.length;
      if (totalRows > MAX_ROWS) fail("BACKUP_ROW_LIMIT", "Backup contains too many records", 413);
      parsedTables.set(spec.table, rows);
    }
    const documents = parsedTables.get("documents") ?? [];
    const uploadedObjects: string[] = [];
    const attachmentKeys = new Map<string, string>();
    try {
      for (const [name, bytes] of byName) {
        const folder = name.startsWith("documents/") ? "documents"
          : name.startsWith("animal-photos/") ? "animal-photos"
          : name.startsWith("egg-photos/") ? "egg-photos" : null;
        if (!folder) continue;
        const validated = validatePrivateFile(bytes, "application/octet-stream");
        if (folder !== "documents" && !validated.mimeType.startsWith("image/")) {
          fail("BACKUP_ATTACHMENT_INVALID", "An animal or egg photo is not an image");
        }
        const key = await storePrivateObject(folder, validated.extension as "pdf" | "jpg" | "png" | "webp", bytes);
        uploadedObjects.push(key);
        attachmentKeys.set(name, key);
      }
      const documentRows = new Map(documents.filter((row) => row.archivePath).map((row) => [row.archivePath, row]));
      for (const row of documents) {
        if (!row.archivePath) fail("BACKUP_ATTACHMENT_MISSING", "This backup does not contain all document attachments");
      }
      for (const [archivePath] of attachmentKeys) {
        if (!archivePath.startsWith("documents/")) continue;
        const row = documentRows.get(archivePath);
        if (!row) fail("BACKUP_ATTACHMENT_UNREFERENCED", "Backup contains an attachment with no document record");
        const fileBytes = byName.get(archivePath)!;
        const validated = validatePrivateFile(fileBytes, String(row.mimeType));
        if (Number(row.sizeBytes) !== fileBytes.length || validated.mimeType !== row.mimeType) {
          fail("BACKUP_ATTACHMENT_INVALID", "A document attachment has an unexpected size or MIME type");
        }
      }
      const expectedPhotos = new Set([
        ...(parsedTables.get("animals") ?? []).map((row) => row.photoArchivePath).filter((value): value is string => typeof value === "string" && value.length > 0),
        ...(parsedTables.get("eggs") ?? []).map((row) => row.photoArchivePath).filter((value): value is string => typeof value === "string" && value.length > 0),
      ]);
      for (const photoPath of expectedPhotos) {
        if (!attachmentKeys.has(photoPath)) fail("BACKUP_ATTACHMENT_MISSING", "A referenced animal or egg photo is missing from the backup");
      }
      for (const photoPath of attachmentKeys.keys()) {
        if ((photoPath.startsWith("animal-photos/") || photoPath.startsWith("egg-photos/")) && !expectedPhotos.has(photoPath)) {
          fail("BACKUP_ATTACHMENT_UNREFERENCED", "Backup contains a photo with no animal or egg record");
        }
      }
      const columnsByTable = new Map<string, ColumnInfo[]>();
      for (const spec of TABLES) {
        const columns = await prisma.$queryRaw<ColumnInfo[]>`SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ${spec.table}`;
        columnsByTable.set(spec.table, columns);
      }
      const importedIds = new Map<string, Set<string>>();
      for (const spec of TABLES) importedIds.set(spec.table, new Set((parsedTables.get(spec.table) ?? []).map((row) => row.id)));
      const references: Array<[string, string, string]> = [
        ["feeding_entries", "sessionId", "feeding_sessions"], ["feeding_entries", "animalId", "animals"],
        ["weights", "animalId", "animals"], ["sheds", "animalId", "animals"], ["animal_notes", "animalId", "animals"],
        ["reproduction_cycles", "parentAAnimalId", "animals"], ["reproduction_cycles", "parentBAnimalId", "animals"],\n        ["animals", "motherAnimalId", "animals"], ["animals", "fatherAnimalId", "animals"],\n        ["animals", "originClutchId", "clutches"], ["animals", "originOffspringBatchId", "offspring_batches"],
        ["reproductive_events", "cycleId", "reproduction_cycles"], ["reproductive_events", "animalId", "animals"],
        ["clutches", "cycleId", "reproduction_cycles"], ["eggs", "clutchId", "clutches"], ["eggs", "offspringAnimalId", "animals"],
        ["incubation_logs", "clutchId", "clutches"], ["offspring_batches", "cycleId", "reproduction_cycles"],
        ["offspring_batches", "clutchId", "clutches"], ["inventory_lots", "itemId", "inventory_items"],
        ["inventory_lots", "supplierId", "inventory_suppliers"], ["stock_movements", "itemId", "inventory_items"],
        ["stock_movements", "lotId", "inventory_lots"], ["finance_entries", "animalId", "animals"],
        ["documents", "animalId", "animals"], ["documents", "cycleId", "reproduction_cycles"],\n        ["finance_entries", "documentId", "documents"], ["finance_entries", "reproductionCycleId", "reproduction_cycles"],
        ["finance_entries", "clutchId", "clutches"], ["finance_entries", "offspringBatchId", "offspring_batches"],
        ["finance_entries", "recurrenceId", "finance_recurrences"], ["finance_entries", "sourceStockMovementId", "stock_movements"],\n        ["finance_recurrences", "animalId", "animals"], ["finance_recurrences", "documentId", "documents"], ["feeding_entries", "inventoryItemId", "inventory_items"],
        ["tasks", "animalId", "animals"], ["tasks", "reminderRuleId", "reminder_rules"],
        ["reminder_rules", "animalId", "animals"], ["animal_genetic_traits", "animalId", "animals"],
        ["animal_genetic_traits", "sourceAnimalId", "animals"], ["public_shares", "animalId", "animals"],
      ];
      for (const [table, field, target] of references) {
        for (const row of parsedTables.get(table) ?? []) {
          const value = row[field];
          if (value && !importedIds.get(target)?.has(value)) fail("BACKUP_RELATION_INVALID", "Backup contains a relationship to a record outside the backup");
        }
      }
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.$queryRaw<Array<{ count: bigint }>>`
          SELECT (
            (SELECT count(*) FROM animals WHERE user_id = ${auth.userId}::uuid) +
            (SELECT count(*) FROM feeding_sessions WHERE user_id = ${auth.userId}::uuid) +
            (SELECT count(*) FROM reproduction_cycles WHERE user_id = ${auth.userId}::uuid) +
            (SELECT count(*) FROM inventory_items WHERE user_id = ${auth.userId}::uuid) +
            (SELECT count(*) FROM finance_entries WHERE user_id = ${auth.userId}::uuid) +
            (SELECT count(*) FROM documents WHERE user_id = ${auth.userId}::uuid) +
            (SELECT count(*) FROM tasks WHERE user_id = ${auth.userId}::uuid) +
            (SELECT count(*) FROM reminder_rules WHERE user_id = ${auth.userId}::uuid) +
            (SELECT count(*) FROM notifications WHERE user_id = ${auth.userId}::uuid) +
            (SELECT count(*) FROM inventory_suppliers WHERE user_id = ${auth.userId}::uuid) +
            (SELECT count(*) FROM finance_budgets WHERE user_id = ${auth.userId}::uuid) +
            (SELECT count(*) FROM finance_recurrences WHERE user_id = ${auth.userId}::uuid) +
            (SELECT count(*) FROM public_shares WHERE user_id = ${auth.userId}::uuid) +
            (SELECT count(*) FROM notification_preferences WHERE user_id = ${auth.userId}::uuid)
          ) AS count`;
        if (Number(existing[0]?.count ?? 0) > 0) fail("BACKUP_TARGET_NOT_EMPTY", "Restore is allowed only on an account without existing business data", 409);
        for (const spec of TABLES) {
          const rows = parsedTables.get(spec.table) ?? [];
          const ids = rows.map((row) => row.id);
          if (ids.length) {
            const conflicts = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              `SELECT id::text AS id FROM "${spec.table}" WHERE id = ANY($1::uuid[]) LIMIT 1`, ids,
            );
            if (conflicts.length) fail("BACKUP_ID_CONFLICT", "A record ID from the backup already exists in this database", 409);
          }
        }
        let restored = 0;
        for (const spec of TABLES) {
          if (spec.table === "documents") continue;
          restored += await insertRows(tx, spec, parsedTables.get(spec.table) ?? [], auth.userId, manifest.accountId as string, columnsByTable, attachmentKeys);
        }
        for (const row of parsedTables.get("documents") ?? []) {
          const archivePath = row.archivePath;
          const storageKey = archivePath ? attachmentKeys.get(archivePath) : undefined;
          if (!storageKey) fail("BACKUP_ATTACHMENT_MISSING", "Backup document attachment is missing");
          const values = [row.id, auth.userId, row.animalId || null, row.cycleId || null, row.originalFilename,
            storageKey, row.mimeType, row.sizeBytes, row.category, row.note || null, row.createdAt || new Date().toISOString()];
          await tx.$executeRawUnsafe(
            "INSERT INTO documents (id, user_id, animal_id, cycle_id, original_filename, storage_key, mime_type, size_bytes, category, note, created_at) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8::bigint,$9,$10,$11::timestamptz)",
            ...values as never[],
          );
          restored += 1;
        }
        for (const spec of TABLES.filter((entry) => entry.deferred?.length)) {
          for (const row of parsedTables.get(spec.table) ?? []) {
            for (const field of spec.deferred ?? []) {
              const value = row[field];
              if (!value) continue;
              const column = snakeCase(field);
              await tx.$executeRawUnsafe(`UPDATE animals SET "${column}" = $1::uuid WHERE id = $2::uuid`, value, row.id);
            }
          }
        }
        await tx.auditEvent.create({ data: {
          userId: auth.userId, action: "account.backup_restored", entityType: "account",
          metadata: { sourceAccountId: manifest.accountId, restoredRecords: restored, formatVersion: 1 },
        } });
        return { restoredRecords: restored };
      }, { maxWait: 10_000, timeout: 120_000 });
      res.status(200).json({ status: "restored", ...result, sourceAccountId: manifest.accountId });
    } catch (error) {
      await Promise.all(uploadedObjects.map((key) => deletePrivateObject(key).catch(() => undefined)));
      throw error;
    }
  });
  return router;
}
