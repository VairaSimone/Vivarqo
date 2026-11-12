import { describe, expect, it } from "vitest";
import { normalizeImportDate } from "../src/modules/animals/import.routes.js";

describe("Animal import date normalization", () => {
  it("keeps the Excel calendar day when the serial contains a time fraction", () => {
    // Excel serial 45292 is 2024-01-01; the fraction represents 18:00.
    expect(normalizeImportDate("45292.75")).toBe("2024-01-01");
  });

  it("converts whole Excel date serials and leaves ISO dates unchanged", () => {
    expect(normalizeImportDate("45292")).toBe("2024-01-01");
    expect(normalizeImportDate("2024-01-01")).toBe("2024-01-01");
  });
});
