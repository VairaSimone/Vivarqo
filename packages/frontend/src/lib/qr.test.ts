import { describe, expect, it } from "vitest";
import { qrMatrix } from "./qr";

describe("local QR encoder", () => {
  it("creates valid-sized matrices for QR versions 1 through 5", () => {
    expect(qrMatrix("A")).toHaveLength(21);
    expect(qrMatrix("A".repeat(18))).toHaveLength(25);
    expect(qrMatrix("A".repeat(33))).toHaveLength(29);
    expect(qrMatrix("A".repeat(54))).toHaveLength(33);
    expect(qrMatrix("A".repeat(79))).toHaveLength(37);
  });

  it("returns a square boolean matrix for an animal public URL", () => {
    const matrix = qrMatrix("https://vivarqo.it/public/animals/0123456789abcdefghijklmnopqrstuv");
    expect(matrix.every((row) => row.length === matrix.length)).toBe(true);
    expect(matrix.flat().every((cell) => typeof cell === "boolean")).toBe(true);
    expect(matrix[0]?.[0]).toBe(true);
    expect(matrix[0]?.[6]).toBe(true);
  });

  it("rejects values longer than the supported QR versions", () => {
    expect(() => qrMatrix("A".repeat(107))).toThrow("QR_VALUE_TOO_LONG");
  });
});
