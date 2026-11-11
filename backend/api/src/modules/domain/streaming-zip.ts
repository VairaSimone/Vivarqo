import { open } from "node:fs/promises";
import { AppError } from "../../errors/app-error.js";
import { env } from "../../config/env.js";

export interface StreamingZipEntry {
  name: string;
  chunks: AsyncIterable<Uint8Array>;
}

interface CentralDirectoryEntry {
  filename: Buffer;
  crc: number;
  size: bigint;
  localOffset: bigint;
}

const ZIP_UTF8_FLAG = 0x0800;
const ZIP_DATA_DESCRIPTOR_FLAG = 0x0008;
const ZIP_FLAGS = ZIP_UTF8_FLAG | ZIP_DATA_DESCRIPTOR_FLAG;
const ZIP_METHOD_STORE = 0;
const ZIP64_VERSION = 45;
const DOS_DATE_1980_01_01 = 0x0021;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;

/** ZIP64 supports archives far beyond ZIP32 while all offsets remain JS-safe integers. */
export const MAX_ZIP_ARCHIVE_BYTES = env.EXPORT_MAX_ARCHIVE_BYTES;
export const MAX_ZIP_ENTRIES = env.EXPORT_MAX_ENTRIES;

function validateEntryName(name: string): Buffer {
  const normalized = name.replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes("\0") ||
    parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new AppError(500, "EXPORT_ENTRY_NAME_INVALID", "Export contains an invalid archive entry name");
  }
  const filename = Buffer.from(normalized, "utf8");
  if (filename.length > 0xffff) {
    throw new AppError(413, "EXPORT_ENTRY_NAME_TOO_LONG", "An export filename is too long");
  }
  return filename;
}

function updateCrc32(crc: number, chunk: Uint8Array): number {
  let value = crc;
  for (const byte of chunk) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ ((value & 1) !== 0 ? 0xedb88320 : 0);
    }
  }
  return value >>> 0;
}

function localZip64Extra(): Buffer {
  // ZIP64 extra field: header ID, data size, uncompressed size, compressed size.
  // Sizes are unknown until the streamed entry has completed; bit 3 + data descriptor
  // carries the final values without buffering the entry.
  const extra = Buffer.alloc(20);
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(16, 2);
  extra.writeBigUInt64LE(0n, 4);
  extra.writeBigUInt64LE(0n, 12);
  return extra;
}

function localHeader(filename: Buffer, extra: Buffer): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(ZIP64_VERSION, 4);
  header.writeUInt16LE(ZIP_FLAGS, 6);
  header.writeUInt16LE(ZIP_METHOD_STORE, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(DOS_DATE_1980_01_01, 12);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(0xffff_ffff, 18);
  header.writeUInt32LE(0xffff_ffff, 22);
  header.writeUInt16LE(filename.length, 26);
  header.writeUInt16LE(extra.length, 28);
  return header;
}

function dataDescriptor(crc: number, size: bigint): Buffer {
  const descriptor = Buffer.alloc(24);
  descriptor.writeUInt32LE(DATA_DESCRIPTOR_SIGNATURE, 0);
  descriptor.writeUInt32LE(crc, 4);
  descriptor.writeBigUInt64LE(size, 8);
  descriptor.writeBigUInt64LE(size, 16);
  return descriptor;
}

function centralZip64Extra(entry: CentralDirectoryEntry): Buffer {
  // Central-directory ZIP64 extra stores both sizes and the local-header offset.
  const extra = Buffer.alloc(28);
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(24, 2);
  extra.writeBigUInt64LE(entry.size, 4);
  extra.writeBigUInt64LE(entry.size, 12);
  extra.writeBigUInt64LE(entry.localOffset, 20);
  return extra;
}

function centralHeader(entry: CentralDirectoryEntry, extra: Buffer): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(ZIP64_VERSION, 4);
  header.writeUInt16LE(ZIP64_VERSION, 6);
  header.writeUInt16LE(ZIP_FLAGS, 8);
  header.writeUInt16LE(ZIP_METHOD_STORE, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(DOS_DATE_1980_01_01, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(0xffff_ffff, 20);
  header.writeUInt32LE(0xffff_ffff, 24);
  header.writeUInt16LE(entry.filename.length, 28);
  header.writeUInt16LE(extra.length, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt32LE(0, 36);
  header.writeUInt32LE(0xffff_ffff, 42);
  return header;
}

function zip64EndOfCentralDirectory(entryCount: number, centralSize: bigint, centralOffset: bigint): Buffer {
  const end = Buffer.alloc(56);
  end.writeUInt32LE(0x06064b50, 0);
  end.writeBigUInt64LE(44n, 4);
  end.writeUInt16LE(ZIP64_VERSION, 12);
  end.writeUInt16LE(ZIP64_VERSION, 14);
  end.writeUInt32LE(0, 16);
  end.writeUInt32LE(0, 20);
  end.writeBigUInt64LE(BigInt(entryCount), 24);
  end.writeBigUInt64LE(BigInt(entryCount), 32);
  end.writeBigUInt64LE(centralSize, 40);
  end.writeBigUInt64LE(centralOffset, 48);
  return end;
}

function zip64Locator(zip64EndOffset: bigint): Buffer {
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeUInt32LE(0, 4);
  locator.writeBigUInt64LE(zip64EndOffset, 8);
  locator.writeUInt32LE(1, 16);
  return locator;
}

function classicEndOfCentralDirectory(): Buffer {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(0xffff, 8);
  end.writeUInt16LE(0xffff, 10);
  end.writeUInt32LE(0xffff_ffff, 12);
  end.writeUInt32LE(0xffff_ffff, 16);
  end.writeUInt16LE(0, 20);
  return end;
}

/**
 * Writes a standards-compliant ZIP64 archive incrementally. Entries are stored
 * without compression; every local and central header uses ZIP64 fields so the
 * writer never crosses a ZIP32 boundary silently. Limits are explicit and
 * configurable through EXPORT_MAX_ARCHIVE_BYTES and EXPORT_MAX_ENTRIES.
 */
export async function writeStreamingZip(
  outputPath: string,
  entries: AsyncIterable<StreamingZipEntry>,
  maxBytes = MAX_ZIP_ARCHIVE_BYTES,
  maxEntries = MAX_ZIP_ENTRIES,
): Promise<{ sizeBytes: number; entryCount: number }> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 98) {
    throw new Error("maxBytes must be a positive JS-safe integer large enough for a ZIP64 end record");
  }
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 1_000_000) {
    throw new Error("maxEntries must be between 1 and 1,000,000");
  }

  const file = await open(outputPath, "wx", 0o600);
  const centralEntries: CentralDirectoryEntry[] = [];
  let totalBytes = 0n;
  const maximum = BigInt(maxBytes);

  const write = async (chunk: Uint8Array): Promise<void> => {
    if (chunk.byteLength === 0) return;
    if (totalBytes + BigInt(chunk.byteLength) > maximum) {
      throw new AppError(413, "EXPORT_TOO_LARGE", "The archive exceeds the configured ZIP64 size limit");
    }
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let offset = 0;
    while (offset < buffer.length) {
      const result = await file.write(buffer, offset, buffer.length - offset, null);
      if (result.bytesWritten <= 0) throw new Error("Could not write ZIP archive to disk");
      offset += result.bytesWritten;
      totalBytes += BigInt(result.bytesWritten);
    }
  };

  try {
    for await (const entry of entries) {
      if (centralEntries.length >= maxEntries) {
        throw new AppError(413, "EXPORT_TOO_MANY_FILES", "The export exceeds the configured ZIP64 entry limit");
      }
      const filename = validateEntryName(entry.name);
      const localOffset = totalBytes;
      const extra = localZip64Extra();
      await write(localHeader(filename, extra));
      await write(filename);
      await write(extra);

      let crc = 0xffff_ffff;
      let size = 0n;
      for await (const chunk of entry.chunks) {
        size += BigInt(chunk.byteLength);
        crc = updateCrc32(crc, chunk);
        await write(chunk);
      }
      crc = (crc ^ 0xffff_ffff) >>> 0;
      await write(dataDescriptor(crc, size));
      centralEntries.push({ filename, crc, size, localOffset });
    }

    const centralOffset = totalBytes;
    for (const entry of centralEntries) {
      const extra = centralZip64Extra(entry);
      await write(centralHeader(entry, extra));
      await write(entry.filename);
      await write(extra);
    }
    const centralSize = totalBytes - centralOffset;
    const zip64EndOffset = totalBytes;
    await write(zip64EndOfCentralDirectory(centralEntries.length, centralSize, centralOffset));
    await write(zip64Locator(zip64EndOffset));
    await write(classicEndOfCentralDirectory());
    await file.sync();
    return { sizeBytes: Number(totalBytes), entryCount: centralEntries.length };
  } finally {
    await file.close();
  }
}

export async function* singleBufferChunk(value: string | Uint8Array): AsyncGenerator<Buffer> {
  yield Buffer.isBuffer(value) ? value : Buffer.from(value);
}
