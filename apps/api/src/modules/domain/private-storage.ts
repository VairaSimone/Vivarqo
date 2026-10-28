import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { AppError } from "../../errors/app-error.js";

const root = resolve(process.cwd(), env.PRIVATE_STORAGE_PATH);
const MAX_FILE_BYTES = 10 * 1024 * 1024;
type PrivateFolder = "documents" | "exports";
type PrivateExtension = "pdf" | "jpg" | "png" | "webp" | "zip";
type S3Config = { endpoint: string | undefined; region: string; bucket: string; accessKeyId: string; secretAccessKey: string };

function s3Config(): S3Config | null {
  const supplied = [env.S3_ENDPOINT, env.S3_BUCKET, env.S3_ACCESS_KEY_ID, env.S3_SECRET_ACCESS_KEY].filter((value) => Boolean(value));
  if (supplied.length === 0) {
    if (env.NODE_ENV === "production") {
      throw new AppError(503, "PRIVATE_STORAGE_NOT_CONFIGURED", "Private object storage must be configured before storing files in production");
    }
    return null;
  }
  if (!env.S3_REGION || !env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    throw new AppError(503, "PRIVATE_STORAGE_CONFIGURATION_INCOMPLETE", "Private object storage configuration is incomplete");
  }
  return {
    endpoint: env.S3_ENDPOINT || undefined,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  };
}

function absolutePath(key: string): string {
  if (!/^[a-z0-9-]+\/[a-z0-9-]+\.(pdf|jpg|png|webp|zip)$/.test(key)) {
    throw new AppError(500, "STORAGE_KEY_INVALID", "Stored object reference is invalid");
  }
  const result = resolve(root, key);
  if (!result.startsWith(root + sep)) throw new AppError(500, "STORAGE_KEY_INVALID", "Stored object reference is invalid");
  return result;
}
function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}
function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}
function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
function keyUrl(config: S3Config, key: string): URL {
  const encodedKey = key.split("/").map(awsEncode).join("/");
  if (config.endpoint) {
    const base = new URL(config.endpoint);
    const prefix = base.pathname.replace(/\/$/, "");
    base.pathname = `${prefix}/${awsEncode(config.bucket)}/${encodedKey}`;
    base.search = "";
    base.hash = "";
    return base;
  }
  const url = new URL(`https://s3.${config.region}.amazonaws.com`);
  url.pathname = `/${awsEncode(config.bucket)}/${encodedKey}`;
  return url;
}
function signedHeaders(config: S3Config, method: "PUT" | "GET" | "DELETE", key: string, payload: Buffer): { url: URL; headers: Record<string, string> } {
  const url = keyUrl(config, key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(payload);
  const canonicalHeaders = `host:${url.host.toLowerCase()}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signed = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [method, url.pathname, "", canonicalHeaders, signed, payloadHash].join("\n");
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(Buffer.from(canonicalRequest))].join("\n");
  const dateKey = hmac(`AWS4${config.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, config.region);
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  return {
    url,
    headers: {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
    },
  };
}
const S3_REQUEST_TIMEOUT_MS = 60_000;
const MAX_STORED_READ_BYTES = 50 * 1024 * 1024;

async function s3Request(config: S3Config, method: "PUT" | "GET" | "DELETE", key: string, body: Uint8Array = Buffer.alloc(0)): Promise<Buffer> {
  const signed = signedHeaders(config, method, key, Buffer.from(body));
  let response: Response;
  try {
    response = await fetch(signed.url, {
      method,
      headers: signed.headers,
      ...(method === "PUT" ? { body: new Uint8Array(body) } : {}),
      signal: AbortSignal.timeout(S3_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AppError(503, "PRIVATE_STORAGE_UNAVAILABLE", "Private object storage is unavailable");
  }
  if (response.status === 404 && method === "GET") {
    await response.body?.cancel().catch(() => undefined);
    throw new AppError(404, "FILE_NOT_FOUND", "Stored file is no longer available");
  }
  if (response.status === 404 && method === "DELETE") {
    await response.body?.cancel().catch(() => undefined);
    return Buffer.alloc(0);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new AppError(503, "PRIVATE_STORAGE_UNAVAILABLE", "Private object storage could not complete the request", { providerStatus: response.status });
  }
  if (method !== "GET") {
    await response.body?.cancel().catch(() => undefined);
    return Buffer.alloc(0);
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_STORED_READ_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new AppError(413, "FILE_TOO_LARGE", "Stored file exceeded the permitted download size");
  }
  if (!response.body) return Buffer.alloc(0);

  // Stream into bounded chunks. arrayBuffer() would allocate an arbitrarily
  // large response before checking its size, defeating the read limit.
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_STORED_READ_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new AppError(413, "FILE_TOO_LARGE", "Stored file exceeded the permitted download size");
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof AppError) throw error;
    throw new AppError(503, "PRIVATE_STORAGE_UNAVAILABLE", "Private object storage could not complete the download");
  }
  return Buffer.concat(chunks, totalBytes);
}

export function validatePrivateFile(buffer: Buffer, declaredMime: string): { mimeType: string; extension: string } {
  if (buffer.length === 0) throw new AppError(400, "EMPTY_FILE", "The file is empty");
  if (buffer.length > MAX_FILE_BYTES) throw new AppError(413, "FILE_TOO_LARGE", "The file exceeds the 10 MB limit");
  let mimeType: string | null = null;
  let extension: string | null = null;
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") { mimeType = "application/pdf"; extension = "pdf"; }
  else if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) { mimeType = "image/jpeg"; extension = "jpg"; }
  else if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) { mimeType = "image/png"; extension = "png"; }
  else if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") { mimeType = "image/webp"; extension = "webp"; }
  if (!mimeType || !extension) throw new AppError(400, "FILE_TYPE_NOT_ALLOWED", "Only PDF, JPEG, PNG and WebP files are accepted");
  if (declaredMime && declaredMime.toLowerCase() !== mimeType && declaredMime.toLowerCase() !== "application/octet-stream") {
    throw new AppError(400, "MIME_MISMATCH", "Declared content type does not match the file content");
  }
  return { mimeType, extension };
}

export async function storePrivateObject(folder: PrivateFolder, extension: PrivateExtension, bytes: Buffer): Promise<string> {
  const maximum = folder === "exports" ? 50 * 1024 * 1024 : MAX_FILE_BYTES;
  if (bytes.length === 0 || bytes.length > maximum) {
    throw new AppError(413, "FILE_TOO_LARGE", "File exceeds the storage limit");
  }
  const key = `${folder}/${randomUUID()}.${extension}`;
  const config = s3Config();
  if (config) {
    await s3Request(config, "PUT", key, bytes);
    return key;
  }
  const path = absolutePath(key);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  return key;
}

export async function readPrivateObject(key: string): Promise<Buffer> {
  const config = s3Config();
  if (config) return s3Request(config, "GET", key);
  try {
    return await readFile(absolutePath(key));
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT") {
      throw new AppError(404, "FILE_NOT_FOUND", "Stored file is no longer available");
    }
    throw error;
  }
}

export async function deletePrivateObject(key: string): Promise<void> {
  const config = s3Config();
  if (config) {
    await s3Request(config, "DELETE", key);
    return;
  }
  await rm(absolutePath(key), { force: true });
}
