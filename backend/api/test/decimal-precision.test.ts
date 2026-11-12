import { describe, expect, it } from "vitest";
import { decimalScale, decimalToScaledInteger, hasMaximumDecimalPlaces } from "../src/modules/domain/decimal-precision.js";

describe("fixed-scale decimal precision", () => {
  it.each(["0.001", "0.100", "1.001", "1.002", "1.003", "1.005", "12.345", "1e-3"])(
    "accepts %s as a value with at most three decimal places",
    (value) => expect(hasMaximumDecimalPlaces(value, 3)).toBe(true),
  );

  it.each(["1.0001", "0.0001", "1.2345", "1e-4"])(
    "rejects %s as a value with more than three decimal places",
    (value) => expect(hasMaximumDecimalPlaces(value, 3)).toBe(false),
  );

  it("treats trailing decimal zeroes as insignificant", () => {
    expect(decimalScale("0.100")).toBe(1);
    expect(decimalScale("1.0050")).toBe(3);
  });

  it("converts decimal values to thousandths without floating-point multiplication", () => {
    expect(decimalToScaledInteger("1.001", 3)).toBe(1001);
    expect(decimalToScaledInteger("1.005", 3)).toBe(1005);
    expect(decimalToScaledInteger("12.345", 3)).toBe(12345);
    expect(decimalToScaledInteger("1.0001", 3)).toBeNull();
  });
});
