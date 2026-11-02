import { describe, expect, it } from "vitest";
import { amountToCents, centsToAmount, formatDate, formatMoneyCents, getString, queryString } from "./domain";

describe("monetary helpers", () => {
  it("converts decimal euro amounts to integer cents without floating point drift", () => {
    expect(amountToCents("12,34")).toBe(1234);
    expect(amountToCents("0.10")).toBe(10);
    expect(centsToAmount("123456789012345")).toBe(1234567890123.45);
    expect(formatMoneyCents("1234", "it")).toContain("12,34");
  });

  it.each(["", "-1", "1.234", "1,234", "01.00", "0"])("rejects invalid or non-positive amounts: %s", (value) => {
    expect(() => amountToCents(value)).toThrow();
  });
});

describe("domain formatting helpers", () => {
  it("formats date-only values without shifting the day through UTC", () => {
    expect(formatDate("2026-11-02", "it")).toContain("2026");
  });

  it("omits empty query string fields and preserves falsy numeric values", () => {
    expect(queryString({ page: 0, q: "", active: false, nil: null })).toBe("?page=0&active=false");
  });

  it("converts number fields to display strings without treating objects as strings", () => {
    expect(getString({ weightG: 1250 }, "weightG")).toBe("1250");
    expect(getString({ animal: { name: "Nala" } }, "animal")).toBe("");
  });
});
