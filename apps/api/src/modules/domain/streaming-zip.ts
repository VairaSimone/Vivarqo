import { open } from "node:fs/promises";
import { AppError } from "../../errors/app-error.js";

export interface StreamingZipEntry {
  name: string;
  chunks: AsyncIterable<Uint8Array>;
}

interface CentralDirectoryEntry {
  filename: Buffer;
  crc: number;
  size: number;
  localOffset: number;
}

const ZIP_UTF8_FLAG = 0x0800;
const ZIP_DATA_DESCRIPTOR_FLAG = 0x0008;
const ZIP_FLAGS = ZIP_UTF8_FLAG | ZIP_DATA_DESCRIPTOR_FLAG;
const ZIP_METHOD_STORE = 0;
const ZIP_VERSION = 20;
const DOS_DATE_1980_01_01 = 0x0021;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const MAX_ZIP_ENTRIES = 10_000;

function validateEntryName(name: string): Buffer {
  const normalized = name.replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes("\\0") ||
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

function localHeader(filename: Buffer): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(ZIP_VERSION, 4);
  header.writeUInt16LE(ZIP_FLAGS, 6);
  header.writeUInt16LE(ZIP_METHOD_STORE, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(DOS_DATE_1980_01_01, 12);
  // CRC and sizes are written in a data descriptor after streaming the entry.
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(0, 18);
  header.writeUInt32LE(0, 22);
  header.writeUInt16LE(filename.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function dataDescriptor(crc: number, size: number): Buffer {
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(DATA_DESCRIPTOR_SIGNATURE, 0);
  descriptor.writeUInt32LE(crc, 4);
  descriptor.writeUInt32LE(size, 8);
  descriptor.writeUInt32LE(size, 12);
  return descriptor;
}

function centralHeader(entry: CentralDirectoryEntry): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(ZIP_VERSION, 4);
  header.writeUInt16LE(ZIP_VERSION, 6);
  header.writeUInt16LE(ZIP_FLAGS, 8);
  header.writeUInt16LE(ZIP_METHOD_STORE, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(DOS_DATE_1980_01_01, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.size, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(entry.filename.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(entry.localOffset, 42);
  return header;
}

function endOfCentralDirectory(entryCount: number, centralSize: number, centralOffset: number): Buffer {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entryCount, 8);
  end.writeUInt16LE(entryCount, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  return end;
}

/**
 * Creates a ZIP archive by writing each chunk directly to disk. Entries use
 * ZIP's data-descriptor format so their CRC and size can be calculated as they
 * stream; archive bytes and central-directory metadata are bounded explicitly.
 */
export async function writeStreamingZip(
  outputPath: string,
  entries: AsyncIterable<StreamingZipEntry>,
  maxBytes: number,
): Promise<{ sizeBytes: number; entryCount: number }> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 22) {
    throw new Error("maxBytes must be a positive safe integer large enough for a ZIP end record");
  }

  const file = await open(outputPath, "wx", 0o600);
  const centralEntries: CentralDirectoryEntry[] = [];
  let totalBytes = 0;

  const write = async (chunk: Uint8Array): Promise<void> => {
    if (chunk.byteLength === 0) return;
    if (totalBytes + chunk.byteLength > maxBytes) {
      throw new AppError(413, "EXPORT_TOO_LARGE", "The export exceeds the 50 MB limit");
    }
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let offset = 0;
    while (offset < buffer.length) {
      const result = await file.write(buffer, offset, buffer.length - offset, null);
      if (result.bytesWritten <= 0) throw new Error("Could not write ZIP archive to disk");
      offset += result.bytesWritten;
      totalBytes += result.bytesWritten;
    }
  };

  try {
    for await (const entry of entries) {
      if (centralEntries.length >= MAX_ZIP_ENTRIES) {
        throw new AppError(413, "EXPORT_TOO_MANY_FILES", "An export cannot contain more than 10,000 files");
      }
      const filename = validateEntryName(entry.name);
      const localOffset = totalBytes;
      await write(localHeader(filename));
      await write(filename);

      let crc = 0xffffffff;
      let size = 0;
      for await (const chunk of entry.chunks) {
        size += chunk.byteLength;
        if (size > 0xffffffff) {
          throw new AppError(413, "EXPORT_TOO_LARGE", "An export entry exceeds the ZIP format size limit");
        }
        crc = updateCrc32(crc, chunk);
        await write(chunk);
      }
      crc = (crc ^ 0xffffffff) >>> 0;
      await write(dataDescriptor(crc, size));
      centralEntries.push({ filename, crc, size, localOffset });
    }

    const centralOffset = totalBytes;
    for (const entry of centralEntries) {
      await write(centralHeader(entry));
      await write(entry.filename);
    }
    const centralSize = totalBytes - centralOffset;
    await write(endOfCentralDirectory(centralEntries.length, centralSize, centralOffset));
    await file.sync();
    return { sizeBytes: totalBytes, entryCount: centralEntries.length };
  } finally {
    await file.close();
  }
}

export async function* singleBufferChunk(value: string | Uint8Array): AsyncGenerator<Buffer> {
  yield Buffer.isBuffer(value) ? value : Buffer.from(value);
}
