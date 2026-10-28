import { inflateRawSync } from "node:zlib";
import { AppError } from "../../errors/app-error.js";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_ROWS = 5_000;
const MAX_COLUMNS = 256;

export interface ParsedAnimalFile {
  fileType: "csv" | "xlsx";
  headers: string[];
  rows: Array<{ rowNumber: number; values: Record<string, string> }>;
  sheets: string[];
  selectedSheet: string | null;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function cellColumn(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "A";
  let column = 0;
  for (const letter of letters) column = column * 26 + letter.charCodeAt(0) - 64;
  return column - 1;
}

function findZipEntries(buffer: Buffer): Map<string, Buffer> {
  let eocd = -1;
  const lower = Math.max(0, buffer.length - 65_557);
  for (let i = buffer.length - 22; i >= lower; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new AppError(400, "IMPORT_FILE_INVALID", "Invalid XLSX container");

  const entryCount = buffer.readUInt16LE(eocd + 10);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (entryCount > 2_000) throw new AppError(400, "IMPORT_FILE_INVALID", "XLSX contains too many ZIP entries");

  if (directoryOffset > buffer.length - 22) throw new AppError(400, "IMPORT_FILE_INVALID", "Invalid XLSX directory offset");
  const entries = new Map<string, Buffer>();
  let totalUncompressed = 0;
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset < 0 || offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new AppError(400, "IMPORT_FILE_INVALID", "Invalid XLSX directory entry");
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const entryEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (entryEnd > buffer.length || entryEnd > directoryOffset + buffer.readUInt32LE(eocd + 12)) {
      throw new AppError(400, "IMPORT_FILE_INVALID", "XLSX directory entry exceeds its bounds");
    }
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset = entryEnd;

    if (!name || entries.has(name)) throw new AppError(400, "IMPORT_FILE_INVALID", "XLSX contains an invalid or duplicate ZIP entry");
    if (uncompressedSize === 0xffffffff || compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new AppError(400, "IMPORT_FILE_INVALID", "ZIP64 XLSX files are not supported");
    }
    if ((flags & 1) !== 0) throw new AppError(400, "IMPORT_FILE_INVALID", "Encrypted XLSX files are not supported");
    if (uncompressedSize > 20 * 1024 * 1024) throw new AppError(413, "IMPORT_FILE_TOO_LARGE", "An XLSX entry is too large");
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > 30 * 1024 * 1024) throw new AppError(413, "IMPORT_FILE_TOO_LARGE", "Uncompressed XLSX contents cannot exceed 30 MB");
    if (localOffset > buffer.length - 30 || localOffset + 30 > directoryOffset || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new AppError(400, "IMPORT_FILE_INVALID", "Invalid XLSX local entry");
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset > directoryOffset || compressedSize > directoryOffset - dataOffset) {
      throw new AppError(400, "IMPORT_FILE_INVALID", "XLSX compressed entry exceeds its bounds");
    }
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);

    let value: Buffer;
    if (compression === 0) value = Buffer.from(compressed);
    else if (compression === 8) value = inflateRawSync(compressed, { maxOutputLength: 20 * 1024 * 1024 });
    else throw new AppError(400, "IMPORT_FILE_INVALID", "Unsupported XLSX compression method");

    if (value.length !== uncompressedSize) throw new AppError(400, "IMPORT_FILE_INVALID", "Corrupt XLSX entry");
    entries.set(name, value);
  }
  return entries;
}

function readXlsx(buffer: Buffer, requestedSheet?: string): ParsedAnimalFile {
  let entries: Map<string, Buffer>;
  try {
    entries = findZipEntries(buffer);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "IMPORT_FILE_INVALID", "Unable to read XLSX file");
  }

  const workbook = entries.get("xl/workbook.xml")?.toString("utf8");
  const rels = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8");
  if (!workbook || !rels) throw new AppError(400, "IMPORT_FILE_INVALID", "XLSX workbook metadata is missing");

  const sheetDefs = [...workbook.matchAll(/<sheet\b([^>]*)\/?\s*>/g)].map((match) => {
    const attrs = match[1]!;
    return {
      name: attrs.match(/\bname="([^"]+)"/)?.[1] ? decodeXml(attrs.match(/\bname="([^"]+)"/)![1]!) : "",
      id: attrs.match(/\br:id="([^"]+)"/)?.[1] ?? "",
    };
  });
  if (sheetDefs.length === 0) throw new AppError(400, "IMPORT_FILE_INVALID", "No worksheets found in XLSX file");
  const sheets = sheetDefs.map((sheet) => sheet.name);
  const chosen = requestedSheet ? sheetDefs.find((sheet) => sheet.name === requestedSheet) : sheetDefs[0];
  if (!chosen) throw new AppError(400, "IMPORT_SHEET_NOT_FOUND", "The requested worksheet does not exist", { sheets });

  const targets = new Map([...rels.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)].map((match) => {
    const attrs = match[1]!;
    return [attrs.match(/\bId="([^"]+)"/)?.[1] ?? "", attrs.match(/\bTarget="([^"]+)"/)?.[1] ?? ""];
  }));
  const target = targets.get(chosen.id);
  if (!target) throw new AppError(400, "IMPORT_FILE_INVALID", "Worksheet relationship is missing");
  const sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  const worksheet = entries.get(sheetPath);
  if (!worksheet) throw new AppError(400, "IMPORT_FILE_INVALID", "Selected worksheet is missing");

  const sharedStringsXml = entries.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  const sharedStrings = [...sharedStringsXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    [...match[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => decodeXml(part[1]!)).join(""),
  );

  const grid: Array<{ rowNumber: number; cells: string[] }> = [];
  for (const match of worksheet.toString("utf8").matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(match[1]!.match(/\br="(\d+)"/)?.[1] ?? grid.length + 1);
    const cells: string[] = [];
    for (const cellMatch of match[2]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1]!;
      const reference = attrs.match(/\br="([^"]+)"/)?.[1] ?? "A1";
      const type = attrs.match(/\bt="([^"]+)"/)?.[1] ?? "";
      const column = cellColumn(reference);
      if (column < 0 || column >= MAX_COLUMNS) {
        throw new AppError(413, "IMPORT_TOO_MANY_COLUMNS", `XLSX may contain at most ${MAX_COLUMNS} columns`);
      }
      const body = cellMatch[2] ?? "";
      const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
      let value = raw;
      if (type === "s") {
        const shared = sharedStrings[Number(raw)];
        value = shared ?? "";
      } else if (type === "inlineStr") {
        value = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => decodeXml(part[1]!)).join("");
      } else {
        value = decodeXml(raw);
      }
      cells[column] = value;
    }
    grid.push({ rowNumber, cells });
    if (grid.length > MAX_ROWS + 1) throw new AppError(413, "IMPORT_TOO_MANY_ROWS", `XLSX may contain at most ${MAX_ROWS} data rows`);
  }
  return gridToRows(grid, "xlsx", sheets, chosen.name);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) throw new AppError(400, "IMPORT_FILE_INVALID", "CSV has an unterminated quoted field");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  }
  if (rows.length > MAX_ROWS + 1) throw new AppError(413, "IMPORT_TOO_MANY_ROWS", `CSV may contain at most ${MAX_ROWS} data rows`);
  return rows;
}

function gridToRows(
  grid: Array<{ rowNumber: number; cells: string[] }>,
  fileType: "csv" | "xlsx",
  sheets: string[],
  selectedSheet: string | null,
): ParsedAnimalFile {
  const nonEmpty = grid.filter((row) => row.cells.some((cell) => (cell ?? "").trim() !== ""));
  if (nonEmpty.length < 2) throw new AppError(400, "IMPORT_EMPTY", "The file must contain a header and at least one data row");
  const headerRow = nonEmpty[0]!;
  const headers = headerRow.cells.map((cell) => (cell ?? "").trim());
  if (headers.some((header) => !header)) {
    throw new AppError(400, "IMPORT_HEADER_INVALID", "Header names cannot be empty", { row: headerRow.rowNumber });
  }
  const normalized = headers.map((header) => header.toLocaleLowerCase("it-IT").replace(/[ _-]+/g, "").trim());
  if (new Set(normalized).size !== normalized.length) {
    throw new AppError(400, "IMPORT_HEADER_DUPLICATE", "The file contains duplicate column headers");
  }
  const rows = nonEmpty.slice(1).map((row) => ({
    rowNumber: row.rowNumber,
    values: Object.fromEntries(headers.map((header, index) => [header, (row.cells[index] ?? "").trim()])),
  }));
  return { fileType, headers, rows, sheets, selectedSheet };
}

export function parseAnimalFile(buffer: Buffer, mimeType: string, requestedSheet?: string): ParsedAnimalFile {
  if (buffer.length === 0) throw new AppError(400, "IMPORT_EMPTY", "The uploaded file is empty");
  if (buffer.length > 5 * 1024 * 1024) throw new AppError(413, "PAYLOAD_TOO_LARGE", "Import file cannot exceed 5 MB");

  if (mimeType === XLSX_MIME || buffer.subarray(0, 2).toString("hex") === "504b") {
    return readXlsx(buffer, requestedSheet);
  }
  const text = buffer.toString("utf8");
  if (text.includes("\u0000")) throw new AppError(400, "IMPORT_FILE_INVALID", "Only UTF-8 CSV and XLSX files are supported");
  const csvRows = parseCsv(text);
  return gridToRows(csvRows.map((cells, index) => ({ rowNumber: index + 1, cells })), "csv", [], null);
}
