import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "./prisma.js";
import { logger } from "../logger.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const prismaSchemaPath = resolve(projectRoot, "backend/prisma/schema.prisma");
const initialMigrationName = "20261028000000_initial";
const initialMigrationPath = resolve(projectRoot, "backend/prisma/migrations", initialMigrationName, "migration.sql");

type ExpectedModel = { table: string; columns: string[] };
type ExpectedSchema = {
  models: ExpectedModel[];
  indexes: string[];
  constraints: string[];
  triggers: string[];
  functions: string[];
  requiresCitext: boolean;
};
type SchemaRows = { tableName: string; columnName: string };
type MigrationRow = { migrationName: string; finishedAt: Date | null; rolledBackAt: Date | null };

export type SchemaIntegrityReport = {
  tableCount: number;
  columnCount: number;
  issues: string[];
};

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function parseExpectedSchema(): ExpectedSchema {
  let prismaSource: string;
  let migrationSource: string;
  try {
    prismaSource = readFileSync(prismaSchemaPath, "utf8");
    migrationSource = readFileSync(initialMigrationPath, "utf8");
  } catch (error) {
    throw new Error(
      "Database schema files are missing from the runtime image. Include backend/prisma/schema.prisma and backend/prisma/migrations in the deployment.",
      { cause: error },
    );
  }

  const modelBlocks = [...prismaSource.matchAll(/^model\s+([A-Za-z_]\w*)\s*\{([\s\S]*?)^\}/gm)];
  if (modelBlocks.length === 0) throw new Error("No Prisma models were found in prisma/schema.prisma.");
  const modelNames = new Set(modelBlocks.map((match) => match[1]!));
  const models: ExpectedModel[] = [];

  for (const match of modelBlocks) {
    const modelName = match[1]!;
    const body = match[2]!;
    const tableMatch = body.match(/^\s*@@map\("([^"]+)"\)/m);
    if (!tableMatch) {
      throw new Error("Prisma model " + modelName + " must define an explicit @@map table name for startup schema verification.");
    }

    const columns: string[] = [];
    for (const line of body.split(/\r?\n/)) {
      const field = line.match(/^\s{2}([A-Za-z_]\w*)\s+([A-Za-z_]\w*(?:\[\])?\??)(.*)$/);
      if (!field) continue;
      const fieldName = field[1]!;
      const fieldType = field[2]!;
      const baseType = fieldType.replace(/\?|\[\]/g, "");
      if (modelNames.has(baseType)) continue;

      const mappedColumn = field[3]!.match(/@map\("([^"]+)"\)/);
      columns.push(mappedColumn?.[1] ?? fieldName);
    }

    if (columns.length === 0) throw new Error("No scalar columns were parsed for Prisma model " + modelName + ".");
    models.push({ table: tableMatch[1]!, columns: unique(columns) });
  }

  const indexes = unique([
    ...[...migrationSource.matchAll(/^[ \t]*CREATE\s+(?:UNIQUE\s+)?INDEX\s+([A-Za-z_]\w*)/gim)].map((match) => match[1]!),
    ...models.map((model) => model.table + "_pkey"),
  ]);
  const constraints = unique([
    ...[...migrationSource.matchAll(/^[ \t]{4}CONSTRAINT\s+([A-Za-z_]\w*)/gim)].map((match) => match[1]!),
    ...[...migrationSource.matchAll(/^[ \t]+ADD CONSTRAINT\s+([A-Za-z_]\w*)/gim)].map((match) => match[1]!),
    ...models.map((model) => model.table + "_pkey"),
  ]);
  const triggers = unique(
    [...migrationSource.matchAll(/^[ \t]*CREATE TRIGGER\s+([A-Za-z_]\w*)/gim)].map((match) => match[1]!),
  );
  const functions = unique(
    [...migrationSource.matchAll(/^[ \t]*CREATE OR REPLACE FUNCTION\s+([A-Za-z_]\w*)/gim)].map((match) => match[1]!),
  );

  return {
    models,
    indexes,
    constraints,
    triggers,
    functions,
    requiresCitext: /CREATE EXTENSION IF NOT EXISTS citext/i.test(migrationSource),
  };
}

const expectedSchema = parseExpectedSchema();

export async function inspectDatabaseSchema(): Promise<SchemaIntegrityReport> {
  const [columns, indexes, constraints, triggers, functions, extensions] = await Promise.all([
    prisma.$queryRawUnsafe<SchemaRows[]>(
      "SELECT table_name AS \"tableName\", column_name AS \"columnName\" " +
      "FROM information_schema.columns WHERE table_schema = 'public'",
    ),
    prisma.$queryRawUnsafe<Array<{ indexName: string }>>(
      "SELECT indexname AS \"indexName\" FROM pg_indexes WHERE schemaname = 'public'",
    ),
    prisma.$queryRawUnsafe<Array<{ constraintName: string }>>(
      "SELECT constraint_name AS \"constraintName\" FROM information_schema.table_constraints WHERE constraint_schema = 'public'",
    ),
    prisma.$queryRawUnsafe<Array<{ triggerName: string }>>(
      "SELECT t.tgname AS \"triggerName\" FROM pg_trigger t " +
      "JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace " +
      "WHERE n.nspname = 'public' AND NOT t.tgisinternal",
    ),
    prisma.$queryRawUnsafe<Array<{ functionName: string }>>(
      "SELECT p.proname AS \"functionName\" FROM pg_proc p " +
      "JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'",
    ),
    prisma.$queryRawUnsafe<Array<{ extensionName: string }>>(
      "SELECT extname AS \"extensionName\" FROM pg_extension",
    ),
  ]);

  const existingTables = new Set(columns.map((item) => item.tableName));
  const existingColumns = new Map<string, Set<string>>();
  for (const item of columns) {
    const tableColumns = existingColumns.get(item.tableName) ?? new Set<string>();
    tableColumns.add(item.columnName);
    existingColumns.set(item.tableName, tableColumns);
  }

  const issues: string[] = [];
  for (const model of expectedSchema.models) {
    if (!existingTables.has(model.table)) {
      issues.push("missing table: " + model.table);
      continue;
    }
    for (const column of model.columns) {
      if (!existingColumns.get(model.table)?.has(column)) {
        issues.push("missing column: " + model.table + "." + column);
      }
    }
  }

  const existingIndexes = new Set(indexes.map((item) => item.indexName));
  for (const name of expectedSchema.indexes) {
    if (!existingIndexes.has(name)) issues.push("missing index: " + name);
  }

  const existingConstraints = new Set(constraints.map((item) => item.constraintName));
  for (const name of expectedSchema.constraints) {
    if (!existingConstraints.has(name)) issues.push("missing constraint: " + name);
  }

  const existingTriggers = new Set(triggers.map((item) => item.triggerName));
  for (const name of expectedSchema.triggers) {
    if (!existingTriggers.has(name)) issues.push("missing trigger: " + name);
  }

  const existingFunctions = new Set(functions.map((item) => item.functionName));
  for (const name of expectedSchema.functions) {
    if (!existingFunctions.has(name)) issues.push("missing function: " + name);
  }

  const existingExtensions = new Set(extensions.map((item) => item.extensionName));
  if (expectedSchema.requiresCitext && !existingExtensions.has("citext")) {
    issues.push("missing PostgreSQL extension: citext");
  }

  return {
    tableCount: existingTables.size,
    columnCount: columns.length,
    issues,
  };
}

function runPrismaMigrationCommand(args: string[]): Promise<void> {
  const cliPath = resolve(projectRoot, "node_modules/prisma/build/index.js");
  const configPath = resolve(projectRoot, "backend/prisma.config.ts");

  return new Promise((promiseResolve, promiseReject) => {
    const child = spawn(
      process.execPath,
      [cliPath, "migrate", ...args, "--config", configPath],
      {
        cwd: projectRoot,
        env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr?.on("data", (chunk: string) => { stderr += chunk; });

    child.on("error", (error) => {
      promiseReject(new Error("Could not start Prisma CLI for database migration.", { cause: error }));
    });
    child.on("close", (code, signal) => {
      if (code === 0) {
        promiseResolve();
        return;
      }
      const rawOutput = (stderr + "\n" + stdout).trim().slice(-8_000);
      const safeOutput = rawOutput.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[database URL redacted]");
      promiseReject(
        new Error(
          "Prisma migrate " + args.join(" ") + " failed (" + (code === null ? signal ?? "unknown" : code) + "): " +
          (safeOutput || "No diagnostic output was returned."),
        ),
      );
    });
  });
}

async function waitForPostgres(): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await prisma.$queryRawUnsafe("SELECT 1");
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 10) break;
      logger.warn({ attempt, maxAttempts: 10 }, "Waiting for PostgreSQL before applying schema migrations");
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 1_000));
    }
  }
  throw new Error(
    "PostgreSQL is not reachable using DATABASE_URL, or the target database does not exist. " +
    "Create the target database in PostgreSQL first; application startup was aborted.",
    { cause: lastError },
  );
}

async function currentPublicTableNames(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ tableName: string }>>(
    "SELECT table_name AS \"tableName\" FROM information_schema.tables " +
    "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
  );
  return rows.map((row) => row.tableName);
}

function describeIssues(report: SchemaIntegrityReport): string {
  return report.issues.slice(0, 30).join("; ") +
    (report.issues.length > 30 ? "; ... and " + (report.issues.length - 30) + " more" : "");
}

/**
 * Applies all pending versioned Prisma migrations before the HTTP server starts.
 * A database created manually from the supplied SQL is automatically baselined
 * only after its tables, columns, indexes, constraints, triggers and functions
 * have been verified. A partial/untracked schema is never overwritten.
 */
export async function ensureDatabaseSchema(): Promise<SchemaIntegrityReport> {
  await waitForPostgres();

  const tables = await currentPublicTableNames();
  const hasMigrationTable = tables.includes("_prisma_migrations");
  const applicationTables = tables.filter((name) => name !== "_prisma_migrations");
  let initialApplied = false;
  let historyRowsExist = false;

  if (hasMigrationTable) {
    const rows = await prisma.$queryRawUnsafe<MigrationRow[]>(
      "SELECT migration_name AS \"migrationName\", finished_at AS \"finishedAt\", rolled_back_at AS \"rolledBackAt\" " +
      "FROM public._prisma_migrations",
    );
    historyRowsExist = rows.length > 0;
    initialApplied = rows.some((row) =>
      row.migrationName === initialMigrationName && row.finishedAt !== null && row.rolledBackAt === null,
    );
  }

  if (applicationTables.length > 0 && !initialApplied) {
    if (historyRowsExist) {
      throw new Error(
        "The database contains migration history, but the initial Vivarqo migration is not marked as successfully applied. " +
        "Startup will not rewrite migration history automatically; inspect prisma_migrations and restore/reconcile it from a backup.",
      );
    }

    const existingReport = await inspectDatabaseSchema();
    if (existingReport.issues.length > 0) {
      throw new Error(
        "The database has tables but no recorded Vivarqo migration, and its schema is incomplete. " +
        "To protect existing data, startup will not overwrite or guess how to repair it. Missing objects: " +
        describeIssues(existingReport),
      );
    }

    logger.warn(
      { migration: initialMigrationName },
      "Verified a complete existing Vivarqo schema; recording the initial migration baseline",
    );
    await runPrismaMigrationCommand(["resolve", "--applied", initialMigrationName]);
  }

  logger.info("Applying pending PostgreSQL schema migrations");
  await runPrismaMigrationCommand(["deploy"]);

  const report = await inspectDatabaseSchema();
  if (report.issues.length > 0) {
    logger.error(
      { tableCount: report.tableCount, columnCount: report.columnCount, issues: report.issues.slice(0, 30) },
      "PostgreSQL schema verification failed",
    );
    throw new Error(
      "The PostgreSQL database is still missing required Vivarqo schema objects after migrations. " +
      "Startup was aborted. Missing objects: " + describeIssues(report),
    );
  }

  logger.info(
    { tableCount: report.tableCount, columnCount: report.columnCount },
    "Vivarqo PostgreSQL schema verified and up to date",
  );
  return report;
}
