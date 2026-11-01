import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const sourceDir = resolve(scriptDir, "../src");
const catalogPath = join(sourceDir, "i18n.ts");
const normalize = value => value.replace(/\s+/g, " ").trim();

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(fullPath));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) files.push(fullPath);
  }
  return files;
}

function parseSource(path, content) {
  return ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

const catalogContent = await readFile(catalogPath, "utf8");
const catalogSource = parseSource(catalogPath, catalogContent);
let catalogObject;
const findCatalog = node => {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "translations" && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
    catalogObject = node.initializer;
  }
  ts.forEachChild(node, findCatalog);
};
findCatalog(catalogSource);
if (!catalogObject) throw new Error("Could not locate the translations catalog in src/i18n.ts");

const catalogKeys = new Set();
const duplicateKeys = new Set();
for (const property of catalogObject.properties) {
  if (!ts.isPropertyAssignment(property)) continue;
  const name = property.name;
  if (!ts.isStringLiteral(name) && !ts.isNoSubstitutionTemplateLiteral(name)) continue;
  const key = normalize(name.text);
  if (catalogKeys.has(key)) duplicateKeys.add(key);
  catalogKeys.add(key);
}

const missing = new Map();
let checked = 0;
for (const path of await sourceFiles(sourceDir)) {
  if (path === catalogPath) continue;
  const content = await readFile(path, "utf8");
  const source = parseSource(path, content);
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t") {
      const argument = node.arguments[0];
      if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
        checked += 1;
        const key = normalize(argument.text);
        if (!catalogKeys.has(key)) {
          const location = source.getLineAndCharacterOfPosition(argument.getStart(source));
          const entries = missing.get(key) ?? [];
          entries.push(relative(sourceDir, path) + ":" + (location.line + 1));
          missing.set(key, entries);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (duplicateKeys.size || missing.size) {
  if (duplicateKeys.size) {
    console.error("Duplicate i18n keys:");
    for (const key of duplicateKeys) console.error("  - " + key);
  }
  if (missing.size) {
    console.error("Missing English translations for literal t() calls:");
    for (const [key, locations] of [...missing].sort(([a], [b]) => a.localeCompare(b))) {
      console.error("  - " + JSON.stringify(key) + " (" + locations.join(", ") + ")");
    }
  }
  process.exitCode = 1;
} else {
  console.log("i18n check passed: " + checked + " literal t() calls are covered by " + catalogKeys.size + " catalog entries.");
}
