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

describe("streaming ZIP writer", () => {
  it("writes a ZIP incrementally with a central directory and all entries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vivarqo-zip-test-"));
    const archivePath = join(directory, "export.zip");
    try {
      const result = await writeStreamingZip(archivePath, entries(), 1024 * 1024);
      const archive = await readFile(archivePath);
      const eocdOffset = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));

      expect(result.entryCount).toBe(2);
      expect(result.sizeBytes).toBe(archive.length);
      expect(archive.readUInt32LE(0)).toBe(0x04034b50);
      expect(archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))).toBeGreaterThan(0);
      expect(eocdOffset).toBeGreaterThan(0);
      expect(archive.readUInt16LE(eocdOffset + 10)).toBe(2);
      expect(archive.includes(Buffer.from("README.txt"))).toBe(true);
      expect(archive.includes(Buffer.from("Animal 2"))).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("defaults to the classic ZIP capacity rather than a product-specific 50 MiB cap", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vivarqo-zip-default-limit-"));
    const archivePath = join(directory, "export.zip");
    try {
      const result = await writeStreamingZip(archivePath, entries());
      expect(result.entryCount).toBe(2);
      expect(result.sizeBytes).toBeGreaterThan(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("enforces the final archive size limit while writing instead of after buffering", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vivarqo-zip-limit-"));
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

  it("rejects archive traversal paths", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vivarqo-zip-path-"));
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
