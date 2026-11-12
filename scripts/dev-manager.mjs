#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { summarizeDiagnostics } from "./dev-manager-core.mjs";
import { access, appendFile, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const ROOT = process.cwd();
const COMPOSE = path.join("backend", "infra", "docker", "compose.yaml");
const LOG_DIR = path.join(ROOT, ".dev-manager", "logs");
const LOG_FILE = path.join(LOG_DIR, "manager.log");
const API_URL = process.env.VIVARQO_API_URL || "http://127.0.0.1:3000/healthz";
const WEB_URL = process.env.VIVARQO_WEB_URL || "http://127.0.0.1:5173";
const DASHBOARD_PORT = Number(process.env.VIVARQO_MANAGER_PORT || 4179);
const DASHBOARD_FILE = path.join(ROOT, "packages", "dev-manager", "dashboard.html");
const recentLogs = [];
const diagnosticEvents = [];
const eventClients = new Set();
const notificationTimes = new Map();
let dashboardServer;
const STOP = { requested: false };
const services = new Map();
const windows = process.platform === "win32";
let packageManager = "pnpm";

const stamp = () => new Date().toISOString();
async function loadPersistentLogs() {
  try {
    const content = await readFile(LOG_FILE, "utf8");
    for (const line of content.split(/\\r?\\n/).filter(Boolean).slice(-1000)) {
      const match = line.match(/^(\\S+) \\[([A-Z]+)\\] \\[([^\\]]+)\\] (.*)$/);
      if (match) recentLogs.push({ timestamp: match[1], level: match[2], service: match[3], message: match[4] });
    }
  } catch (error) { if (error.code !== "ENOENT") throw error; }
}
async function log(level, source, message) {
  const item = { timestamp: stamp(), level, service: source, message: String(message).slice(0, 4000) };
  recentLogs.push(item); if (recentLogs.length > 1000) recentLogs.shift();
  if (["ERROR", "FATAL", "WARN"].includes(level)) { diagnosticEvents.push(item); if (diagnosticEvents.length > 500) diagnosticEvents.shift(); }
  const line = item.timestamp + " [" + level + "] [" + source + "] " + item.message;
  console.log(line); await appendFile(LOG_FILE, line + "\n", "utf8").catch(() => {});
  broadcast({ type: "log", item });
  if (["ERROR", "FATAL"].includes(level)) notifyDesktop(source, item.message);
}
function exe(name) { return name; }
function run(command, args, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, env: process.env, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit", windowsHide: true, shell: windows && (command === "pnpm" || command === "corepack") });
    let stdout = "", stderr = "";
    if (capture) {
      child.stdout.on("data", c => { stdout += c.toString(); });
      child.stderr.on("data", c => { stderr += c.toString(); });
    }
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve({ stdout: stdout.trim(), stderr: stderr.trim() }) : reject(new Error(command + " " + args.join(" ") + " exit " + code + (stderr ? ": " + stderr.trim() : ""))));
  });
}
async function exists(command, args) {
  try { await run(exe(command), args || ["--version"], true); return true; } catch { return false; }
}
function pnpmArgs(args) { return packageManager === "corepack" ? ["pnpm", ...args] : args; }

async function prepare() {
  const v = process.versions.node.split(".").map(Number);
  if (v[0] !== 24 || v[1] < 11) throw new Error("Richiesto Node.js >=24.11 e <25; rilevato " + process.versions.node);
  if (!(await exists("pnpm"))) {
    if (await exists("corepack", ["pnpm", "--version"])) packageManager = "corepack";
    else throw new Error("pnpm non disponibile. Installa Node.js 24.11+ e abilita Corepack.");
  }
  const version = await run(exe(packageManager), packageManager === "corepack" ? ["pnpm", "--version"] : ["--version"], true);
  await log("INFO", "SETUP", "Node " + process.versions.node + "; pnpm " + version.stdout);
  if (!(await exists("docker"))) throw new Error("Docker non installato o non presente nel PATH.");
  await run(exe("docker"), ["compose", "version"], true);

  try { await access(".env", constants.F_OK); }
  catch {
    await copyFile(".env.example", ".env");
    const p = path.join(ROOT, ".env");
    const contents = await readFile(p, "utf8");
    await writeFile(p, contents.replace("replace-with-another-32-bytes-of-random-secret", randomBytes(48).toString("base64url")), "utf8");
    await log("WARN", "SETUP", "Creato .env con CSRF_SECRET casuale. Configura i provider se ti servono.");
  }

  await log("INFO", "DEPENDENCIES", "Verifica dipendenze con pnpm install --frozen-lockfile...");
  await run(exe(packageManager), pnpmArgs(["install", "--frozen-lockfile"]));
  await log("INFO", "DEPENDENCIES", "Dipendenze verificate.");
}

async function prepareDatabase() {
  await log("INFO", "DATABASE", "Avvio PostgreSQL locale...");
  await run(exe("docker"), ["compose", "-f", COMPOSE, "up", "-d", "postgres"]);
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      await run(exe("docker"), ["compose", "-f", COMPOSE, "exec", "-T", "postgres", "pg_isready", "-U", "vivarqo", "-d", "vivarqo"], true);
      ready = true; break;
    } catch { await delay(1500); }
  }
  if (!ready) throw new Error("PostgreSQL non pronto dopo 60 secondi.");
  await log("INFO", "DATABASE", "PostgreSQL pronto; genero Prisma e verifico lo schema.");
  await run(exe(packageManager), pnpmArgs(["db:generate"]));
  await run(exe(packageManager), pnpmArgs(["db:ensure"]));
}

function appendServiceLog(name, chunk) {
  const lines = chunk.toString().split(/\r?\n/).filter(Boolean);
  for (const value of lines) {
    const level = /error|exception|fatal|uncaught/i.test(value) ? "ERROR" : /warn/i.test(value) ? "WARN" : "INFO";
    const item = { timestamp: stamp(), level, service: name, message: value.slice(0, 4000) };
    recentLogs.push(item); if (recentLogs.length > 1000) recentLogs.shift();
    if (["ERROR", "WARN"].includes(level)) { diagnosticEvents.push(item); if (diagnosticEvents.length > 500) diagnosticEvents.shift(); }
    if (level === "ERROR") notifyDesktop(name, value);
    const line = item.timestamp + " [" + name + "] " + value;
    console.log(line); void appendFile(path.join(LOG_DIR, name + ".log"), line + "\n", "utf8");
    void appendFile(LOG_FILE, line + "\n", "utf8"); broadcast({ type: "log", item });
  }
}
function signalTree(child, force = false) {
  if (!child || !child.pid) return;
  if (windows) {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", ...(force ? ["/F"] : [])], { stdio: "ignore", windowsHide: true });
    killer.on("error", () => {});
  } else {
    try { process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM"); }
    catch { try { child.kill(force ? "SIGKILL" : "SIGTERM"); } catch {} }
  }
}
async function terminateTree(child, timeoutMs = 5000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  signalTree(child, false);
  await Promise.race([new Promise(resolve => child.once("close", resolve)), delay(timeoutMs)]);
  if (child.exitCode === null && child.signalCode === null) {
    signalTree(child, true);
    await Promise.race([new Promise(resolve => child.once("close", resolve)), delay(2000)]);
  }
}
const commands = { api: ["dev:api"], worker: ["dev:worker"], frontend: ["dev:frontend"] };

function start(name) {
  const old = services.get(name);
  if (old && old.child && old.state === "running") return old;
  const service = old || { name: name, restarts: 0, failures: 0, state: "stopped", child: null };
  service.state = "starting";
  const child = spawn(exe(packageManager), pnpmArgs(commands[name]), {
    cwd: ROOT, env: { ...process.env, FORCE_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true, shell: windows, detached: !windows
  });
  service.child = child; service.state = "running"; service.startedAt = Date.now(); services.set(name, service);
  child.stdout.on("data", c => appendServiceLog(name, c));
  child.stderr.on("data", c => appendServiceLog(name, c));
  child.once("error", e => { service.state = "crashed"; void log("ERROR", name, "Errore processo: " + e.message); });
  child.once("close", (code, signal) => {
    if (service.child !== child) return;
    service.child = null;
    if (STOP.requested) { service.state = "stopped"; return; }
    if (service.state === "restarting") return;
    service.state = "crashed"; service.failures++;
    service.lastExit = "code=" + code + ", signal=" + signal;
    void log("ERROR", name, "Processo terminato: " + service.lastExit);
    scheduleRestart(name);
  });
  void log("INFO", name, "Avviato (PID " + (child.pid || "n/d") + ").");
  return service;
}
function scheduleRestart(name) {
  const service = services.get(name);
  if (!service || STOP.requested) return;
  if (service.restarts >= 8) {
    service.state = "failed";
    void log("FATAL", name, "Otto riavvii falliti: serve intervento manuale.");
    return;
  }
  const wait = Math.min(30_000, 1000 * Math.pow(2, service.restarts));
  service.restarts++; service.state = "restarting";
  void log("WARN", name, "Riavvio " + service.restarts + "/8 tra " + Math.ceil(wait / 1000) + "s.");
  setTimeout(() => { if (!STOP.requested && service.state === "restarting") start(name); }, wait).unref();
}
function broadcast(payload) {
  const data = "data: " + JSON.stringify(payload) + "\n\n";
  for (const client of eventClients) { try { client.write(data); } catch { eventClients.delete(client); } }
}
function serviceSnapshot() {
  const labels = { postgres: "PostgreSQL", api: "Backend API", worker: "Background worker", frontend: "Frontend" };
  return [...services.values()].map(s => ({ name: s.name, label: labels[s.name] || s.name, state: s.state, stateLabel: s.state === "running" ? "Operativo" : s.state === "restarting" ? "Riavvio" : s.state === "failed" ? "Errore" : s.state === "degraded" ? "Degradato" : s.state, pid: s.child?.pid || null, restarts: s.restarts || 0, detail: s.lastCheck || s.lastExit || "" }));
}
function dashboardState() { return { services: serviceSnapshot(), logs: recentLogs.slice(-500), diagnostics: summarizeDiagnostics(diagnosticEvents), environment: "Node.js " + process.versions.node + " / " + process.platform }; }
async function startDashboard() {
  const html = await readFile(DASHBOARD_FILE, "utf8");
  dashboardServer = createServer((req, res) => {
    const remote = req.socket.remoteAddress || "";
    const loopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
    const host = String(req.headers.host || "").toLowerCase();
    if (!loopback || !["127.0.0.1:" + DASHBOARD_PORT, "localhost:" + DASHBOARD_PORT, "[::1]:" + DASHBOARD_PORT].includes(host)) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      res.end("Forbidden");
      return;
    }
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); res.end(html); return; }
    if (req.method === "GET" && url.pathname === "/api/state") { res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(dashboardState())); return; }
    if (req.method === "GET" && url.pathname === "/events") { res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" }); eventClients.add(res); req.on("close", () => eventClients.delete(res)); return; }
    res.writeHead(404); res.end("Not found");
  });
  await new Promise((resolve, reject) => { dashboardServer.once("error", reject); dashboardServer.listen(DASHBOARD_PORT, "127.0.0.1", resolve); });
  await log("INFO", "DASHBOARD", "Dashboard disponibile su http://127.0.0.1:" + DASHBOARD_PORT);
}
function notifyDesktop(title, message) {
  if (!windows || process.env.VIVARQO_DISABLE_TOAST === "1") return;
  const now = Date.now();
  if (now - (notificationTimes.get(title) || 0) < 20_000) return;
  notificationTimes.set(title, now);
  const t = String("Vivarqo - " + title).replace(/\x27/g, "\x27\x27").slice(0, 80);
  const m = String(message).replace(/\x27/g, "\x27\x27").slice(0, 220);
  const ps = "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $n=New-Object System.Windows.Forms.NotifyIcon; $n.Icon=[System.Drawing.SystemIcons]::Warning; $n.Visible=$true; $n.BalloonTipTitle=\x27" + t + "\x27; $n.BalloonTipText=\x27" + m + "\x27; $n.ShowBalloonTip(8000); Start-Sleep -Seconds 9; $n.Dispose()";
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-WindowStyle", "Hidden", "-Command", ps], { windowsHide: true, stdio: "ignore" });
  child.on("error", () => {});
}
async function checkWorkerHeartbeat() {
  const sql = "SELECT EXISTS (SELECT 1 FROM api_rate_limit_buckets WHERE namespace = 'worker-heartbeat' AND reset_at > NOW());";
  const result = await run(exe("docker"), ["compose", "-f", COMPOSE, "exec", "-T", "postgres", "psql", "-U", "vivarqo", "-d", "vivarqo", "-tA", "-c", sql], true);
  return result.stdout.trim().toLowerCase() === "t";
}
async function checkPostgres() { await run(exe("docker"), ["compose", "-f", COMPOSE, "exec", "-T", "postgres", "pg_isready", "-U", "vivarqo", "-d", "vivarqo"], true); }
async function monitorInfrastructure() {
  let pgFailures = 0, workerFailures = 0;
  while (!STOP.requested) {
    let postgresAvailable = false;
    try {
      await checkPostgres(); postgresAvailable = true; pgFailures = 0;
      const db = services.get("postgres");
      if (db) { db.state = "running"; db.lastCheck = "pg_isready OK"; }
    } catch (error) {
      pgFailures++;
      const db = services.get("postgres");
      if (db) { db.state = "degraded"; db.lastCheck = error.message; }
      if (pgFailures === 2 || pgFailures % 6 === 0) {
        await log("ERROR", "postgres", "PostgreSQL non risponde: tento il recupero Docker Compose.");
        try {
          try { await run(exe("docker"), ["compose", "-f", COMPOSE, "restart", "postgres"]); }
          catch { await run(exe("docker"), ["compose", "-f", COMPOSE, "up", "-d", "postgres"]); }
          if (db) db.restarts++;
          await log("WARN", "postgres", "Riavvio container richiesto; volume dati preservato.");
        } catch (restartError) {
          await log("FATAL", "postgres", "Recupero fallito: " + restartError.message);
        }
      }
    }
    try {
      if (!postgresAvailable) throw new Error("controllo sospeso: PostgreSQL non disponibile");
      if (!(await checkWorkerHeartbeat())) throw new Error("heartbeat assente o scaduto (TTL 45s)");
      workerFailures = 0;
      const worker = services.get("worker");
      if (worker) { worker.state = "running"; worker.lastCheck = "heartbeat DB valido"; }
    } catch (error) {
      workerFailures++;
      const worker = services.get("worker");
      if (worker) { worker.state = "degraded"; worker.lastCheck = error.message; }
      if (postgresAvailable && workerFailures === 2 && worker && worker.child && worker.state !== "restarting") {
        await log("ERROR", "worker", "Heartbeat non valido: " + error.message + ". Riavvio worker.");
        worker.state = "restarting"; killTree(worker.child); scheduleRestart("worker");
      }
    }
    broadcast({ type: "state", services: serviceSnapshot(), diagnostics: summarizeDiagnostics(diagnosticEvents) });
    await delay(10_000);
  }
}
async function waitHttp(label, url, timeout = 90_000) {
  const startAt = Date.now(); let last = "nessuna risposta";
  while (Date.now() - startAt < timeout && !STOP.requested) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (response.ok) { await log("INFO", label, "Health check OK: " + url + " (HTTP " + response.status + ")."); return; }
      last = "HTTP " + response.status;
    } catch (e) { last = e.message; }
    await delay(1500);
  }
  throw new Error(label + " non risponde su " + url + ". Ultimo errore: " + last);
}
async function monitor() {
  const checks = [{ name: "api", url: API_URL }, { name: "frontend", url: WEB_URL }];
  const misses = new Map(checks.map(x => [x.name, 0]));
  while (!STOP.requested) {
    for (const item of checks) {
      const service = services.get(item.name);
      if (!service || !service.child || service.state !== "running") continue;
      try {
        const response = await fetch(item.url, { signal: AbortSignal.timeout(2500) });
        if (!response.ok) throw new Error("HTTP " + response.status);
        misses.set(item.name, 0);
      } catch (e) {
        const count = (misses.get(item.name) || 0) + 1; misses.set(item.name, count);
        if (count === 3) {
          await log("ERROR", item.name, "Tre health check consecutivi falliti: " + e.message + ". Riavvio.");
          service.state = "restarting"; killTree(service.child); scheduleRestart(item.name);
        }
      }
    }
    broadcast({ type: "state", services: serviceSnapshot(), diagnostics: summarizeDiagnostics(diagnosticEvents) });
    await delay(10_000);
  }
}
function status() {
  console.log("\nSTATO SERVIZI");
  for (const s of services.values()) console.log("  " + s.name.padEnd(10) + s.state.padEnd(12) + "riavvii: " + s.restarts);
  console.log("\nFrontend: " + WEB_URL + "\nAPI:      " + API_URL + "\nLog:      " + LOG_DIR + "\nCtrl+C per arrestare i processi applicativi.\n");
}
async function shutdown(reason) {
  if (STOP.requested) return;
  STOP.requested = true;
  await log("WARN", "MANAGER", "Arresto richiesto: " + reason);
  const children = [...services.values()].filter(s => s.child).map(s => { s.state = "stopping"; return s.child; });
  await Promise.all(children.map(child => terminateTree(child)));
  for (const s of services.values()) { s.child = null; s.state = "stopped"; }
  for (const client of eventClients) { try { client.end(); } catch {} }
  eventClients.clear();
  if (dashboardServer) await new Promise(resolve => dashboardServer.close(resolve));
  await log("INFO", "MANAGER", "Processi applicativi arrestati. PostgreSQL resta attivo e i dati non vengono rimossi.");
}
async function main() {
  await mkdir(LOG_DIR, { recursive: true });
  await loadPersistentLogs();
  await startDashboard();
  await log("INFO", "MANAGER", "Avvio Vivarqo Dev Manager.");
  await prepare();
  await prepareDatabase();
  start("api");
  await waitHttp("API", API_URL);
  start("worker");
  start("frontend");
  await waitHttp("FRONTEND", WEB_URL);
  services.set("postgres", { name: "postgres", state: "running", restarts: 0, child: null, lastCheck: "pg_isready OK" });
  status();
  await log("INFO", "MANAGER", "Ambiente pronto. Dashboard: http://127.0.0.1:" + DASHBOARD_PORT);
  await Promise.all([monitor(), monitorInfrastructure()]);
}
process.on("SIGINT", () => { void shutdown("SIGINT"); });
process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
process.on("uncaughtException", async e => { await log("FATAL", "MANAGER", e.stack || e.message); await shutdown("uncaughtException"); process.exitCode = 1; });
process.on("unhandledRejection", reason => { void log("ERROR", "MANAGER", "Promise non gestita: " + String(reason)); });
main().catch(async e => { await log("FATAL", "MANAGER", e.stack || e.message); await shutdown("startup failure"); process.exitCode = 1; });
