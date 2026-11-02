import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrast(foreground: string, background: string): number {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

describe("WCAG AA theme contrast", () => {
  const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  const lightStart = css.indexOf(":root {");
  const lightEnd = css.indexOf("}", lightStart);
  const darkStart = css.indexOf(':root[data-theme="dark"] {');
  const darkEnd = css.indexOf("}", darkStart);
  const parseTokens = (source: string) => Object.fromEntries(
    [...source.matchAll(/^\s*--([\w-]+):\s*(#[\da-fA-F]{6})\s*;/gm)].map((match) => [match[1]!, match[2]!])
  );
  const light = parseTokens(css.slice(lightStart, lightEnd));
  const dark = parseTokens(css.slice(darkStart, darkEnd));

  const check = (tokens: Record<string, string>, foreground: string, background: string) => {
    const ratio = contrast(tokens[foreground]!, tokens[background]!);
    expect(ratio, `${foreground} on ${background} must meet 4.5:1; actual ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  };

  it("keeps primary and secondary text readable on light surfaces", () => {
    check(light, "text", "paper");
    check(light, "muted", "paper");
    check(light, "muted", "surface");
    check(light, "muted", "surface-soft");
    check(light, "forest-2", "paper");
    check(light, "terracotta", "paper");
  });

  it("keeps semantic status text readable on its corresponding backgrounds", () => {
    check(light, "success", "success-bg");
    check(light, "warning", "warning-bg");
    check(light, "danger", "danger-bg");
    check(light, "info", "info-bg");
  });

  it("keeps light dashboard text readable on the forest surface", () => {
    expect(contrast("#f3f5ef", light.forest!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#9fb1a5", light.forest!)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps dark theme text and status colors readable", () => {
    check(dark, "text", "paper");
    check(dark, "muted", "paper");
    check(dark, "muted", "surface");
    check(dark, "forest-2", "paper");
    check(dark, "terracotta", "paper");
    check(dark, "success", "success-bg");
    check(dark, "warning", "warning-bg");
    check(dark, "danger", "danger-bg");
    check(dark, "info", "info-bg");
  });
});
