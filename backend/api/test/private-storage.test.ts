import { describe, expect, it } from "vitest";
import { validatePrivateImage } from "../src/modules/domain/private-storage.js";

describe("private animal image validation", () => {
  it("accepts JPEG, PNG and WebP only when the file signature matches its MIME", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0x00]);
    const webp = Buffer.from("RIFF0000WEBPVP8 ", "ascii");

    expect(validatePrivateImage(jpeg, "image/jpeg")).toEqual({ mimeType: "image/jpeg", extension: "jpg" });
    expect(validatePrivateImage(png, "image/png")).toEqual({ mimeType: "image/png", extension: "png" });
    expect(validatePrivateImage(webp, "image/webp")).toEqual({ mimeType: "image/webp", extension: "webp" });
  });

  it("rejects empty, SVG, PDF and unsupported binary content", () => {
    expect(() => validatePrivateImage(Buffer.alloc(0), "image/jpeg")).toThrowError(/empty/i);
    expect(() => validatePrivateImage(Buffer.from("<svg></svg>"), "image/svg+xml")).toThrowError(/only JPEG, PNG and WebP/i);
    expect(() => validatePrivateImage(Buffer.from("%PDF-1.7"), "application/pdf")).toThrowError(/only JPEG, PNG and WebP/i);
    expect(() => validatePrivateImage(Buffer.from("not an image"), "image/jpeg")).toThrowError(/only JPEG, PNG and WebP/i);
  });

  it("rejects MIME spoofing even when the bytes form a valid image", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
    expect(() => validatePrivateImage(jpeg, "image/png")).toThrowError(/content type does not match/i);
    expect(validatePrivateImage(jpeg, "application/octet-stream").mimeType).toBe("image/jpeg");
  });

  it("enforces a strict 5 MB limit", () => {
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1);
    oversized.set([0xff, 0xd8, 0xff]);
    expect(() => validatePrivateImage(oversized, "image/jpeg")).toThrowError(/5 MB/i);
  });
});
