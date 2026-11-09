import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { singleBufferChunk, writeStreamingZip, type StreamingZipEntry } from "../src/modules/domain/streaming-zip.js";

async function* entries(chunksPerCsv = 3): AsyncGenerator<StreamingZipEntry> {
  yield { name: "README.txt", chunks: singleBufferChunk("Vivarqo export") };
  yield {
    name: "animals.csv",
    chunks: (async function* () {
      yield Buffer.from("\uFEFFid,name\r\n", "utf8");
      for (let index = 0; index < chunksPerCsv; index += 1) {
        yield Buffer.from(`${index},Animal ${index}\r\n`, "utf8");
      }
    })(),
  };
}

describe("streaming ZIP64 writer", () => {
  it("writes ZIP64 local headers, data descriptors, central directory and end records", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vivarqo-zip64-test-"));
    const archivePath = join(directory, "export.zip");
    try {
      const result = await writeStreamingZip(archivePath, entries(), 1024 * 1024);
      const archive = await readFile(archivePath);
      const eocdOffset = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      const locatorOffset = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]));
      const zip64EndOffset = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06]));
      const centralOffset = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));

      expect(result.entryCount).toBe(2);
      expect(result.sizeBytes).toBe(archive.length);
      expect(archive.readUInt32LE(0)).toBe(0x04034b50);
      expect(archive.readUInt16LE(4)).toBe(45);
      expect(archive.readUInt32LE(18)).toBe(0xffff_ffff);
      expect(archive.readUInt16LE(28)).toBe(20);
      expect(archive.readUInt16LE(30)).toBe(0x0001);
      expect(archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))).toBeGreaterThan(0);
      expect(centralOffset).toBeGreaterThan(0);
      expect(archive.readUInt32LE(centralOffset + 20)).toBe(0xffff_ffff);
      expect(archive.readUInt32LE(centralOffset + 42)).toBe(0xffff_ffff);
      expect(zip64EndOffset).toBeGreaterThan(centralOffset);
      expect(locatorOffset).toBeGreaterThan(zip64EndOffset);
      expect(archive.readBigUInt64LE(zip64EndOffset + 32)).toBe(2n);
      expect(archive.readBigUInt64LE(zip64EndOffset + 40)).toBeGreaterThan(0n);
      expect(eocdOffset).toBeGreaterThan(locatorOffset);
      expect(archive.readUInt16LE(eocdOffset + 10)).toBe(0xffff);
      expect(archive.includes(Buffer.from("README.txt"))).toBe(true);
      expect(archive.includes(Buffer.from("Animal 2"))).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("enforces the configured archive size while streaming", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vivarqo-zip64-limit-"));
    const archivePath = join(directory, "export.zip");
    try {
      await expect(writeStreamingZip(
        archivePath,
        (async function* () {
          yield { name: "large.bin", chunks: (async function* () {
            yield Buffer.alloc(256, 1);
            yield Buffer.alloc(256, 2);
          })() };
        })(),
        128,
      )).rejects.toMatchObject({ code: "EXPORT_TOO_LARGE" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("enforces the configured entry count", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vivarqo-zip64-count-"));
    const archivePath = join(directory, "export.zip");
    try {
      await expect(writeStreamingZip(
        archivePath,
        entries(),
        1024 * 1024,
        1,
      )).rejects.toMatchObject({ code: "EXPORT_TOO_MANY_FILES" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects archive traversal paths", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vivarqo-zip64-path-"));
    const archivePath = join(directory, "export.zip");
    try {
      await expect(writeStreamingZip(
        archivePath,
        (async function* () {
          yield { name: "../secrets.txt", chunks: singleBufferChunk("no") };
        })(),
        1024,
      )).rejects.toMatchObject({ code: "EXPORT_ENTRY_NAME_INVALID" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
