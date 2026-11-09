import { readFileSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "./prisma.js";
import { logger } from "../logger.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const prismaSchemaPath = resolve(projectRoot, "backend/prisma/schema.prisma");
const migrationsPath = resolve(projectRoot, "backend/prisma/migrations");

type ExpectedColumn = {
  name: string;
  pgType: string;
  nullable: boolean;
  maxLength?: number;
  precision?: number;
  scale?: number;
};
type ExpectedModel = { table: string; columns: ExpectedColumn[] };
type ExpectedIndex = {
  name: string;
  unique: boolean;
  tableName?: string;
  accessMethod?: string;
  keyExpressions?: string[];
  includedExpressions?: string[];
  predicate?: string | null;
};
type ExpectedSchema = {
  models: ExpectedModel[];
  indexes: ExpectedIndex[];
  constraints: string[];
  triggers: string[];
  functions: string[];
  migrations: string[];
  requiresCitext: boolean;
};
type SchemaRows = {
  tableName: string;
  columnName: string;
  udtName: string;
  isNullable: string;
  characterMaximumLength: number | null;
  numericPrecision: number | null;
  numericScale: number | null;
};
type MigrationRow = { migrationName: string; finishedAt: Date | null; rolledBackAt: Date | null };

export type SchemaIntegrityReport = {
  tableCount: number;
  columnCount: number;
  indexCount: number;
  constraintCount: number;
  issues: string[];
};

function unique(values: string[]): string[] {
  return [...new Set(values)];
}


function findMatchingParenthesis(value: string, openIndex: number): number {
  let depth = 0;
  let inString = false;
  let inIdentifier = false;
  for (let index = openIndex; index < value.length; index += 1) {
    const character = value[index]!;
    const next = value[index + 1];
    if (inString) {
      if (character === "'" && next === "'") index += 1;
      else if (character === "'") inString = false;
      continue;
    }
    if (inIdentifier) {
      if (character === '"' && next === '"') index += 1;
      else if (character === '"') inIdentifier = false;
      continue;
    }
    if (character === "'") inString = true;
    else if (character === '"') inIdentifier = true;
    else if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitTopLevelExpressions(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let inString = false;
  let inIdentifier = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    const next = value[index + 1];
    if (inString) {
      if (character === "'" && next === "'") index += 1;
      else if (character === "'") inString = false;
      continue;
    }
    if (inIdentifier) {
      if (character === '"' && next === '"') index += 1;
      else if (character === '"') inIdentifier = false;
      continue;
    }
    if (character === "'") inString = true;
    else if (character === '"') inIdentifier = true;
    else if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  const finalPart = value.slice(start).trim();
  if (finalPart) parts.push(finalPart);
  return parts;
}

function parseCreatedIndexes(sql: string): ExpectedIndex[] {
  const indexes: ExpectedIndex[] = [];
  const declaration = /\bCREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"((?:[^"]|"")*)"|([A-Za-z_]\w*))/gi;
  for (const match of sql.matchAll(declaration)) {
    const name = (match[2] ?? match[3]!).replace(/""/g, '"');
    const suffixStart = match.index! + match[0].length;
    const suffix = sql.slice(suffixStart);
    const onClause = suffix.match(
      /^\s+ON\s+(?:(?:"([^"]+)"|([A-Za-z_]\w*))\s*\.\s*)?(?:"([^"]+)"|([A-Za-z_]\w*))\s*(?:USING\s+([A-Za-z_]\w*)\s*)?\(/i,
    );
    if (!onClause) throw new Error("Could not parse CREATE INDEX table and key list for index " + name + ".");
    const openIndex = suffixStart + onClause[0].lastIndexOf("(");
    const closeIndex = findMatchingParenthesis(sql, openIndex);
    if (closeIndex < 0) throw new Error("Unclosed key list in CREATE INDEX " + name + ".");
    const keyExpressions = splitTopLevelExpressions(sql.slice(openIndex + 1, closeIndex));
    if (keyExpressions.length === 0) throw new Error("CREATE INDEX " + name + " has no key expressions.");

    let cursor = closeIndex + 1;
    const includeClause = sql.slice(cursor).match(/^\s*INCLUDE\s*\(/i);
    let includedExpressions: string[] = [];
    if (includeClause) {
      const includeOpen = cursor + includeClause[0].lastIndexOf("(");
      const includeClose = findMatchingParenthesis(sql, includeOpen);
      if (includeClose < 0) throw new Error("Unclosed INCLUDE list in CREATE INDEX " + name + ".");
      includedExpressions = splitTopLevelExpressions(sql.slice(includeOpen + 1, includeClose));
      cursor = includeClose + 1;
    }
    const predicateMatch = sql.slice(cursor).match(/^\s*WHERE\s+([\s\S]*?)(?:;|$)/i);
    const schemaName = onClause[1] ?? onClause[2];
    if (schemaName && schemaName !== "public") {
      throw new Error("CREATE INDEX " + name + " targets unsupported schema " + schemaName + ".");
    }
    indexes.push({
      name,
      unique: Boolean(match[1]),
      tableName: (onClause[3] ?? onClause[4])!,
      accessMethod: (onClause[5] ?? "btree").toLowerCase(),
      keyExpressions,
      includedExpressions,
      predicate: predicateMatch?.[1]?.trim() ?? null,
    });
  }
  return indexes;
}

function normalizeSqlExpression(value: string): string {
  let normalized = "";
  let inString = false;
  let inIdentifier = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    const next = value[index + 1];
    if (inString) {
      normalized += character;
      if (character === "'" && next === "'") {
        normalized += next;
        index += 1;
      } else if (character === "'") inString = false;
      continue;
    }
    if (inIdentifier) {
      if (character === '"' && next === '"') {
        normalized += '"';
        index += 1;
      } else if (character === '"') inIdentifier = false;
      else normalized += character;
      continue;
    }
    if (character === "'") {
      inString = true;
      normalized += character;
    } else if (character === '"') inIdentifier = true;
    else if (/\s/.test(character)) normalized += " ";
    else normalized += character.toLowerCase();
  }

  normalized = normalized
    .replace(/\bpublic\./g, "")
    .replace(/::(?:text|varchar|character varying|bpchar|boolean|bool|smallint|integer|int|bigint|uuid|date|timestamp(?: with| without)? time zone|numeric)(?:\([^)]*\))?/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // pg_get_expr() may add parentheses around the complete predicate. Remove
  // only grouping that encloses the entire expression, not function arguments.
  while (normalized.startsWith("(") && normalized.endsWith(")")) {
    const closing = findMatchingParenthesis(normalized, 0);
    if (closing !== normalized.length - 1) break;
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized;
}

function sameExpressions(expected: string[], actual: string[]): boolean {
  return expected.length === actual.length &&
    expected.every((expression, index) =>
      normalizeSqlExpression(expression) === normalizeSqlExpression(actual[index] ?? ""),
    );
}


function loadMigrations(): Array<{ name: string; sql: string }> {
  return readdirSync(migrationsPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(resolve(migrationsPath, name, "migration.sql"), "utf8"),
    }));
}

function databaseType(prismaType: string, isList: boolean, attributes: string): {
  pgType: string;
  maxLength?: number;
  precision?: number;
  scale?: number;
} {
  const override = attributes.match(/@db\.([A-Za-z][A-Za-z0-9]*)(?:\(([^)]*)\))?/);
  const args = override?.[2]?.split(",").map((value) => Number(value.trim())) ?? [];
  const overrideTypes: Record<string, string> = {
    Uuid: "uuid",
    Citext: "citext",
    VarChar: "varchar",
    Char: "bpchar",
    Text: "text",
    Timestamptz: "timestamptz",
    Timestamp: "timestamp",
    Date: "date",
    Time: "time",
    Decimal: "numeric",
    JsonB: "jsonb",
    Integer: "int4",
    BigInt: "int8",
    SmallInt: "int2",
    Boolean: "bool",
    DoublePrecision: "float8",
    Real: "float4",
    ByteA: "bytea",
  };
  const defaultTypes: Record<string, string> = {
    String: "text",
    DateTime: "timestamptz",
    Decimal: "numeric",
    Boolean: "bool",
    Int: "int4",
    BigInt: "int8",
    Float: "float8",
    Json: "jsonb",
    Bytes: "bytea",
  };
  const baseType = override?.[1] ? overrideTypes[override[1]] : defaultTypes[prismaType];
  if (!baseType) {
    throw new Error("Unsupported Prisma scalar type in schema integrity parser: " + prismaType);
  }
  return {
    pgType: isList ? "_" + baseType : baseType,
    ...(override?.[1] === "VarChar" || override?.[1] === "Char" ? { maxLength: args[0] } : {}),
    ...(override?.[1] === "Decimal" ? { precision: args[0], scale: args[1] } : {}),
  };
}

function parseExpectedSchema(): ExpectedSchema {
  const prismaSource = readFileSync(prismaSchemaPath, "utf8");
  const migrations = loadMigrations();
  if (migrations.length === 0) throw new Error("No versioned Prisma migrations were found.");

  const modelBlocks = [...prismaSource.matchAll(/^model\s+([A-Za-z_]\w*)\s*\{([\s\S]*?)^\}/gm)];
  if (modelBlocks.length === 0) throw new Error("No Prisma models were found in prisma/schema.prisma.");
  const modelNames = new Set(modelBlocks.map((match) => match[1]!));
  const models: ExpectedModel[] = [];

  for (const match of modelBlocks) {
    const modelName = match[1]!;
    const body = match[2]!;
    const tableName = body.match(/^\s*@@map\("([^"]+)"\)/m)?.[1];
    if (!tableName) throw new Error("Prisma model " + modelName + " must define an explicit @@map table name.");

    const columns: ExpectedColumn[] = [];
    for (const line of body.split(/\r?\n/)) {
      const field = line.match(/^\s{2}([A-Za-z_]\w*)\s+([A-Za-z_]\w*)(\[\])?(\?)?(.*)$/);
      if (!field) continue;
      const fieldName = field[1]!;
      const prismaType = field[2]!;
      const isList = Boolean(field[3]);
      const isNullable = Boolean(field[4]);
      const attributes = field[5]!;
      if (modelNames.has(prismaType) || attributes.includes("@ignore")) continue;

      const columnName = attributes.match(/@map\("([^"]+)"\)/)?.[1] ?? fieldName;
      const dbType = databaseType(prismaType, isList, attributes);
      columns.push({
        name: columnName,
        pgType: dbType.pgType,
        nullable: isNullable,
        ...(dbType.maxLength !== undefined ? { maxLength: dbType.maxLength } : {}),
        ...(dbType.precision !== undefined ? { precision: dbType.precision } : {}),
        ...(dbType.scale !== undefined ? { scale: dbType.scale } : {}),
      });
    }
    if (columns.length === 0) throw new Error("No scalar columns were parsed for Prisma model " + modelName + ".");
    models.push({ table: tableName, columns });
  }

  const allSql = migrations.map((migration) => migration.sql).join("\n");
  const indexes = new Map<string, ExpectedIndex>();
  for (const migration of migrations) {
    for (const expectedIndex of parseCreatedIndexes(migration.sql)) {
      indexes.set(expectedIndex.name, expectedIndex);
    }
  }

  const constraints = [
    ...[...allSql.matchAll(/^\s*CONSTRAINT\s+"?([A-Za-z_]\w*)"?\s+(?:PRIMARY KEY|UNIQUE|FOREIGN KEY|CHECK)\b/gim)].map((match) => match[1]!),
    ...[...allSql.matchAll(/^\s*ADD\s+CONSTRAINT\s+"?([A-Za-z_]\w*)"?\s+(?:PRIMARY KEY|UNIQUE|FOREIGN KEY|CHECK)\b/gim)].map((match) => match[1]!),
  ];
  for (const match of modelBlocks) {
    const body = match[2]!;
    const tableName = body.match(/^\s*@@map\("([^"]+)"\)/m)?.[1];
    if (!tableName) continue;
    const compositePrimaryKey = body.match(/@@id\([^\n]*map:\s*"([^"]+)"/)?.[1];
    if (compositePrimaryKey) {
      indexes.set(compositePrimaryKey, { name: compositePrimaryKey, unique: true });
      constraints.push(compositePrimaryKey);
    } else if (/@id\b/.test(body)) {
      indexes.set(tableName + "_pkey", { name: tableName + "_pkey", unique: true });
      constraints.push(tableName + "_pkey");
    }
  }

  return {
    models,
    indexes: [...indexes.values()],
    constraints: unique(constraints),
    triggers: unique([...allSql.matchAll(/CREATE\s+TRIGGER\s+"?([A-Za-z_]\w*)"?/gi)].map((match) => match[1]!)),
    functions: unique([...allSql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+"?([A-Za-z_]\w*)"?/gi)].map((match) => match[1]!)),
    migrations: migrations.map((migration) => migration.name),
    requiresCitext: /CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+citext/i.test(allSql),
  };
}

const expectedSchema = parseExpectedSchema();
const initialMigrationName = expectedSchema.migrations[0]!;

export async function inspectDatabaseSchema(): Promise<SchemaIntegrityReport> {
  const [columns, indexes, constraints, triggers, functions, extensions] = await Promise.all([
    prisma.$queryRawUnsafe<SchemaRows[]>(
      "SELECT table_name AS \"tableName\", column_name AS \"columnName\", udt_name AS \"udtName\", " +
      "is_nullable AS \"isNullable\", character_maximum_length AS \"characterMaximumLength\", " +
      "numeric_precision AS \"numericPrecision\", numeric_scale AS \"numericScale\" " +
      "FROM information_schema.columns WHERE table_schema = 'public'",
    ),
    prisma.$queryRawUnsafe<Array<{
      indexName: string;
      isValid: boolean;
      isReady: boolean;
      isUnique: boolean;
      definition: string;
    }>>(
      "SELECT idx.relname AS \\"indexName\\", i.indisvalid AS \\"isValid\\", " +
      "i.indisready AS \\"isReady\\", i.indisunique AS \\"isUnique\\", " +
      "pg_get_indexdef(i.indexrelid) AS \\"definition\\" " +
      "FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid JOIN pg_class tbl ON tbl.oid = i.indrelid " +
      "JOIN pg_namespace n ON n.oid = tbl.relnamespace WHERE n.nspname = 'public'",
    ),
    prisma.$queryRawUnsafe<Array<{ constraintName: string; isValidated: boolean }>>(
      "SELECT conname AS \"constraintName\", convalidated AS \"isValidated\" FROM pg_constraint WHERE connamespace = 'public'::regnamespace",
    ),
    prisma.$queryRawUnsafe<Array<{ triggerName: string; enabled: string }>>(
      "SELECT t.tgname AS \"triggerName\", t.tgenabled::text AS \"enabled\" FROM pg_trigger t " +
      "JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace " +
      "WHERE n.nspname = 'public' AND NOT t.tgisinternal",
    ),
    prisma.$queryRawUnsafe<Array<{ functionName: string }>>(
      "SELECT p.proname AS \"functionName\" FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'",
    ),
    prisma.$queryRawUnsafe<Array<{ extensionName: string }>>("SELECT extname AS \"extensionName\" FROM pg_extension"),
  ]);

  const existingTables = new Set(columns.map((item) => item.tableName));
  const existingColumns = new Map<string, Map<string, SchemaRows>>();
  for (const item of columns) {
    const tableColumns = existingColumns.get(item.tableName) ?? new Map<string, SchemaRows>();
    tableColumns.set(item.columnName, item);
    existingColumns.set(item.tableName, tableColumns);
  }

  const issues: string[] = [];
  for (const model of expectedSchema.models) {
    if (!existingTables.has(model.table)) {
      issues.push("missing table: " + model.table);
      continue;
    }
    for (const expected of model.columns) {
      const actual = existingColumns.get(model.table)?.get(expected.name);
      if (!actual) {
        issues.push("missing column: " + model.table + "." + expected.name);
        continue;
      }
      if (actual.udtName !== expected.pgType) {
        issues.push("wrong type: " + model.table + "." + expected.name + " expected " + expected.pgType + " found " + actual.udtName);
      }
      if ((actual.isNullable === "YES") !== expected.nullable) {
        issues.push("wrong nullability: " + model.table + "." + expected.name);
      }
      if (expected.maxLength !== undefined && actual.characterMaximumLength !== expected.maxLength) {
        issues.push("wrong maximum length: " + model.table + "." + expected.name);
      }
      if (expected.precision !== undefined && (actual.numericPrecision !== expected.precision || actual.numericScale !== expected.scale)) {
        issues.push("wrong numeric precision: " + model.table + "." + expected.name);
      }
    }
  }

  const actualIndexes = new Map(indexes.map((item) => [item.indexName, item]));
  for (const expected of expectedSchema.indexes) {
    const actual = actualIndexes.get(expected.name);
    if (!actual) {
      issues.push("missing index: " + expected.name);
      continue;
    }
    if (!actual.isValid || !actual.isReady) issues.push("invalid or not-ready index: " + expected.name);
    if (actual.isUnique !== expected.unique) issues.push("wrong uniqueness: " + expected.name);
    const parsedActual = parseCreatedIndexes(actual.definition)[0];
    if (
      !parsedActual ||
      (expected.tableName && parsedActual.tableName !== expected.tableName) ||
      (expected.accessMethod && parsedActual.accessMethod !== expected.accessMethod) ||
      (expected.keyExpressions && !sameExpressions(expected.keyExpressions, parsedActual.keyExpressions ?? [])) ||
      (expected.includedExpressions && !sameExpressions(expected.includedExpressions, parsedActual.includedExpressions ?? []))
    ) {
      issues.push("wrong index key definition: " + expected.name);
    }
    if (expected.predicate !== undefined) {
      const expectedPredicate = expected.predicate === null ? null : normalizeSqlExpression(expected.predicate);
      const actualPredicate = parsedActual?.predicate === null || parsedActual?.predicate === undefined
        ? null
        : normalizeSqlExpression(parsedActual.predicate);
      if (expectedPredicate !== actualPredicate) issues.push("wrong index predicate: " + expected.name);
    }
  }

  const actualConstraints = new Map(constraints.map((item) => [item.constraintName, item]));
  for (const name of expectedSchema.constraints) {
    const actual = actualConstraints.get(name);
    if (!actual) issues.push("missing constraint: " + name);
    else if (!actual.isValidated) issues.push("unvalidated constraint: " + name);
  }

  const actualTriggers = new Map(triggers.map((item) => [item.triggerName, item.enabled]));
  for (const name of expectedSchema.triggers) {
    const enabled = actualTriggers.get(name);
    if (enabled === undefined) issues.push("missing trigger: " + name);
    else if (enabled === "D") issues.push("disabled trigger: " + name);
  }

  const actualFunctions = new Set(functions.map((item) => item.functionName));
  for (const name of expectedSchema.functions) {
    if (!actualFunctions.has(name)) issues.push("missing function: " + name);
  }
  const existingExtensions = new Set(extensions.map((item) => item.extensionName));
  if (expectedSchema.requiresCitext && !existingExtensions.has("citext")) issues.push("missing extension: citext");

  return {
    tableCount: existingTables.size,
    columnCount: columns.length,
    indexCount: indexes.length,
    constraintCount: constraints.length,
    issues,
  };
}

function runPrismaMigrationCommand(args: string[]): Promise<void> {
  const cliPath = resolve(projectRoot, "node_modules/prisma/build/index.js");
  const configPath = resolve(projectRoot, "backend/prisma.config.ts");
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [cliPath, "migrate", ...args, "--config", configPath], {
      cwd: projectRoot,
      env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error) => rejectPromise(new Error("Could not start Prisma CLI.", { cause: error })));
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      const output = (stderr + "\n" + stdout).trim().slice(-8_000).replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[database URL redacted]");
      rejectPromise(new Error(
        "Prisma migrate " + args.join(" ") + " failed (" + (code === null ? signal ?? "unknown" : code) + "): " +
        (output || "No diagnostic output returned."),
      ));
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
      logger.warn({ attempt, maxAttempts: 10 }, "Waiting for PostgreSQL before schema verification");
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 1_000));
    }
  }
  throw new Error("PostgreSQL is not reachable or the DATABASE_URL target database does not exist.", { cause: lastError });
}

async function currentPublicTableNames(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ tableName: string }>>(
    "SELECT table_name AS \"tableName\" FROM information_schema.tables " +
    "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
  );
  return rows.map((row) => row.tableName);
}

function describeIssues(report: SchemaIntegrityReport): string {
  return report.issues.slice(0, 40).join("; ") +
    (report.issues.length > 40 ? "; ... and " + (report.issues.length - 40) + " more" : "");
}

export async function verifyDatabaseSchema(): Promise<SchemaIntegrityReport> {
  await waitForPostgres();
  const report = await inspectDatabaseSchema();
  if (report.issues.length > 0) {
    throw new Error("PostgreSQL schema verification failed; startup aborted. " + describeIssues(report));
  }
  return report;
}

/** Only the one-shot deployment migration job may call this function. */
export async function ensureDatabaseSchema(): Promise<SchemaIntegrityReport> {
  await waitForPostgres();
  const tables = await currentPublicTableNames();
  const hasMigrationTable = tables.includes("_prisma_migrations");
  const applicationTables = tables.filter((name) => name !== "_prisma_migrations");
  let migrationRows: MigrationRow[] = [];
  if (hasMigrationTable) {
    migrationRows = await prisma.$queryRawUnsafe<MigrationRow[]>(
      "SELECT migration_name AS \"migrationName\", finished_at AS \"finishedAt\", rolled_back_at AS \"rolledBackAt\" " +
      "FROM public._prisma_migrations",
    );
  }
  const appliedMigrations = new Set(
    migrationRows
      .filter((row) => row.finishedAt !== null && row.rolledBackAt === null)
      .map((row) => row.migrationName),
  );
  const initialApplied = appliedMigrations.has(initialMigrationName);
  const unfinishedMigrations = migrationRows.filter((row) => row.finishedAt === null && row.rolledBackAt === null);
  if (unfinishedMigrations.length > 0) {
    throw new Error(
      "The database contains unfinished Prisma migrations (" +
      unfinishedMigrations.map((row) => row.migrationName).join(", ") +
      "). Reconcile or roll back those migrations after taking a backup; automatic deployment was stopped.",
    );
  }

  if (applicationTables.length > 0 && !initialApplied) {
    if (migrationRows.length > 0) {
      throw new Error("Migration history exists without a successfully applied initial migration. Reconcile it manually; history was not changed.");
    }
    const existingReport = await inspectDatabaseSchema();
    if (existingReport.issues.length > 0) {
      throw new Error("The database contains a partial or outdated untracked schema. No objects were changed. " + describeIssues(existingReport));
    }
    logger.warn({ migrationCount: expectedSchema.migrations.length }, "Verified complete existing schema; baselining every versioned migration");
    for (const migration of expectedSchema.migrations) {
      await runPrismaMigrationCommand(["resolve", "--applied", migration]);
    }
  } else if (applicationTables.length > 0) {
    // If startup was interrupted while baselining a manually provisioned
    // complete schema, finish only the missing history rows after verifying
    // every current object. A genuinely older schema is left to migrate deploy.
    const missingBaseline = expectedSchema.migrations.filter((migration) => !appliedMigrations.has(migration));
    if (missingBaseline.length > 0) {
      const existingReport = await inspectDatabaseSchema();
      if (existingReport.issues.length === 0) {
        logger.warn({ migrationCount: missingBaseline.length }, "Completing baseline for a fully verified existing schema");
        for (const migration of missingBaseline) {
          await runPrismaMigrationCommand(["resolve", "--applied", migration]);
        }
      }
    }
  }

  await runPrismaMigrationCommand(["deploy"]);
  return verifyDatabaseSchema();
}
