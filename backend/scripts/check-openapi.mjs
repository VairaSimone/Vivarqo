import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const appFile = resolve(root, "backend/api/src/app.ts");
const modulesRoot = resolve(root, "backend/api/src/modules");
const openApiFile = resolve(root, "docs/openapi.yaml");

const appSource = readFileSync(appFile, "utf8");
const implemented = new Map();

function normalizePath(value) {
  const normalized = value.replace(/\{([^}]+)\}/g, ":$1").replace(/\/+$/, "");
  return normalized || "/";
}

function addOperation(method, path, source) {
  const operation = `${method.toUpperCase()} ${normalizePath(path)}`;
  if (!implemented.has(operation)) implemented.set(operation, new Set());
  implemented.get(operation).add(source);
}

function moduleFile(importPath) {
  const relative = importPath.replace(/^\.\//, "").replace(/\.js$/, ".ts");
  return resolve(root, "backend/api/src", relative);
}

const imports = new Map();
for (const match of appSource.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/gs)) {
  const importedNames = [...match[1].matchAll(/\b(create[A-Za-z0-9]+Router)\b/g)].map((item) => item[1]);
  for (const name of importedNames) imports.set(name, moduleFile(match[2]));
}

const mounts = new Map();
for (const [routerName, file] of imports) {
  const expression = new RegExp(`app\\.use\\(["']([^"']+)["']\\s*,\\s*${routerName}\\s*\\(`, "g");
  for (const match of appSource.matchAll(expression)) {
    const prefix = match[1].replace(/^\/api\/v1/, "");
    if (!mounts.has(file)) mounts.set(file, []);
    mounts.get(file).push(prefix);
  }
}

function scanRouterFile(file, prefixes) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/router\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/g)) {
    for (const prefix of prefixes) {
      const fullPath = `/api/v1${prefix}${match[2]}`.replace(/\/+/g, "/");
      addOperation(match[1], fullPath, file.replace(root + "/", ""));
    }
  }
}

for (const [file, prefixes] of mounts) scanRouterFile(file, prefixes);

// The export router is instantiated once and mounted at two stable public prefixes.
const exportFile = resolve(modulesRoot, "domain/exports.routes.ts");
const exportPrefixes = [...appSource.matchAll(/app\.use\(["'](\/api\/v1\/(?:exports|account\/export))["']\s*,\s*exportRouter\s*\)/g)]
  .map((match) => match[1].replace(/^\/api\/v1/, ""));
if (exportPrefixes.length) scanRouterFile(exportFile, exportPrefixes);

// Health/readiness endpoints are declared directly on the Express app.
for (const match of appSource.matchAll(/app\.(get|post|put|patch|delete)\s*\(\s*["'](\/healthz|\/readyz)["']/g)) {
  addOperation(match[1], match[2], "backend/api/src/app.ts");
}

const openApi = readFileSync(openApiFile, "utf8");
const lines = openApi.split(/\r?\n/);
const documented = new Set();
for (let index = 0; index < lines.length; index += 1) {
  const pathMatch = lines[index].match(/^  (\/[^:\s]+):\s*$/);
  if (!pathMatch) continue;
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    if (/^  \/[^:\s]+:\s*$/.test(lines[cursor]) || /^components:\s*$/.test(lines[cursor])) break;
    const methodMatch = lines[cursor].match(/^    (get|post|put|patch|delete):\s*$/);
    if (methodMatch) documented.add(`${methodMatch[1].toUpperCase()} ${normalizePath(pathMatch[1])}`);
  }
}

const missingDocumentation = [...implemented.keys()].filter((operation) => !documented.has(operation)).sort();
const staleDocumentation = [...documented].filter((operation) => !implemented.has(operation)).sort();

if (missingDocumentation.length || staleDocumentation.length) {
  console.error("OpenAPI/backend route mismatch.");
  if (missingDocumentation.length) {
    console.error("\nImplemented routes missing from docs/openapi.yaml:");
    for (const operation of missingDocumentation) {
      console.error(`  - ${operation} [${[...implemented.get(operation)].join(", ")}]`);
    }
  }
  if (staleDocumentation.length) {
    console.error("\nDocumented operations without a mounted backend route:");
    for (const operation of staleDocumentation) console.error(`  - ${operation}`);
  }
  process.exitCode = 1;
} else {
  console.log(`OpenAPI route coverage verified: ${documented.size} operations match mounted backend routes.`);
}
