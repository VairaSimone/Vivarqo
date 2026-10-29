import { Router, raw } from "express";
import type { NextFunction } from "express";
import type { Response } from "express";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";
import { requireSession, type AuthContext } from "../auth/session.js";
import { persistentRateLimit } from "../../middleware/persistent-rate-limit.js";
import { createAnimalSchema } from "./animals.schemas.js";
import { parseAnimalFile } from "./animal-file-parser.js";

const fileBody = raw({
  type: ["text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream"],
  limit: "5mb",
});

function parseUuid(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id || !z.string().uuid().safeParse(id).success) throw new AppError(400, "INVALID_ID", "Invalid import id");
  return id;
}

function normalizeHeader(value: string): string {
  return value.toLocaleLowerCase("it-IT").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

const aliases: Record<string, string> = {
  name: "name", nome: "name", nomedisplay: "name", nomevisualizzato: "name", nomeanimale: "name", animalname: "name",
  identifier: "identifier", id: "identifier", codice: "identifier", codiceidentificativo: "identifier", identificativo: "identifier",
  species: "species", specie: "species", speciesname: "species",
  sex: "sex", sesso: "sex",
  morph: "morph", morfo: "morph", morphologia: "morph",
  geneticsnotes: "geneticsNotes", annotazionigenetiche: "geneticsNotes", genetica: "geneticsNotes", geneticnotes: "geneticsNotes",
  birthdate: "birthDate", datadinascita: "birthDate", nascita: "birthDate",
  birthdateestimated: "birthDateEstimated", datastimata: "birthDateEstimated", nascitastimata: "birthDateEstimated",
  acquireddate: "acquiredDate", dataacquisizione: "acquiredDate", acquisizione: "acquiredDate",
  origindescription: "originDescription", provenienza: "originDescription", origine: "originDescription",
  previousbreeder: "previousBreeder", allevatoreprecedente: "previousBreeder",
  location: "locationLabel", locationlabel: "locationLabel", posizione: "locationLabel", alloggiamento: "locationLabel",
  status: "status", stato: "status",
  notes: "notes", note: "notes", notedellanimale: "notes",
};

type PreviewAnimal = z.output<typeof createAnimalSchema>;
interface RowError {
  row: number;
  column: string;
  reason: string;
}
interface PotentialDuplicate {
  row: number;
  name: string;
  species: string;
  matches: Array<{ id: string; name: string; species: string; identifier: string | null }>;
}
interface PreviewReport {
  headers: string[];
  unmappedHeaders: string[];
  selectedSheet: string | null;
  sheets: string[];
  fileType: "csv" | "xlsx";
  validRows: Array<{ rowNumber: number; animal: PreviewAnimal }>;
  errors: RowError[];
  potentialDuplicates: PotentialDuplicate[];
}

function normalizeDate(value: string): string {
  const text = value.trim();
  if (!text) return text;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text.slice(0, 10);
  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial >= 1 && serial <= 100_000) {
      const milliseconds = Math.round(serial) * 86_400_000 + Date.UTC(1899, 11, 30);
      return new Date(milliseconds).toISOString().slice(0, 10);
    }
  }
  return text;
}

function convertValue(field: string, value: string): unknown {
  const trimmed = value.trim();
  if (field === "birthDate" || field === "acquiredDate") return trimmed ? normalizeDate(trimmed) : undefined;
  if (field === "birthDateEstimated") {
    if (!trimmed) return false;
    const normalized = normalizeHeader(trimmed);
    if (["true", "1", "si", "yes", "vero"].includes(normalized)) return true;
    if (["false", "0", "no", "falso"].includes(normalized)) return false;
    return trimmed;
  }
  if (field === "sex" && !trimmed) return "unknown";
  if (field === "status" && !trimmed) return "active";
  if (["identifier", "morph", "geneticsNotes", "originDescription", "previousBreeder", "locationLabel", "notes"].includes(field)) {
    return trimmed || null;
  }
  return trimmed || undefined;
}

function makePreview(
  headers: string[],
  fileRows: Array<{ rowNumber: number; values: Record<string, string> }>,
  fileType: "csv" | "xlsx",
  sheets: string[],
  selectedSheet: string | null,
): { report: PreviewReport; mappedHeaders: Record<string, string> } {
  const mappedHeaders: Record<string, string> = {};
  const unmappedHeaders: string[] = [];
  for (const header of headers) {
    const field = aliases[normalizeHeader(header)];
    if (!field) {
      unmappedHeaders.push(header);
      continue;
    }
    if (mappedHeaders[field]) {
      throw new AppError(400, "IMPORT_HEADER_AMBIGUOUS", "More than one column maps to the same Vivarqo field", {
        field,
        columns: [mappedHeaders[field], header],
      });
    }
    mappedHeaders[field] = header;
  }
  const missingRequired = ["name", "species"].filter((field) => !mappedHeaders[field]);
  if (missingRequired.length) {
    throw new AppError(400, "IMPORT_REQUIRED_COLUMNS", "The file needs columns for name and species", {
      missingFields: missingRequired,
      recognizedColumns: mappedHeaders,
      availableHeaders: headers,
    });
  }

  const validRows: PreviewReport["validRows"] = [];
  const errors: RowError[] = [];
  const seenIdentifiers = new Set<string>();
  for (const row of fileRows) {
    const raw: Record<string, unknown> = {};
    for (const [field, header] of Object.entries(mappedHeaders)) {
      raw[field] = convertValue(field, row.values[header] ?? "");
    }
    const parsed = createAnimalSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "row");
        errors.push({
          row: row.rowNumber,
          column: mappedHeaders[field] ?? field,
          reason: issue.message,
        });
      }
      continue;
    }

    const identifier = parsed.data.identifier?.trim().toLocaleLowerCase("it-IT");
    if (identifier && seenIdentifiers.has(identifier)) {
      errors.push({ row: row.rowNumber, column: mappedHeaders.identifier ?? "identifier", reason: "Duplicate identifier in this file" });
      continue;
    }
    if (identifier) seenIdentifiers.add(identifier);
    validRows.push({ rowNumber: row.rowNumber, animal: parsed.data });
  }
  return {
    report: { headers, unmappedHeaders, selectedSheet, sheets, fileType, validRows, errors, potentialDuplicates: [] },
    mappedHeaders,
  };
}

function readReport(value: unknown): PreviewReport {
  if (typeof value !== "object" || value === null || !("validRows" in value) || !Array.isArray((value as PreviewReport).validRows)) {
    throw new AppError(500, "IMPORT_REPORT_INVALID", "Import preview could not be read");
  }
  return value as PreviewReport;
}

function authId(res: Response): string {
  return (res.locals.auth as AuthContext).userId;
}

export function createImportRouter() {
  const router = Router();

  router.post("/", requireSession, persistentRateLimit(10, "import-create"), fileBody, async (req, res, next: NextFunction) => {
    const entity = typeof req.query.entity === "string" ? req.query.entity : "animals";
    if (entity !== "animals") { next(); return; }
    const userId = authId(res);
    if (!Buffer.isBuffer(req.body)) throw new AppError(400, "IMPORT_FILE_REQUIRED", "Upload a CSV or XLSX file as the request body");
    const mime = (req.get("content-type") ?? "").split(";")[0]!.trim().toLocaleLowerCase("en-US");
    const selectedSheet = typeof req.query.sheet === "string" ? req.query.sheet : undefined;
    const file = parseAnimalFile(req.body, mime, selectedSheet);
    const { report: preview } = makePreview(file.headers, file.rows, file.fileType, file.sheets, file.selectedSheet);

    const identifiers = preview.validRows
      .map((row) => row.animal.identifier)
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    if (identifiers.length) {
      const existingIdentifiers = await prisma.animal.findMany({
        where: { userId, identifier: { in: identifiers, mode: "insensitive" } },
        select: { identifier: true },
      });
      const existing = new Set(existingIdentifiers.map((item) => item.identifier?.toLocaleLowerCase("it-IT")));
      const duplicates = new Set(identifiers.filter((identifier) => existing.has(identifier.toLocaleLowerCase("it-IT"))));
      if (duplicates.size) {
        const removed = preview.validRows.filter((row) => row.animal.identifier && duplicates.has(row.animal.identifier));
        for (const row of removed) {
          preview.errors.push({
            row: row.rowNumber,
            column: "identifier",
            reason: "This identifier already exists in your account",
          });
        }
        preview.validRows = preview.validRows.filter((row) => !row.animal.identifier || !duplicates.has(row.animal.identifier));
      }
    }

    const nameSpeciesPairs = new Map<string, { name: string; species: string }>();
    for (const row of preview.validRows) {
      const key = JSON.stringify([
        row.animal.name.toLocaleLowerCase("it-IT"),
        row.animal.species.toLocaleLowerCase("it-IT"),
      ]);
      if (!nameSpeciesPairs.has(key)) {
        nameSpeciesPairs.set(key, { name: row.animal.name, species: row.animal.species });
      }
    }
    if (nameSpeciesPairs.size) {
      const pairs = [...nameSpeciesPairs.values()];
      const matches: Array<{ id: string; name: string; species: string; identifier: string | null }> = [];
      // Bound OR-query size but inspect every unique pair, not only the first
      // 500 rows in a large import file.
      for (let offset = 0; offset < pairs.length; offset += 250) {
        const candidates = pairs.slice(offset, offset + 250).map((pair) => ({
          name: { equals: pair.name, mode: "insensitive" as const },
          species: { equals: pair.species, mode: "insensitive" as const },
        }));
        matches.push(...await prisma.animal.findMany({
          where: { userId, OR: candidates },
          select: { id: true, name: true, species: true, identifier: true },
        }));
      }
      // Index existing candidates once: filtering the full result set for every
      // imported row becomes quadratic for large files.
      const candidatesByNameAndSpecies = new Map<string, typeof matches>();
      for (const candidate of matches) {
        const key = JSON.stringify([
          candidate.name.toLocaleLowerCase("it-IT"),
          candidate.species.toLocaleLowerCase("it-IT"),
        ]);
        const bucket = candidatesByNameAndSpecies.get(key);
        if (bucket) bucket.push(candidate);
        else candidatesByNameAndSpecies.set(key, [candidate]);
      }
      preview.potentialDuplicates = preview.validRows.flatMap((row) => {
        const key = JSON.stringify([
          row.animal.name.toLocaleLowerCase("it-IT"),
          row.animal.species.toLocaleLowerCase("it-IT"),
        ]);
        const found = candidatesByNameAndSpecies.get(key) ?? [];
        return found.length ? [{ row: row.rowNumber, name: row.animal.name, species: row.animal.species, matches: found }] : [];
      });
    }

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const job = await prisma.importJob.create({
      data: {
        userId,
        entityType: "animals",
        storageKey: "database-preview-report",
        status: "preview",
        totalRows: file.rows.length,
        skippedCount: preview.errors.length,
        errorCount: preview.errors.length,
        expiresAt,
        report: JSON.parse(JSON.stringify(preview)) as never,
      },
      select: { id: true, status: true, expiresAt: true, totalRows: true },
    });
    res.status(201).json({
      importId: job.id,
      status: job.status,
      entityType: "animals",
      fileType: file.fileType,
      headers: preview.headers,
      unmappedHeaders: preview.unmappedHeaders,
      sheets: preview.sheets,
      selectedSheet: preview.selectedSheet,
      totalRows: file.rows.length,
      validRows: preview.validRows.length,
      invalidRows: preview.errors.length,
      possibleDuplicates: preview.potentialDuplicates,
      errors: preview.errors,
      preview: preview.validRows.slice(0, 20),
      expiresAt: job.expiresAt,
    });
  });

  router.get("/:id", requireSession, async (req, res) => {
    const userId = authId(res);
    const id = parseUuid(req.params.id!);
    const job = await prisma.importJob.findFirst({ where: { id, userId } });
    if (!job) throw new AppError(404, "IMPORT_NOT_FOUND", "Import not found");
    res.status(200).json({
      importId: job.id,
      entityType: job.entityType,
      status: job.status,
      totalRows: job.totalRows,
      createdCount: job.createdCount,
      skippedCount: job.skippedCount,
      errorCount: job.errorCount,
      expiresAt: job.expiresAt,
      report: job.report,
    });
  });

  router.post("/:id/confirm", requireSession, async (req, res, next: NextFunction) => {
    const userId = authId(res);
    const id = parseUuid(req.params.id!);
    const confirmSchema = z.object({ allowPossibleDuplicates: z.boolean().optional().default(false) }).strict();
    const body = confirmSchema.safeParse(req.body ?? {});
    if (!body.success) throw new AppError(400, "VALIDATION_ERROR", "Request validation failed");
    const current = await prisma.importJob.findFirst({ where: { id, userId } });
    if (!current) throw new AppError(404, "IMPORT_NOT_FOUND", "Import not found");
    if (current.entityType !== "animals") { next(); return; }
    if (current.status !== "preview" || current.expiresAt <= new Date()) {
      throw new AppError(409, "IMPORT_NOT_CONFIRMABLE", "The import preview is no longer available");
    }
    const previousReport = readReport(current.report);
    if (previousReport.potentialDuplicates.length > 0 && !body.data.allowPossibleDuplicates) {
      throw new AppError(409, "IMPORT_DUPLICATES_REQUIRE_CONFIRMATION", "Possible name/species duplicates require explicit confirmation", {
        possibleDuplicates: previousReport.potentialDuplicates,
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.importJob.updateMany({
        where: { id, userId, status: "preview", expiresAt: { gt: new Date() } },
        data: { status: "processing" },
      });
      if (claim.count !== 1) throw new AppError(409, "IMPORT_NOT_CONFIRMABLE", "The import has already been confirmed or expired");

      const job = await tx.importJob.findFirstOrThrow({ where: { id, userId } });
      const report = readReport(job.report);
      const identifiers = report.validRows.map((row) => row.animal.identifier).filter((value): value is string => Boolean(value));
      const existing = identifiers.length
        ? await tx.animal.findMany({ where: { userId, identifier: { in: identifiers, mode: "insensitive" } }, select: { identifier: true } })
        : [];
      const existingSet = new Set(existing.map((animal) => animal.identifier?.toLocaleLowerCase("it-IT")));
      const finalErrors = [...report.errors];
      const animalsToCreate = report.validRows.filter((row) => {
        const identifier = row.animal.identifier;
        if (identifier && existingSet.has(identifier.toLocaleLowerCase("it-IT"))) {
          finalErrors.push({ row: row.rowNumber, column: "identifier", reason: "This identifier already exists in your account at confirmation time" });
          return false;
        }
        return true;
      });

      // One batched INSERT instead of up to 5,000 sequential INSERTs inside
      // the transaction. The report only needs the created IDs, not row ordering.
      const createdAnimals = animalsToCreate.length
        ? await tx.animal.createManyAndReturn({
            data: animalsToCreate.map(({ animal: input }) => ({
              userId,
              name: input.name,
              identifier: input.identifier ?? null,
              species: input.species,
              sex: input.sex,
              morph: input.morph ?? null,
              geneticsNotes: input.geneticsNotes ?? null,
              birthDate: input.birthDate ? new Date(`${input.birthDate}T00:00:00.000Z`) : null,
              birthDateEstimated: input.birthDateEstimated,
              acquiredDate: input.acquiredDate ? new Date(`${input.acquiredDate}T00:00:00.000Z`) : null,
              originDescription: input.originDescription ?? null,
              previousBreeder: input.previousBreeder ?? null,
              locationLabel: input.locationLabel ?? null,
              status: input.status,
              notes: input.notes ?? null,
            })),
            select: { id: true },
          })
        : [];
      const createdIds = createdAnimals.map((animal) => animal.id);

      await tx.auditEvent.create({
        data: {
          userId,
          action: "animal.import_confirmed",
          entityType: "import_job",
          entityId: id,
          metadata: { created: createdIds.length, skipped: report.validRows.length - createdIds.length + finalErrors.length, total: report.validRows.length + report.errors.length },
        },
      });
      const finalReport = {
        ...report,
        importedAnimalIds: createdIds,
        errors: finalErrors,
        createdCount: createdIds.length,
        skippedCount: report.validRows.length - createdIds.length + report.errors.length,
      };
      const updated = await tx.importJob.update({
        where: { id },
        data: {
          status: "completed",
          createdCount: createdIds.length,
          skippedCount: finalReport.skippedCount,
          errorCount: finalErrors.length,
          report: JSON.parse(JSON.stringify(finalReport)) as never,
        },
      });
      return { job: updated, finalReport };
    });
    res.status(200).json({
      importId: result.job.id,
      status: result.job.status,
      createdCount: result.job.createdCount,
      skippedCount: result.job.skippedCount,
      errorCount: result.job.errorCount,
      report: result.finalReport,
    });
  });

  return router;
}

