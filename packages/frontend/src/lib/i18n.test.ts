import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { translationKeys } from "./i18n";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("Italian and English translation dictionaries", () => {
  it("contains every static translation key referenced by the frontend", () => {
    const files = sourceFiles(resolve(process.cwd(), "src"));
    const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
    const used = new Set<string>();
    for (const match of source.matchAll(/\b(?:t|translate)\(\s*["']([^"']+)["']/g)) used.add(match[1]!);
    const dynamicPrefixes = new Set<string>();
    for (const match of source.matchAll(/\b(?:t|translate)\(\s*`([^`$]*)\$\{/g)) dynamicPrefixes.add(match[1]!);
    for (const match of source.matchAll(/\b(?:t|translate)\(\s*["']([^"']+_)["']\s*\+/g)) dynamicPrefixes.add(match[1]!);

    const italian = new Set(translationKeys.it);
    const english = new Set(translationKeys.en);
    const missing = [...used].filter((key) => !dynamicPrefixes.has(key) && (!italian.has(key) || !english.has(key)));
    expect(missing).toEqual([]);
  });

  it("keeps dynamic translation families available in both languages", () => {
    const files = sourceFiles(resolve(process.cwd(), "src"));
    const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
    const prefixes = new Set<string>();
    for (const match of source.matchAll(/\b(?:t|translate)\(\s*`([^`$]*)\$\{/g)) {
      if (match[1]) prefixes.add(match[1]);
    }
    for (const match of source.matchAll(/\b(?:t|translate)\(\s*["']([^"']+_)["']\s*\+/g)) {
      if (match[1]) prefixes.add(match[1]);
    }

    for (const prefix of prefixes) {
      const italian = translationKeys.it.filter((key) => key.startsWith(prefix)).sort();
      const english = translationKeys.en.filter((key) => key.startsWith(prefix)).sort();
      expect(italian.length, `no Italian keys for dynamic prefix ${prefix}`).toBeGreaterThan(0);
      expect(english, `English keys differ for dynamic prefix ${prefix}`).toEqual(italian);
    }
  });

  it("keeps the two dictionaries structurally aligned", () => {
    expect([...translationKeys.en].sort()).toEqual([...translationKeys.it].sort());
  });
});
