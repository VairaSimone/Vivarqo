import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";
import { requireSession, type AuthContext } from "../auth/session.js";
import { parseAnimalFile } from "../animals/animal-file-parser.js";

const supportedEntities = ["weights", "sheds", "notes", "feedings"] as const;
type CareEntity = typeof supportedEntities[number];
type PreviewRow = { rowNumber: number; record: Record<string, unknown> };
type CareImportReport = {
  entityType: CareEntity;
  fileType: "csv" | "xlsx";
  headers: string[];
  selectedSheet: string | null;
  sheets: string[];
  validRows: PreviewRow[];
  errors: Array<{ row: number; column: string; reason: string }>;
};
const aliases: Record<string, string> = {
  animalid: "animalId", idanimale: "animalId", vivarqoanimalid: "animalId",
  animalidentifier: "animalIdentifier", identifier: "animalIdentifier", identificativo: "animalIdentifier", codiceanimale: "animalIdentifier", codice: "animalIdentifier",
  measuredat: "measuredAt", datapesata: "measuredAt", datapeso: "measuredAt", occurredat: "occurredAt", data: "occurredAt", datamuta: "occurredAt",
  performedat: "performedAt", dataalimentazione: "performedAt", feedingdate: "performedAt", datadellofferta: "performedAt",
  weightg: "weightG", pesog: "weightG", pesoingrammi: "weightG", peso: "weightG",
  outcome: "outcome", esito: "outcome", risultato: "outcome",
  foodtype: "foodType", tipoalimento: "foodType", alimento: "foodType",
  foodsize: "foodSize", dimensione: "foodSize", quantita: "foodSize",
  foodweightg: "foodWeightG", pesoalimento: "foodWeightG",
  notes: "notes", note: "notes", annotazioni: "notes",
  title: "title", titolo: "title",
  category: "category", categoria: "category",
  body: "body", testo: "body", osservazione: "body", nota: "body",
};
function normalize(value: string): string {
  return value.toLocaleLowerCase("it-IT").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}
function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", {
    issues: parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message })),
  });
  return parsed.data;
}
function routeUuid(value: string | string[] | undefined): string {
  const result = Array.isArray(value) ? value[0] : value;
  if (!result || !z.string().uuid().safeParse(result).success) throw new AppError(400, "INVALID_ID", "Invalid import id");
  return result;
}
function validDateTime(value: unknown) {
  if (typeof value !== "string" || !/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}
const recordSchemas = {
  weights: z.object({
    animalId: z.string().uuid(),
    measuredAt: z.string().datetime({ offset: true }),
    weightG: z.coerce.number().positive().max(100_000_000),
    notes: z.string().trim().max(5000).nullable().optional(),
  }).strict(),
  sheds: z.object({
    animalId: z.string().uuid(),
    occurredAt: z.string().datetime({ offset: true }),
    outcome: z.enum(["complete", "partial", "unknown"]),
    notes: z.string().trim().max(5000).nullable().optional(),
  }).strict(),
  notes: z.object({
    animalId: z.string().uuid(),
    occurredAt: z.string().datetime({ offset: true }),
    title: z.string().trim().max(160).nullable().optional(),
    category: z.string().trim().min(1).max(40),
    body: z.string().trim().min(1).max(20_000),
  }).strict(),
  feedings: z.object({
    animalId: z.string().uuid(),
    performedAt: z.string().datetime({ offset: true }),
    outcome: z.enum(["ate", "refused", "not_offered", "unknown"]),
    foodType: z.string().trim().max(120).nullable().optional(),
    foodSize: z.string().trim().max(120).nullable().optional(),
    foodWeightG: z.coerce.number().positive().max(1_000_000).nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
  }).strict(),
};
function toRecord(entity: CareEntity, values: Record<string, string>, mapped: Record<string, string>): Record<string, unknown> {
  const get = (field: string) => values[mapped[field] ?? ""] ?? "";
  const animalId = get("animalId").trim();
  const record: Record<string, unknown> = {
    animalId,
    ...(entity === "weights" ? { measuredAt: get("measuredAt"), weightG: get("weightG"), notes: get("notes") || null } : {}),
    ...(entity === "sheds" ? { occurredAt: get("occurredAt"), outcome: get("outcome") || "unknown", notes: get("notes") || null } : {}),
    ...(entity === "notes" ? { occurredAt: get("occurredAt"), title: get("title") || null, category: get("category"), body: get("body") } : {}),
    ...(entity === "feedings" ? {
      performedAt: get("performedAt"), outcome: get("outcome") || "unknown", foodType: get("foodType") || null,
      foodSize: get("foodSize") || null, foodWeightG: get("foodWeightG") ? Number(get("foodWeightG")) : null, notes: get("notes") || null,
    } : {}),
  };
  if (entity === "weights") record.weightG = Number(record.weightG);

  return record;
}
function reportFrom(value: unknown): CareImportReport {
  if (typeof value !== "object" || value === null || !("validRows" in value) || !Array.isArray((value as CareImportReport).validRows)) {
    throw new AppError(500, "IMPORT_REPORT_INVALID", "Import preview could not be read");
  }
  return value as CareImportReport;
}

export function createCareImportRouter() {
  const router = Router();

  router.post("/", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const entity = typeof req.query.entity === "string" ? req.query.entity : "";
    if (!supportedEntities.includes(entity as CareEntity)) {
      throw new AppError(400, "IMPORT_ENTITY_NOT_SUPPORTED", "Supported care import types are weights, sheds, notes and feedings", { supportedEntities });
    }
    if (!Buffer.isBuffer(req.body)) throw new AppError(400, "IMPORT_FILE_REQUIRED", "Upload the CSV or XLSX file as the request body");
    const mime = (req.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const file = parseAnimalFile(req.body, mime, typeof req.query.sheet === "string" ? req.query.sheet : undefined);
    const mapped: Record<string, string> = {};
    const unmappedHeaders: string[] = [];
    for (const header of file.headers) {
      const field = aliases[normalize(header)];
      if (!field) { unmappedHeaders.push(header); continue; }
      if (mapped[field]) throw new AppError(400, "IMPORT_HEADER_AMBIGUOUS", "More than one column maps to the same field", { field, columns: [mapped[field], header] });
      mapped[field] = header;
    }
    const animalKey = mapped.animalId ? "animalId" : mapped.animalIdentifier ? "animalIdentifier" : "";
    if (!animalKey) throw new AppError(400, "IMPORT_ANIMAL_KEY_REQUIRED", "Provide an animalId or animalIdentifier column", { availableHeaders: file.headers });

    const requiredFields: Record<CareEntity, string[]> = {
      weights: ["measuredAt", "weightG"],
      sheds: ["occurredAt"],
      notes: ["occurredAt", "category", "body"],
      feedings: ["performedAt"],
    };
    const missing = requiredFields[entity as CareEntity].filter((field) => !mapped[field]);
    if (missing.length) throw new AppError(400, "IMPORT_REQUIRED_COLUMNS", "Required columns are missing", { missingFields: missing });

    const identifiers = file.rows.map((row) => row.values[mapped.animalIdentifier ?? ""]?.trim()).filter((value): value is string => Boolean(value));
    const normalizedIdentifiers = [...new Set(identifiers.map((value) => value.toLocaleLowerCase("it-IT")))];
    const ids = file.rows.map((row) => row.values[mapped.animalId ?? ""]?.trim()).filter((value): value is string => Boolean(value) && z.string().uuid().safeParse(value).success);
    const [animalsByIdentifier, animalsById] = await Promise.all([
      normalizedIdentifiers.length ? prisma.animal.findMany({ where: { userId: auth.userId, identifier: { in: normalizedIdentifiers, mode: "insensitive" } }, select: { id: true, identifier: true, name: true } }) : Promise.resolve([]),
      ids.length ? prisma.animal.findMany({ where: { userId: auth.userId, id: { in: [...new Set(ids)] } }, select: { id: true, identifier: true, name: true } }) : Promise.resolve([]),
    ]);
    const identifierMap = new Map(animalsByIdentifier.map((animal) => [animal.identifier?.toLocaleLowerCase("it-IT") ?? "", animal]));
    const idMap = new Map(animalsById.map((animal) => [animal.id, animal]));

    const validRows: PreviewRow[] = [];
    const errors: CareImportReport["errors"] = [];
    const feedingSeen = new Set<string>();
    const schema = recordSchemas[entity as CareEntity];
    for (const row of file.rows) {
      const animalIdRaw = row.values[mapped.animalId ?? ""]?.trim() ?? "";
      const animalIdentifierRaw = row.values[mapped.animalIdentifier ?? ""]?.trim() ?? "";
      const animal = animalIdRaw
        ? (z.string().uuid().safeParse(animalIdRaw).success ? idMap.get(animalIdRaw) : undefined)
        : identifierMap.get(animalIdentifierRaw.toLocaleLowerCase("it-IT"));
      if (!animal) {
        errors.push({ row: row.rowNumber, column: animalKey === "animalId" ? mapped.animalId! : mapped.animalIdentifier!, reason: "Animal not found in this account" });
        continue;
      }
      const raw = toRecord(entity as CareEntity, row.values, { ...mapped, animalId: mapped.animalId ?? mapped.animalIdentifier! });
      raw.animalId = animal.id;
      for (const field of ["measuredAt", "occurredAt", "performedAt"]) {
        if (typeof raw[field] === "string" && raw[field] && !validDateTime(raw[field])) {
          errors.push({ row: row.rowNumber, column: mapped[field] ?? field, reason: "Use a date and time including a timezone offset" });
        }
      }
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const field = String(issue.path[0] ?? "row");
          errors.push({ row: row.rowNumber, column: mapped[field] ?? field, reason: issue.message });
        }
        continue;
      }
      if (entity === "feedings") {
        const record = parsed.data as z.output<typeof recordSchemas.feedings>;
        const key = `${record.performedAt}:${record.animalId}`;
        if (feedingSeen.has(key)) {
          errors.push({ row: row.rowNumber, column: mapped.animalIdentifier ?? mapped.animalId ?? "animalId", reason: "An animal can appear only once in a feeding session at a given timestamp" });
          continue;
        }
        feedingSeen.add(key);
      }
      validRows.push({ rowNumber: row.rowNumber, record: parsed.data as Record<string, unknown> });
    }

    const report: CareImportReport = { entityType: entity as CareEntity, fileType: file.fileType, headers: file.headers, selectedSheet: file.selectedSheet, sheets: file.sheets, validRows, errors };
    const job = await prisma.importJob.create({
      data: {
        userId: auth.userId, entityType: report.entityType, storageKey: "database-preview-report", status: "preview",
        totalRows: file.rows.length, skippedCount: errors.length, errorCount: errors.length,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), report: JSON.parse(JSON.stringify(report)) as never,
      },
      select: { id: true, status: true, expiresAt: true, totalRows: true },
    });
    res.status(201).json({
      importId: job.id, entityType: report.entityType, status: job.status, fileType: report.fileType,
      headers: report.headers, unmappedHeaders, sheets: report.sheets, selectedSheet: report.selectedSheet,
      totalRows: file.rows.length, validRows: validRows.length, invalidRows: errors.length, errors,
      preview: validRows.slice(0, 20), expiresAt: job.expiresAt,
    });
  });

  router.post("/:id/confirm", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const jobId = routeUuid(req.params.id);
    const current = await prisma.importJob.findFirst({ where: { id: jobId, userId: auth.userId, entityType: { in: [...supportedEntities] } } });
    if (!current) throw new AppError(404, "IMPORT_NOT_FOUND", "Import not found");
    if (current.status !== "preview" || current.expiresAt <= new Date()) throw new AppError(409, "IMPORT_NOT_CONFIRMABLE", "The import preview is no longer available");
    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.importJob.updateMany({
        where: { id: jobId, userId: auth.userId, status: "preview", expiresAt: { gt: new Date() } },
        data: { status: "processing" },
      });
      if (claim.count !== 1) throw new AppError(409, "IMPORT_NOT_CONFIRMABLE", "The import has already been confirmed or expired");
      const job = await tx.importJob.findFirstOrThrow({ where: { id: jobId, userId: auth.userId } });
      const report = reportFrom(job.report);
      let createdCount = 0;
      if (report.entityType === "weights") {
        const records = report.validRows.map(({ record: value }) => {
          const record = value as { animalId: string; measuredAt: string; weightG: number; notes?: string | null };
          return { animalId: record.animalId, measuredAt: new Date(record.measuredAt), weightG: record.weightG, notes: record.notes ?? null };
        });
        if (records.length) await tx.weightMeasurement.createMany({ data: records });
        createdCount = records.length;
      } else if (report.entityType === "sheds") {
        const records = report.validRows.map(({ record: value }) => {
          const record = value as { animalId: string; occurredAt: string; outcome: "complete" | "partial" | "unknown"; notes?: string | null };
          return { animalId: record.animalId, occurredAt: new Date(record.occurredAt), outcome: record.outcome, notes: record.notes ?? null };
        });
        if (records.length) await tx.shedRecord.createMany({ data: records });
        createdCount = records.length;
      } else if (report.entityType === "notes") {
        const records = report.validRows.map(({ record: value }) => {
          const record = value as { animalId: string; occurredAt: string; title?: string | null; category: string; body: string };
          return { animalId: record.animalId, occurredAt: new Date(record.occurredAt), title: record.title ?? null, category: record.category, body: record.body };
        });
        if (records.length) await tx.animalNote.createMany({ data: records });
        createdCount = records.length;
      } else {
        const byTimestamp = new Map<string, Array<{ rowNumber: number; record: Record<string, unknown> }>>();
        for (const row of report.validRows) {
          const timestamp = String(row.record.performedAt);
          const entries = byTimestamp.get(timestamp) ?? [];
          entries.push(row);
          byTimestamp.set(timestamp, entries);
        }
        for (const [timestamp, rows] of byTimestamp) {
          const session = await tx.feedingSession.create({ data: { userId: auth.userId, performedAt: new Date(timestamp) } });
          const entries = rows.map(({ record: value }) => {
            const record = value as { animalId: string; outcome: "ate" | "refused" | "not_offered" | "unknown"; foodType?: string | null; foodSize?: string | null; foodWeightG?: number | null; notes?: string | null };
            return {
              sessionId: session.id, animalId: record.animalId, outcome: record.outcome,
              foodType: record.foodType ?? null, foodSize: record.foodSize ?? null,
              foodWeightG: record.foodWeightG ?? null, notes: record.notes ?? null,
            };
          });
          if (entries.length) await tx.feedingEntry.createMany({ data: entries });
          createdCount += entries.length;
        }
      }
      const finalReport = { ...report, createdCount, skippedCount: report.errors.length, errors: report.errors };
      const updated = await tx.importJob.update({
        where: { id: jobId },
        data: { status: "completed", createdCount, skippedCount: report.errors.length, errorCount: report.errors.length, report: JSON.parse(JSON.stringify(finalReport)) as never },
      });
      await tx.auditEvent.create({
        data: { userId: auth.userId, action: "care_records.imported", entityType: "import_job", entityId: jobId, metadata: { entityType: report.entityType, createdCount, errorCount: report.errors.length } },
      });
      return updated;
    });
    res.status(200).json({ importId: result.id, entityType: result.entityType, status: result.status, createdCount: result.createdCount, skippedCount: result.skippedCount, errorCount: result.errorCount, report: result.report });
  });

  return router;
}
