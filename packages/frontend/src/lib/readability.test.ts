import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("frontend readability baseline", () => {
  const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  const baselineStart = css.lastIndexOf("/* Accessibility release baseline:");

  it("keeps operational copy at or above 12px and controls at readable sizes", () => {
    expect(baselineStart).toBeGreaterThanOrEqual(0);
    const baseline = css.slice(baselineStart);
    expect(baseline).toContain("font-size: max(12px, .75rem) !important");
    expect(baseline).toContain(".field-label");
    expect(baseline).toContain(".badge");
    expect(baseline).toContain("table, th, td");
    expect(baseline).toContain(".mobile-bottom-nav button");
    expect(baseline).toContain("font-size: 14px !important");
    expect(baseline).toContain("font-size: 16px !important");
  });

  it("does not let compact table preferences shrink readable row targets", () => {
    const baseline = css.slice(baselineStart);
    expect(baseline).toMatch(/data-compact-tables="true"\] th\s*\{\s*padding-block:\s*8px/s);
    expect(baseline).toMatch(/data-compact-tables="true"\] td\s*\{\s*min-height:\s*40px;\s*padding-block:\s*8px/s);
    expect(baseline).toContain(".table-wrap");
  });

  it("provides a visible keyboard skip-link focus state", () => {
    const baseline = css.slice(baselineStart);
    expect(baseline).toContain(".skip-link:focus");
    expect(baseline).toContain("#main-content");
  });
});
