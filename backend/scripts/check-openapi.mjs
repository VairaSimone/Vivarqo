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


// Source-linked JSON request schema validation
const contractProblems = [];
const contractLines = openApi.split(/\r?\n/);
const contractOps = [];
let contractPath = null;
for (let index = 0; index < contractLines.length; index += 1) {
  const pathMatch = contractLines[index].match(/^  (\/[^:\s]+):\s*$/);
  if (pathMatch) { contractPath = pathMatch[1]; continue; }
  const methodMatch = contractLines[index].match(/^    (get|post|put|patch|delete):\s*$/);
  if (!methodMatch || !contractPath) continue;
  let end = index + 1;
  while (end < contractLines.length &&
    !/^    (get|post|put|patch|delete):\s*$/.test(contractLines[end]) &&
    !/^  \/[^:\s]+:\s*$/.test(contractLines[end]) &&
    !/^components:\s*$/.test(contractLines[end])) end += 1;
  contractOps.push({
    path: contractPath,
    method: methodMatch[1].toUpperCase(),
    body: contractLines.slice(index, end).join("\n"),
  });
  index = end - 1;
}

const contractOperationIds = new Set();
for (const operation of contractOps) {
  const key = operation.method + " " + operation.path;
  const idMatch = operation.body.match(/^\s+operationId:\s*([^\s]+)\s*$/m);
  if (!idMatch) contractProblems.push(key + ": operationId missing");
  else if (contractOperationIds.has(idMatch[1])) contractProblems.push(key + ": duplicate operationId " + idMatch[1]);
  else contractOperationIds.add(idMatch[1]);

  const requestStart = operation.body.indexOf("requestBody:");
  const responseStart = operation.body.indexOf("responses:");
  const requestPart = requestStart >= 0
    ? operation.body.slice(requestStart, responseStart >= 0 ? responseStart : undefined)
    : "";
  if (requestPart.includes("application/json:")) {
    const source = requestPart.match(/x-source-validation:\s*\n\s+file:\s*([^\s]+)\s*\n\s+symbol:\s*([^\s]+)/);
    if (!source) {
      contractProblems.push(key + ": JSON request body has no x-source-validation link");
    } else {
      const sourcePath = resolve(root, source[1]);
      try {
        if (!readFileSync(sourcePath, "utf8").includes(source[2])) {
          contractProblems.push(key + ": validator symbol " + source[2] + " missing from " + source[1]);
        }
      } catch {
        contractProblems.push(key + ": validator source does not exist: " + source[1]);
      }
    }
    if (!requestPart.includes("schema:") && !requestPart.includes("$ref:")) {
      contractProblems.push(key + ": JSON request body has no schema");
    }
  }

  const responsePart = responseStart >= 0 ? operation.body.slice(responseStart) : "";
  const successMatches = [...responsePart.matchAll(/^        '(2\d\d)':\s*$/gm)];
  for (let i = 0; i < successMatches.length; i += 1) {
    const start = successMatches[i].index;
    const end = i + 1 < successMatches.length ? successMatches[i + 1].index : responsePart.length;
    const block = responsePart.slice(start, end);
    if (block.includes("application/json:") && !block.includes("schema:") && !block.includes("$ref:")) {
      contractProblems.push(key + ": successful JSON response has no schema");
    }
  }
}

if (/\bApiObject\b|requestBodies\/JsonObject|responses\/JsonSuccess/.test(openApi)) {
  contractProblems.push("Generic ApiObject, JsonObject and JsonSuccess placeholders are forbidden");
}

// Resolve all local component references in schemas, responses and parameters.
const componentNames = new Map();
let inComponentsSection = false;
let activeComponentSection = null;
for (const line of contractLines) {
  if (line === "components:") { inComponentsSection = true; continue; }
  if (!inComponentsSection) continue;
  const sectionMatch = line.match(/^  ([A-Za-z][A-Za-z0-9_-]*):\s*$/);
  if (sectionMatch) {
    activeComponentSection = sectionMatch[1];
    if (!componentNames.has(activeComponentSection)) componentNames.set(activeComponentSection, new Set());
    continue;
  }
  const itemMatch = line.match(/^    ([A-Za-z][A-Za-z0-9_.-]*):\s*$/);
  if (itemMatch && activeComponentSection) componentNames.get(activeComponentSection).add(itemMatch[1]);
}
for (const match of openApi.matchAll(/\$ref:\s*['"]?#\/components\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]+)/g)) {
  if (!componentNames.get(match[1])?.has(match[2])) {
    contractProblems.push("Unresolved component reference #/components/" + match[1] + "/" + match[2]);
  }
}
if (contractProblems.length) {
  console.error("OpenAPI contract checks failed:");
  for (const problem of [...new Set(contractProblems)]) console.error("  - " + problem);
  process.exitCode = 1;
} else {
  console.log("OpenAPI contract checks passed: " + contractOps.length +
    " operations, " + contractOperationIds.size +
    " unique operationIds, source-linked JSON request bodies, typed success responses and resolvable component references.");
}
