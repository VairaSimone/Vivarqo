#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

const archive = process.argv[2];
if (!archive || process.argv.includes("--help")) {
  process.stdout.write("Usage: node backend/scripts/verify-account-backup.mjs <backup.zip>\n");
  process.exit(archive ? 0 : 2);
}

function readZipEntry(entryName, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const child = spawn("unzip", ["-p", archive, entryName], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let size = 0;
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        child.kill("SIGKILL");
        reject(new Error(`Entry ${entryName} exceeds verification size limit`));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`Unable to read ${entryName} from ZIP: ${stderr.trim()}`));
      else resolve(Buffer.concat(chunks));
    });
  });
}

async function hashZipEntry(entryName) {
  return new Promise((resolve, reject) => {
    const child = spawn("unzip", ["-p", archive, entryName], { stdio: ["ignore", "pipe", "pipe"] });
    const hash = createHash("sha256");
    let stderr = "";
    child.stdout.on("data", (chunk) => hash.update(chunk));
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`Unable to hash ${entryName}: ${stderr.trim()}`));
      else resolve(hash.digest("hex"));
    });
  });
}

try {
  const manifestBytes = await readZipEntry("manifest.json");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.format !== "vivarqo-account-backup" || manifest.formatVersion !== 2) {
    throw new Error("Unsupported or invalid Vivarqo backup format");
  }
  if (typeof manifest.accountId !== "string" || !Array.isArray(manifest.modules) ||
      !manifest.checksums || typeof manifest.checksums !== "object" || Array.isArray(manifest.checksums)) {
    throw new Error("Backup manifest is incomplete");
  }
  const entries = Object.entries(manifest.checksums);
  if (entries.length === 0) throw new Error("Backup manifest contains no checksums");
  for (const [entryName, expected] of entries) {
    if (typeof expected !== "string" || !/^[a-f0-9]{64}$/i.test(expected) ||
        entryName.startsWith("/") || entryName.includes("\\\\") || entryName.split("/").includes("..")) {
      throw new Error("Backup manifest contains an unsafe entry or checksum");
    }
    const actual = await hashZipEntry(entryName);
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(`Checksum mismatch: ${entryName}`);
    }
  }
  process.stdout.write(`Backup verified: ${entries.length} files, account ${manifest.accountId}, modules ${manifest.modules.join(", ")}\n`);
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
  process.exitCode = 1;
}
