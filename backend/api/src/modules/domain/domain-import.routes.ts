import { Router, raw } from "express";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";
import { requireSession, type AuthContext } from "../auth/session.js";
import { persistentRateLimit } from "../../middleware/persistent-rate-limit.js";
import { parseAnimalFile } from "../animals/animal-file-parser.js";

const uploadBody = raw({
  type: ["text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream"],
  limit: "5mb",
});
const entities = ["finance", "inventory", "reproductionCycles", "reproductiveEvents", "clutches", "eggs", "incubationLogs", "offspringBatches"] as const;
type Entity = typeof entities[number];
type Row = { rowNumber: number; record: Record<string, unknown> };
type Report = { entityType: Entity; fileType: "csv" | "xlsx"; headers: string[]; selectedSheet: string | null; sheets: string[]; validRows: Row[]; errors: Array<{ row: number; column: string; reason: string }> };

const aliases: Record<string, string> = {
  animalid: "animalId", idanimale: "animalId", animalidentifier: "animalIdentifier", identificativo: "animalIdentifier", codiceanimale: "animalIdentifier",
  parentaanimalid: "parentAAnimalId", genitoreaid: "parentAAnimalId", parentaanimalidentifier: "parentAAnimalIdentifier",
  parentbanimalid: "parentBAnimalId", genitorebid: "parentBAnimalId", parentbanimalidentifier: "parentBAnimalIdentifier",
  cycleid: "cycleId", idciclo: "cycleId", clutchid: "clutchId", idcovata: "clutchId", documentid: "documentId", iddocumento: "documentId",
  name: "name", nome: "name", category: "category", categoria: "category", unit: "unit", unita: "unit",
  quantityonhand: "quantityOnHand", giacenza: "quantityOnHand", quantity: "quantityOnHand",
  minimumquantity: "minimumQuantity", scortaminima: "minimumQuantity", notes: "notes", note: "notes", isactive: "isActive", attivo: "isActive",
  entrytype: "entryType", tipo: "entryType", occurredon: "occurredOn", dataoperazione: "occurredOn", amountcents: "amountCents", importocentesimi: "amountCents",
  amounteur: "amountEUR", importoeur: "amountEUR", importo: "amountEUR", currency: "currency", valuta: "currency", description: "description", descrizione: "description",
  startedon: "startedOn", datainizio: "startedOn", endedon: "endedOn", datafine: "endedOn", status: "status", stato: "status",
  eventtype: "eventType", tipoevento: "eventType", occurredat: "occurredAt", dataevento: "occurredAt", details: "details", dettagli: "details",
  temperaturec: "temperatureC", temperatura: "temperatureC", humiditypct: "humidityPct", umidita: "humidityPct",
  laidon: "laidOn", datadeposizione: "laidOn", eggcount: "eggCount", numerouova: "eggCount", incubatorlabel: "incubatorLabel", incubatore: "incubatorLabel",
  incubationstartedat: "incubationStartedAt", code: "code", codiceuovo: "code", recordedat: "recordedAt", dataregistrazione: "recordedAt",
  bornon: "bornOn", datanascita: "bornOn", count: "count", numero: "count", unitcostcents: "unitCostCents", reference: "reference", riferimento: "reference",
};
function norm(value: string): string {
  return value.toLocaleLowerCase("it-IT").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}
function parsed<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", {
    issues: result.error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message })),
  });
  return result.data;
}
function dateOnly(value: string): Date {
  const date = new Date(value + "T00:00:00.000Z");
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new AppError(400, "VALIDATION_ERROR", "Invalid date");
  return date;
}
const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Use a valid YYYY-MM-DD date");
function optionalText(value: string | undefined): string | null {
  return value?.trim() || null;
}
function numberValue(value: string | undefined): number | undefined {
  const text = value?.trim() ?? "";
  if (!text) return undefined;
  return Number(text.replace(",", "."));
}
function amountCents(cents: string | undefined, euros: string | undefined): number | undefined {
  if (cents?.trim()) return Number(cents.trim());
  if (!euros?.trim()) return undefined;
  const value = euros.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return Number.NaN;
  return Math.round(Number(value) * 100);
}
function asBool(value: string | undefined): boolean {
  if (!value?.trim()) return true;
  return ["true", "1", "si", "yes", "vero", "attivo"].includes(norm(value));
}
function id(value: string | string[] | undefined): string {
  const result = Array.isArray(value) ? value[0] : value;
  if (!result || !z.string().uuid().safeParse(result).success) throw new AppError(400, "INVALID_ID", "Invalid import id");
  return result;
}
function readReport(value: unknown): Report {
  if (typeof value !== "object" || value === null || !("validRows" in value) || !Array.isArray((value as Report).validRows)) {
    throw new AppError(500, "IMPORT_REPORT_INVALID", "Import preview could not be read");
  }
  return value as Report;
}

const schemas = {
  finance: z.object({
    entryType: z.enum(["income", "expense"]), occurredOn: calendarDateSchema,
    amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), currency: z.string().trim().length(3).default("EUR").transform((v) => v.toUpperCase()),
    category: z.string().trim().min(1).max(80), description: z.string().trim().min(1).max(240),
    animalId: z.string().uuid().nullable().optional(), documentId: z.string().uuid().nullable().optional(),
  }).strict().transform((v) => v as Record<string, unknown>),
  inventory: z.object({
    name: z.string().trim().min(1).max(160), category: z.enum(["food", "substrate", "material", "equipment", "other"]),
    unit: z.string().trim().min(1).max(24), quantityOnHand: z.number().finite().min(0).max(999_999_999.999).refine((v) => Number.isInteger(v * 1000)),
    minimumQuantity: z.number().finite().min(0).max(999_999_999.999).refine((v) => Number.isInteger(v * 1000)).nullable().optional(),
    notes: z.string().max(10_000).nullable().optional(), isActive: z.boolean().default(true),
  }).strict().transform((v) => v as Record<string, unknown>),
  reproductionCycles: z.object({
    name: z.string().trim().max(160).nullable().optional(), startedOn: calendarDateSchema,
    endedOn: calendarDateSchema.nullable().optional(),
    status: z.enum(["planned", "active", "completed", "cancelled"]).default("planned"),
    parentAAnimalId: z.string().uuid().nullable().optional(), parentBAnimalId: z.string().uuid().nullable().optional(),
    notes: z.string().max(20_000).nullable().optional(),
  }).strict().transform((v) => v as Record<string, unknown>),
  reproductiveEvents: z.object({
    cycleId: z.string().uuid(), eventType: z.enum(["pairing", "observation", "ovulation", "gravid", "laying", "live_birth", "incubation_start", "hatch", "loss", "other"]),
    occurredAt: z.string().datetime({ offset: true }), animalId: z.string().uuid().nullable().optional(),
    details: z.string().max(20_000).nullable().optional(), temperatureC: z.number().min(-100).max(100).nullable().optional(),
    humidityPct: z.number().min(0).max(100).nullable().optional(),
  }).strict().transform((v) => v as Record<string, unknown>),
  clutches: z.object({
    cycleId: z.string().uuid(), laidOn: calendarDateSchema, eggCount: z.number().int().min(0).max(10_000),
    status: z.string().trim().min(1).max(20).default("active"), incubatorLabel: z.string().max(120).nullable().optional(),
    incubationStartedAt: z.string().datetime({ offset: true }).nullable().optional(), notes: z.string().max(20_000).nullable().optional(),
  }).strict().transform((v) => v as Record<string, unknown>),
  eggs: z.object({ clutchId: z.string().uuid(), code: z.string().max(80).nullable().optional(), status: z.string().trim().min(1).max(20).default("unknown"), notes: z.string().max(10_000).nullable().optional() }).strict().transform((v) => v as Record<string, unknown>),
  incubationLogs: z.object({
    clutchId: z.string().uuid(), recordedAt: z.string().datetime({ offset: true }), temperatureC: z.number().min(-100).max(100).nullable().optional(),
    humidityPct: z.number().min(0).max(100).nullable().optional(), eventType: z.string().trim().min(1).max(24), notes: z.string().max(10_000).nullable().optional(),
  }).strict().transform((v) => v as Record<string, unknown>),
  offspringBatches: z.object({
    cycleId: z.string().uuid(), clutchId: z.string().uuid().nullable().optional(), bornOn: calendarDateSchema,
    count: z.number().int().min(0).max(10_000), notes: z.string().max(20_000).nullable().optional(),
  }).strict().transform((v) => v as Record<string, unknown>),
} satisfies Record<Entity, z.ZodTypeAny>;
const required: Record<Entity, string[][]> = {
  finance: [["entryType"], ["occurredOn"], ["amountCents", "amountEUR"], ["category"], ["description"]],
  inventory: [["name"], ["category"], ["unit"]],
  reproductionCycles: [["startedOn"]],
  reproductiveEvents: [["cycleId"], ["eventType"], ["occurredAt"]],
  clutches: [["cycleId"], ["laidOn"], ["eggCount"]],
  eggs: [["clutchId"]],
  incubationLogs: [["clutchId"], ["recordedAt"], ["eventType"]],
  offspringBatches: [["cycleId"], ["bornOn"], ["count"]],
};
function sourceRecord(entity: Entity, values: Record<string, string>, map: Record<string, string>): Record<string, unknown> {
  const get = (key: string) => values[map[key] ?? ""]?.trim() ?? "";
  const record: Record<string, unknown> = {};
  switch (entity) {
    case "finance":
      Object.assign(record, { entryType: get("entryType"), occurredOn: get("occurredOn"), amountCents: amountCents(get("amountCents"), get("amountEUR")),
        currency: get("currency") || "EUR", category: get("category"), description: get("description"),
        animalId: optionalText(get("animalId")), animalIdentifier: optionalText(get("animalIdentifier")),
        documentId: optionalText(get("documentId")) });
      break;
    case "inventory":
      Object.assign(record, { name: get("name"), category: get("category"), unit: get("unit"),
        quantityOnHand: get("quantityOnHand") ? numberValue(get("quantityOnHand")) : 0,
        minimumQuantity: get("minimumQuantity") ? numberValue(get("minimumQuantity")) : null,
        notes: optionalText(get("notes")), isActive: asBool(get("isActive")) });
      break;
    case "reproductionCycles":
      Object.assign(record, { name: optionalText(get("name")), startedOn: get("startedOn"), endedOn: optionalText(get("endedOn")),
        status: get("status") || "planned", parentAAnimalId: optionalText(get("parentAAnimalId")),
        parentAAnimalIdentifier: optionalText(get("parentAAnimalIdentifier")), parentBAnimalId: optionalText(get("parentBAnimalId")),
        parentBAnimalIdentifier: optionalText(get("parentBAnimalIdentifier")), notes: optionalText(get("notes")) });
      break;
    case "reproductiveEvents":
      Object.assign(record, { cycleId: get("cycleId"), eventType: get("eventType"), occurredAt: get("occurredAt"),
        animalId: optionalText(get("animalId")), animalIdentifier: optionalText(get("animalIdentifier")),
        details: optionalText(get("details")), temperatureC: numberValue(get("temperatureC")), humidityPct: numberValue(get("humidityPct")) });
      break;
    case "clutches":
      Object.assign(record, { cycleId: get("cycleId"), laidOn: get("laidOn"), eggCount: get("eggCount") ? Number(get("eggCount")) : undefined,
        status: get("status") || "active", incubatorLabel: optionalText(get("incubatorLabel")),
        incubationStartedAt: optionalText(get("incubationStartedAt")), notes: optionalText(get("notes")) });
      break;
    case "eggs":
      Object.assign(record, { clutchId: get("clutchId"), code: optionalText(get("code")), status: get("status") || "unknown", notes: optionalText(get("notes")) });
      break;
    case "incubationLogs":
      Object.assign(record, { clutchId: get("clutchId"), recordedAt: get("recordedAt"), temperatureC: numberValue(get("temperatureC")),
        humidityPct: numberValue(get("humidityPct")), eventType: get("eventType"), notes: optionalText(get("notes")) });
      break;
    case "offspringBatches":
      Object.assign(record, { cycleId: get("cycleId"), clutchId: optionalText(get("clutchId")), bornOn: get("bornOn"),
        count: get("count") ? Number(get("count")) : undefined, notes: optionalText(get("notes")) });
      break;
  }
  return record;
}

export async function processQueuedDomainImport(jobId: string, userId: string, leaseToken: string): Promise<void> {
  const job = await prisma.importJob.findFirst({
    where: { id: jobId, userId, entityType: { in: [...entities] }, status: "processing", leaseToken },
  });
  if (!job) return;
  const report = readReport(job.report);
  await prisma.$transaction(async (tx) => {
    const createdRows: Array<{ row: number; id: string }> = [];
    for (const row of report.validRows) {
      const item = row.record;
      let createdId = "";
      switch (report.entityType) {
        case "finance": {
          const created = await tx.financeEntry.create({ data: {
            userId, entryType: item.entryType as string, occurredOn: dateOnly(item.occurredOn as string),
            amountCents: BigInt(item.amountCents as number), currency: item.currency as string,
            category: item.category as string, description: item.description as string,
            animalId: (item.animalId as string | null | undefined) ?? null,
            documentId: (item.documentId as string | null | undefined) ?? null,
          } });
          createdId = created.id; break;
        }
        case "inventory": {
          const created = await tx.inventoryItem.create({ data: {
            userId, name: item.name as string, category: item.category as string, unit: item.unit as string,
            quantityOnHand: item.quantityOnHand as number, minimumQuantity: (item.minimumQuantity as number | null | undefined) ?? null,
            notes: (item.notes as string | null | undefined) ?? null, isActive: item.isActive as boolean,
          } });
          if ((item.quantityOnHand as number) > 0) await tx.stockMovement.create({ data: {
            itemId: created.id, movementType: "in", quantity: item.quantityOnHand as number,
            occurredAt: new Date(), reference: "Import apertura", notes: "Saldo iniziale da importazione",
          } });
          createdId = created.id; break;
        }
        case "reproductionCycles": {
          const created = await tx.reproductionCycle.create({ data: {
            userId, name: (item.name as string | null | undefined) ?? null,
            startedOn: dateOnly(item.startedOn as string), endedOn: item.endedOn ? dateOnly(item.endedOn as string) : null,
            status: item.status as string, parentAAnimalId: (item.parentAAnimalId as string | null | undefined) ?? null,
            parentBAnimalId: (item.parentBAnimalId as string | null | undefined) ?? null,
            notes: (item.notes as string | null | undefined) ?? null,
          } });
          createdId = created.id; break;
        }
        case "reproductiveEvents": {
          const created = await tx.reproductiveEvent.create({ data: {
            cycleId: item.cycleId as string, eventType: item.eventType as string, occurredAt: new Date(item.occurredAt as string),
            animalId: (item.animalId as string | null | undefined) ?? null, details: (item.details as string | null | undefined) ?? null,
            temperatureC: item.temperatureC === undefined ? null : item.temperatureC as number | null,
            humidityPct: item.humidityPct === undefined ? null : item.humidityPct as number | null,
          } });
          createdId = created.id; break;
        }
        case "clutches": {
          const created = await tx.clutch.create({ data: {
            cycleId: item.cycleId as string, laidOn: dateOnly(item.laidOn as string), eggCount: item.eggCount as number,
            status: item.status as string, incubatorLabel: (item.incubatorLabel as string | null | undefined) ?? null,
            incubationStartedAt: item.incubationStartedAt ? new Date(item.incubationStartedAt as string) : null,
            notes: (item.notes as string | null | undefined) ?? null,
          } });
          createdId = created.id; break;
        }
        case "eggs": {
          const created = await tx.egg.create({ data: {
            clutchId: item.clutchId as string, code: (item.code as string | null | undefined) ?? null,
            status: item.status as string, notes: (item.notes as string | null | undefined) ?? null,
          } });
          createdId = created.id; break;
        }
        case "incubationLogs": {
          const created = await tx.incubationLog.create({ data: {
            clutchId: item.clutchId as string, recordedAt: new Date(item.recordedAt as string),
            temperatureC: item.temperatureC === undefined ? null : item.temperatureC as number | null,
            humidityPct: item.humidityPct === undefined ? null : item.humidityPct as number | null,
            eventType: item.eventType as string, notes: (item.notes as string | null | undefined) ?? null,
          } });
          createdId = created.id; break;
        }
        case "offspringBatches": {
          const created = await tx.offspringBatch.create({ data: {
            cycleId: item.cycleId as string, clutchId: (item.clutchId as string | null | undefined) ?? null,
            bornOn: dateOnly(item.bornOn as string), count: item.count as number,
            notes: (item.notes as string | null | undefined) ?? null,
          } });
          createdId = created.id; break;
        }
      }
      createdRows.push({ row: row.rowNumber, id: createdId });
    }
    const finalReport = { ...report, createdRows, createdCount: createdRows.length, skippedCount: report.errors.length };
    await tx.auditEvent.create({
      data: {
        userId, action: "domain_import.confirmed", entityType: "import_job", entityId: jobId,
        metadata: { entityType: report.entityType, created: createdRows.length, errors: report.errors.length },
      },
    });
    const completed = await tx.importJob.updateMany({
      where: { id: jobId, userId, status: "processing", leaseToken },
      data: {
        status: "completed", createdCount: createdRows.length, skippedCount: report.errors.length,
        errorCount: report.errors.length, processingStartedAt: null, leaseToken: null, lastErrorCode: null,
        report: JSON.parse(JSON.stringify(finalReport)) as never,
      },
    });
    if (completed.count !== 1) throw new Error("Import processing lease was lost before commit");
  });
}

export function createDomainImportRouter() {
  const router = Router();

  router.post("/", requireSession, uploadBody, async (req, res, next) => {
    const entity = typeof req.query.entity === "string" ? req.query.entity : "";
    if (!entities.includes(entity as Entity)) { next(); return; }
    const auth = res.locals.auth as AuthContext;
    if (!Buffer.isBuffer(req.body)) throw new AppError(400, "IMPORT_FILE_REQUIRED", "Upload the CSV or XLSX file as the request body");
    const mime = (req.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const file = parseAnimalFile(req.body, mime, typeof req.query.sheet === "string" ? req.query.sheet : undefined);
    const map: Record<string, string> = {};
    const unmappedHeaders: string[] = [];
    for (const header of file.headers) {
      const field = aliases[norm(header)];
      if (!field) { unmappedHeaders.push(header); continue; }
      if (map[field]) throw new AppError(400, "IMPORT_HEADER_AMBIGUOUS", "More than one column maps to the same field", { field, columns: [map[field], header] });
      map[field] = header;
    }
    const missing = required[entity as Entity].filter((alternatives) => !alternatives.some((field) => map[field]));
    if (missing.length) throw new AppError(400, "IMPORT_REQUIRED_COLUMNS", "Required columns are missing", { missingFields: missing.map((items) => items.join(" or ")), availableHeaders: file.headers });

    const sourceRows = file.rows.map((row) => ({ rowNumber: row.rowNumber, record: sourceRecord(entity as Entity, row.values, map) }));
    const animalKeys = new Set<string>();
    const animalIdentifiers = new Set<string>();
    for (const row of sourceRows) {
      for (const field of ["animalId", "parentAAnimalId", "parentBAnimalId"]) if (typeof row.record[field] === "string" && z.string().uuid().safeParse(row.record[field]).success) animalKeys.add(row.record[field] as string);
      for (const field of ["animalIdentifier", "parentAAnimalIdentifier", "parentBAnimalIdentifier"]) if (typeof row.record[field] === "string" && row.record[field]) animalIdentifiers.add((row.record[field] as string).toLocaleLowerCase("it-IT"));
    }
    const cycleIds = new Set<string>();
    const clutchIds = new Set<string>();
    const documentIds = new Set<string>();
    for (const row of sourceRows) {
      if (typeof row.record.cycleId === "string" && z.string().uuid().safeParse(row.record.cycleId).success) cycleIds.add(row.record.cycleId);
      if (typeof row.record.clutchId === "string" && z.string().uuid().safeParse(row.record.clutchId).success) clutchIds.add(row.record.clutchId);
      if (typeof row.record.documentId === "string" && z.string().uuid().safeParse(row.record.documentId).success) documentIds.add(row.record.documentId);
    }
    const [animals, animalsByIdentifier, cycles, clutches, documents] = await Promise.all([
      animalKeys.size ? prisma.animal.findMany({ where: { userId: auth.userId, id: { in: [...animalKeys] } }, select: { id: true } }) : Promise.resolve([]),
      animalIdentifiers.size ? prisma.animal.findMany({ where: { userId: auth.userId, identifier: { in: [...animalIdentifiers], mode: "insensitive" } }, select: { id: true, identifier: true } }) : Promise.resolve([]),
      cycleIds.size
        ? prisma.reproductionCycle.findMany({ where: { userId: auth.userId, id: { in: [...cycleIds] } }, select: { id: true } }) : Promise.resolve([]),
      clutchIds.size
        ? prisma.clutch.findMany({ where: { id: { in: [...clutchIds] }, cycle: { is: { userId: auth.userId } } }, select: { id: true, cycleId: true } }) : Promise.resolve([]),
      documentIds.size ? prisma.document.findMany({ where: { id: { in: [...documentIds] }, userId: auth.userId, deletedAt: null }, select: { id: true } }) : Promise.resolve([]),
    ]);
    const ownedAnimalIds = new Set(animals.map((item) => item.id));
    const ownedAnimalByIdentifier = new Map(animalsByIdentifier.map((item) => [item.identifier?.toLocaleLowerCase("it-IT") ?? "", item.id]));
    const ownedCycleIds = new Set(cycles.map((item) => item.id));
    const ownedClutchIds = new Set(clutches.map((item) => item.id));
    const ownedClutchCycleById = new Map(clutches.map((item) => [item.id, item.cycleId]));
    const ownedDocumentIds = new Set(documents.map((item) => item.id));
    const errors: Report["errors"] = [];
    const validRows: Row[] = [];
    const schema = schemas[entity as Entity];
    for (const row of sourceRows) {
      const record = { ...row.record };
      let relationError: { column: string; message: string } | undefined;
      const resolveAnimal = (idValue: unknown, identifierValue: unknown): string | null | undefined => {
        if (typeof idValue === "string" && idValue) return ownedAnimalIds.has(idValue) ? idValue : undefined;
        if (typeof identifierValue === "string" && identifierValue) return ownedAnimalByIdentifier.get(identifierValue.toLocaleLowerCase("it-IT"));
        return null;
      };
      if (entity === "finance" || entity === "reproductiveEvents") {
        const animal = resolveAnimal(record.animalId, record.animalIdentifier);
        if ((record.animalId || record.animalIdentifier) && !animal) relationError = { column: record.animalId ? "animalId" : "animalIdentifier", message: "Animal not found in this account" };
        else record.animalId = animal ?? null;
        delete record.animalIdentifier;
      }
      if (entity === "reproductionCycles") {
        for (const pair of [["parentAAnimalId", "parentAAnimalIdentifier"], ["parentBAnimalId", "parentBAnimalIdentifier"]] as const) {
          const animal = resolveAnimal(record[pair[0]], record[pair[1]]);
          if ((record[pair[0]] || record[pair[1]]) && !animal) relationError = { column: pair[0], message: "Parent animal not found in this account" };
          else record[pair[0]] = animal ?? null;
          delete record[pair[1]];
        }
      }
      if (["reproductiveEvents", "clutches", "offspringBatches"].includes(entity as string)) {
        if (!ownedCycleIds.has(String(record.cycleId))) relationError = { column: "cycleId", message: "Cycle not found in this account" };
      }
      if (["eggs", "incubationLogs"].includes(entity as string)
        || (entity === "offspringBatches" && record.clutchId !== null && record.clutchId !== undefined && record.clutchId !== "")) {
        const clutchId = String(record.clutchId);
        if (!ownedClutchIds.has(clutchId)) {
          relationError = { column: "clutchId", message: "Clutch not found in this account" };
        } else if (entity === "offspringBatches" && ownedClutchCycleById.get(clutchId) !== record.cycleId) {
          relationError = { column: "clutchId", message: "Clutch and offspring batch must belong to the same cycle" };
        }
      }
      if (entity === "finance" && record.documentId) {
        if (!ownedDocumentIds.has(String(record.documentId))) relationError = { column: "documentId", message: "Document not found in this account" };
      }
      if (relationError) { errors.push({ row: row.rowNumber, column: map[relationError.column] ?? relationError.column, reason: relationError.message }); continue; }
      const validated = schema.safeParse(record);
      if (!validated.success) {
        for (const issue of validated.error.issues) {
          const field = String(issue.path[0] ?? "row");
          errors.push({ row: row.rowNumber, column: map[field] ?? field, reason: issue.message });
        }
        continue;
      }
      const data = validated.data as Record<string, unknown>;
      const dateFields = ["occurredOn", "startedOn", "endedOn", "laidOn", "bornOn"];
      let badDate = false;
      for (const field of dateFields) {
        if (typeof data[field] === "string" && data[field]) {
          try { dateOnly(data[field] as string); } catch {
            errors.push({ row: row.rowNumber, column: map[field] ?? field, reason: "Use a valid YYYY-MM-DD date" });
            badDate = true;
          }
        }
      }
      if (!badDate) validRows.push({ rowNumber: row.rowNumber, record: data });
    }
    const report: Report = { entityType: entity as Entity, fileType: file.fileType, headers: file.headers, selectedSheet: file.selectedSheet, sheets: file.sheets, validRows, errors };
    const job = await prisma.importJob.create({
      data: { userId: auth.userId, entityType: entity, storageKey: "database-preview-report", status: "preview",
        totalRows: file.rows.length, skippedCount: errors.length, errorCount: errors.length, expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        report: JSON.parse(JSON.stringify(report)) as never },
      select: { id: true, status: true, expiresAt: true },
    });
    res.status(201).json({ importId: job.id, entityType: entity, status: job.status, fileType: file.fileType, headers: file.headers,
      unmappedHeaders, sheets: file.sheets, selectedSheet: file.selectedSheet, totalRows: file.rows.length, validRows: validRows.length,
      invalidRows: errors.length, errors, preview: validRows.slice(0, 20), expiresAt: job.expiresAt });
  });

  router.post("/:id/confirm", requireSession, persistentRateLimit(30, "import-confirm"), async (req, res, next) => {
    const auth = res.locals.auth as AuthContext;
    const jobId = id(req.params.id);
    const current = await prisma.importJob.findFirst({ where: { id: jobId, userId: auth.userId } });
    if (!current) throw new AppError(404, "IMPORT_NOT_FOUND", "Import not found");
    if (!entities.includes(current.entityType as Entity)) { next(); return; }
    if (current.status !== "preview" || current.expiresAt <= new Date()) {
      throw new AppError(409, "IMPORT_NOT_CONFIRMABLE", "The import preview is no longer available");
    }
    const queued = await prisma.importJob.updateMany({
      where: { id: jobId, userId: auth.userId, entityType: current.entityType, status: "preview", expiresAt: { gt: new Date() } },
      data: {
        status: "queued", attempts: 0, processingStartedAt: null, leaseToken: null, lastErrorCode: null,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    if (queued.count !== 1) throw new AppError(409, "IMPORT_NOT_CONFIRMABLE", "The import has already been confirmed or expired");
    res.status(202).json({ importId: jobId, entityType: current.entityType, status: "queued", createdCount: 0, skippedCount: current.errorCount, errorCount: current.errorCount });
  });

  return router;
}
