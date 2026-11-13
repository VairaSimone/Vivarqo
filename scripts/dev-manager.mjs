#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { diagnose, primaryErrorMessage, summarizeDiagnostics } from "./dev-manager-core.mjs";
import {
  clearUnusedVapidPlaceholder, findAvailablePort, getIncompleteVapidVariables,
  getLocalPostgresPort, getPortFromComposeMapping, isTcpPortAvailable,
  readEnvValue, setEnvValues, withLocalPostgresPort
} from "./dev-manager-config.mjs";
import { terminateProcessTree } from "./dev-manager-process.mjs";
import { isDashboardRequestAllowed } from "./dev-manager-security.mjs";
import { access, appendFile, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const ROOT = process.cwd();
const COMPOSE = path.join("backend", "infra", "docker", "compose.yaml");
const PRODUCTION_COMPOSE = process.env.VIVARQO_MANAGER_PRODUCTION_COMPOSE
  ? path.resolve(ROOT, process.env.VIVARQO_MANAGER_PRODUCTION_COMPOSE)
  : path.join("backend", "infra", "docker", "compose.production.yaml");
const LOG_DIR = process.env.VIVARQO_MANAGER_LOG_DIR
  ? path.resolve(ROOT, process.env.VIVARQO_MANAGER_LOG_DIR)
  : path.join(ROOT, ".dev-manager", "logs");
const LOG_FILE = path.join(LOG_DIR, "manager.log");
const API_URL = process.env.VIVARQO_API_URL || "http://127.0.0.1:3000/healthz";
const WEB_URL = process.env.VIVARQO_WEB_URL || "http://127.0.0.1:5173";
const DASHBOARD_PORT = Number(process.env.VIVARQO_MANAGER_PORT || 4179);
const DASHBOARD_FILE = path.join(ROOT, "packages", "dev-manager", "dashboard.html");
const recentLogs = [];
const diagnosticEvents = [];
const eventClients = new Set();
const notificationTimes = new Map();
const notificationProcesses = new Set();
const commandProcesses = new Set();
let dashboardServer;
const STOP = { requested: false };
const services = new Map();
const windows = process.platform === "win32";
let packageManager = "pnpm";

const stamp = () => new Date().toISOString();
async function loadPersistentLogs() {
  try {
    const content = await readFile(LOG_FILE, "utf8");
    for (const line of content.split("\n").map(value => value.trim()).filter(Boolean).slice(-1000)) {
      const first = line.indexOf(" [");
      const second = line.indexOf("] [", first + 2);
      const third = line.indexOf("] ", second + 3);
      if (first > 0 && second > first && third > second) {
        const item = {
          timestamp: line.slice(0, first),
          level: line.slice(first + 2, second),
          service: line.slice(second + 3, third),
          message: line.slice(third + 2)
        };
        recentLogs.push(item);
      }
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

function spawnCommand(command, args, options) {
  if (windows && (command === "pnpm" || command === "corepack")) {
    // .cmd shims require cmd.exe on Windows. Launch it explicitly rather than
    // enabling Node's shell:true mode (DEP0190 and argument concatenation risk).
    return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", command, ...args], {
      ...options, shell: false
    });
  }
  return spawn(command, args, { ...options, shell: false });
}

const MAX_COMMAND_OUTPUT = 1024 * 1024;
function appendBounded(current, chunk) {
  return (current + chunk.toString()).slice(-MAX_COMMAND_OUTPUT);
}

function run(command, args, capture = false) {
  return new Promise((resolve, reject) => {
    if (STOP.requested) { reject(new Error("Manager in arresto: comando non avviato.")); return; }
    const child = spawnCommand(command, args, {
      cwd: ROOT, env: process.env, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      windowsHide: true, detached: !windows
    });
    commandProcesses.add(child);
    let stdout = "", stderr = "";
    if (capture) {
      child.stdout.on("data", chunk => { stdout = appendBounded(stdout, chunk); });
      child.stderr.on("data", chunk => { stderr = appendBounded(stderr, chunk); });
    }
    child.once("error", error => { commandProcesses.delete(child); reject(error); });
    child.once("close", code => {
      commandProcesses.delete(child);
      if (code === 0) resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      else {
        const details = [stdout, stderr].filter(Boolean).join("\n").slice(-MAX_COMMAND_OUTPUT);
        reject(new Error(command + " " + args.join(" ") + " exit " + code + (details ? ":\n" + details : "")));
      }
    });
  });
}

async function runAndForward(command, args) {
  const result = await run(command, args, true);
  if (result.stdout) process.stdout.write(result.stdout + "\n");
  if (result.stderr) process.stderr.write(result.stderr + "\n");
  return result;
}

async function exists(command, args) {
  try { await run(exe(command), args || ["--version"], true); return true; } catch { return false; }
}
function pnpmArgs(args) { return packageManager === "corepack" ? ["pnpm", ...args] : args; }

async function persistEnvFile(filePath, contents) {
  const temporaryPath = filePath + ".dev-manager-" + process.pid + ".tmp";
  await writeFile(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
  try {
    await rename(temporaryPath, filePath);
  } catch (error) {
    await import("node:fs/promises").then(fs => fs.unlink(temporaryPath).catch(() => {}));
    throw error;
  }
}

async function describePortOwner(port) {
  if (!windows) return [];
  const script = "$port = " + Number(port) +
    "; $ids = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique);" +
    " $rows = foreach ($id in $ids) { $p = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $id);" +
    " [pscustomobject]@{ pid = $id; name = $p.Name } }; ConvertTo-Json -InputObject @($rows) -Compress";
  try {
    const result = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], true);
    if (!result.stdout) return [];
    const parsed = JSON.parse(result.stdout);
    return (Array.isArray(parsed) ? parsed : [parsed]).filter(item => item && item.pid);
  } catch {
    return [];
  }
}

async function getExistingComposePostgresPort() {
  try {
    const result = await run("docker", ["compose", "-f", COMPOSE, "port", "postgres", "5432"], true);
    return getPortFromComposeMapping(result.stdout);
  } catch {
    return null;
  }
}

async function configureLocalPostgresPort() {
  const envPath = path.join(ROOT, ".env");
  const original = await readFile(envPath, "utf8");
  const existingComposePort = await getExistingComposePostgresPort();
  const inheritedPort = Number(process.env.VIVARQO_POSTGRES_HOST_PORT || 0);
  const filePort = Number(readEnvValue(original, "VIVARQO_POSTGRES_HOST_PORT") || 0);
  const inheritedUrl = process.env.DATABASE_URL?.trim() || "";
  const fileUrl = readEnvValue(original, "DATABASE_URL") || "";
  const preferredPort = existingComposePort ||
    (Number.isInteger(inheritedPort) && inheritedPort > 0 && inheritedPort <= 65_535 ? inheritedPort : null) ||
    (Number.isInteger(filePort) && filePort > 0 && filePort <= 65_535 ? filePort : null) ||
    getLocalPostgresPort(inheritedUrl || fileUrl) ||
    5432;

  // Reuse the already-running Compose mapping on subsequent starts. Otherwise
  // probe for a free loopback port and never terminate the process occupying it.
  const selectedPort = existingComposePort || await findAvailablePort(preferredPort, 5500, isTcpPortAvailable);
  if (!selectedPort) {
    throw new Error("Nessuna porta TCP libera trovata tra " + preferredPort + " e 5500. Libera una porta o imposta VIVARQO_POSTGRES_HOST_PORT manualmente.");
  }

  const updates = { VIVARQO_POSTGRES_HOST_PORT: String(selectedPort) };
  if (getLocalPostgresPort(fileUrl) !== null) {
    updates.DATABASE_URL = withLocalPostgresPort(fileUrl, selectedPort);
  }
  const updatedContents = setEnvValues(original, updates);
  if (updatedContents !== original) await persistEnvFile(envPath, updatedContents);

  process.env.VIVARQO_POSTGRES_HOST_PORT = String(selectedPort);
  if (inheritedUrl && getLocalPostgresPort(inheritedUrl) !== null) {
    process.env.DATABASE_URL = withLocalPostgresPort(inheritedUrl, selectedPort);
  } else if (!inheritedUrl && updates.DATABASE_URL) {
    process.env.DATABASE_URL = updates.DATABASE_URL;
  }

  if (!existingComposePort && selectedPort !== preferredPort) {
    const owners = await describePortOwner(preferredPort);
    const ownerLabel = owners.length
      ? owners.map(owner => String(owner.name || "processo") + " PID " + owner.pid).join(", ")
      : "processo non identificato";
    await log("INFO", "DATABASE", "Porta host " + preferredPort + " occupata da " + ownerLabel +
      "; non interrompo il processo esistente. PostgreSQL Docker userà la porta " + selectedPort +
      " (porta interna container: 5432).");
  } else if (existingComposePort) {
    await log("INFO", "DATABASE", "Riutilizzo la porta " + selectedPort + " già pubblicata dal container PostgreSQL di Vivarqo.");
  } else {
    await log("INFO", "DATABASE", "Porta host PostgreSQL verificata: " + selectedPort + ".");
  }
  return selectedPort;
}

async function validateLocalEnvironment() {
  await log("INFO", "SETUP", "Verifica preventiva della configurazione .env...");
  await runAndForward(exe(packageManager), pnpmArgs([
    "--filter", "@vivarqo/api", "exec", "tsx", "src/config/validate-env.ts"
  ]));
  await log("INFO", "SETUP", "Configurazione .env valida; i provider non configurati restano disabilitati.");
}

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
  await run("docker", ["compose", "version"], true);

  try { await access(".env", constants.F_OK); }
  catch {
    await copyFile(".env.example", ".env");
    const initial = await readFile(".env", "utf8");
    await writeFile(".env", initial.replace("replace-with-another-32-bytes-of-random-secret", randomBytes(48).toString("base64url")), "utf8");
    await log("INFO", "SETUP", "Creato .env locale con CSRF_SECRET casuale. I provider esterni restano opzionali.");
  }

  let envContents = await readFile(".env", "utf8");
  const nodeEnv = readEnvValue(envContents, "NODE_ENV") || "development";
  const csrfSecret = readEnvValue(envContents, "CSRF_SECRET") || "";
  if (nodeEnv === "development" && (!csrfSecret || /replace-with-another-32-bytes-of-random-secret/i.test(csrfSecret))) {
    envContents = setEnvValues(envContents, { CSRF_SECRET: randomBytes(48).toString("base64url") });
    await log("INFO", "SETUP", "Rigenerato CSRF_SECRET mancante o segnaposto per il solo ambiente development.");
  }
  envContents = clearUnusedVapidPlaceholder(envContents);
  const missingVapid = getIncompleteVapidVariables(envContents);
  if (missingVapid.length) {
    throw new Error("Configurazione VAPID incompleta. Mancano: " + missingVapid.join(", ") +
      ". Configura tutte le tre variabili oppure lascia VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e VAPID_SUBJECT vuote.");
  }
  const currentEnv = await readFile(".env", "utf8");
  if (envContents !== currentEnv) await persistEnvFile(path.join(ROOT, ".env"), envContents);

  await log("INFO", "DEPENDENCIES", "Verifica dipendenze con pnpm install --frozen-lockfile...");
  const install = await runAndForward(exe(packageManager), pnpmArgs(["install", "--frozen-lockfile"]));
  const installOutput = install.stdout + "\n" + install.stderr;
  if (/Ignored build scripts/i.test(installOutput)) {
    const warning = installOutput.match(/Ignored build scripts:[\\s\\S]{0,900}/i)?.[0] || "pnpm ha ignorato uno o più script.";
    await log("WARN", "DEPENDENCIES", warning +
      " Il Manager non autorizza pacchetti non presenti in onlyBuiltDependencies. Verifica la dipendenza e usa pnpm approve-builds solo dopo averne controllato la provenienza.");
  }
  await log("INFO", "DEPENDENCIES", "Dipendenze verificate.");
}

async function prepareDatabase() {
  await log("INFO", "DATABASE", "Avvio PostgreSQL locale sulla porta host " +
    process.env.VIVARQO_POSTGRES_HOST_PORT + "...");
  await runAndForward("docker", ["compose", "-f", COMPOSE, "up", "-d", "postgres"]);
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      await run("docker", ["compose", "-f", COMPOSE, "exec", "-T", "postgres", "pg_isready", "-U", "vivarqo", "-d", "vivarqo"], true);
      ready = true; break;
    } catch { await delay(1500); }
  }
  if (!ready) throw new Error("PostgreSQL non pronto dopo 60 secondi.");
  resolveServiceDiagnostics("postgres", "PostgreSQL risponde a pg_isready.");
  await log("INFO", "DATABASE", "PostgreSQL pronto; genero Prisma e verifico lo schema.");
  await runAndForward(exe(packageManager), pnpmArgs(["db:generate"]));
  await runAndForward(exe(packageManager), pnpmArgs(["db:ensure"]));
  await log("INFO", "DEPENDENCIES", "Compilo una sola volta i Contracts condivisi prima di avviare API e worker.");
  await runAndForward(exe(packageManager), pnpmArgs(["contracts:build"]));
}

function appendServiceLog(name, chunk) {
  const lines = chunk.toString().split(/\r?\n/).filter(Boolean);
  for (const value of lines) {
    const level = /error|exception|fatal|uncaught/i.test(value) ? "ERROR" : /warn/i.test(value) ? "WARN" : "INFO";
    const item = { timestamp: stamp(), level, service: name, message: value.slice(0, 4000) };
    recentLogs.push(item); if (recentLogs.length > 1000) recentLogs.shift();
    if (["ERROR", "WARN"].includes(level)) { diagnosticEvents.push(item); if (diagnosticEvents.length > 500) diagnosticEvents.shift(); }
    if (level === "ERROR") notifyDesktop(name, value);
    const line = item.timestamp + " [" + level + "] [" + name + "] " + value;
    console.log(line); void appendFile(path.join(LOG_DIR, name + ".log"), line + "\n", "utf8");
    void appendFile(LOG_FILE, line + "\n", "utf8"); broadcast({ type: "log", item });
  }
}

const commands = {
  api: ["--filter", "@vivarqo/api", "dev"],
  worker: ["--filter", "@vivarqo/api", "exec", "tsx", "src/worker.ts"],
  frontend: ["--filter", "@vivarqo/frontend", "dev"]
};

function start(name) {
  if (STOP.requested) return null;
  const old = services.get(name);
  if (old && old.child && old.state === "running") return old;
  const service = old || { name: name, restarts: 0, failures: 0, state: "stopped", child: null };
  service.state = "starting";
  const testMode = process.env.VIVARQO_MANAGER_TEST_MODE === "1";
  const testPort = name === "api" ? process.env.VIVARQO_TEST_API_PORT : process.env.VIVARQO_TEST_WEB_PORT;
  const executable = testMode ? process.execPath : exe(packageManager);
  const args = testMode
    ? [path.join(ROOT, "scripts", "dev-manager-fixture.mjs"), name, String(testPort || "0")]
    : pnpmArgs(commands[name]);
  const child = spawnCommand(executable, args, {
    cwd: ROOT, env: { ...process.env, FORCE_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true, detached: !windows
  });
  service.child = child;
  service.state = name === "api" || name === "frontend" ? "starting" : "running";
  service.startedAt = Date.now();
  services.set(name, service);
  child.stdout.on("data", c => appendServiceLog(name, c));
  child.stderr.on("data", c => appendServiceLog(name, c));
  child.once("error", e => { service.state = "crashed"; void log("ERROR", name, "Errore processo: " + e.message); });
  child.once("close", (code, signal) => {
    if (service.child !== child) return;
    service.child = null;
    if (STOP.requested) { service.state = "stopped"; return; }
    if (service.state === "restarting") return;
    service.state = "crashed"; service.failures++;
    registerRestartFailure(service);
    service.lastExit = "code=" + code + ", signal=" + signal;
    void log("ERROR", name, "Processo terminato: " + service.lastExit);
    scheduleRestart(name);
  });
  void log("INFO", name, "Avviato (PID " + (child.pid || "n/d") + ").");
  return service;
}
function registerRestartFailure(service) {
  if (Date.now() - (service.startedAt || Date.now()) >= 60_000) service.consecutiveFailures = 0;
  service.consecutiveFailures = (service.consecutiveFailures || 0) + 1;
}
function scheduleRestart(name) {
  const service = services.get(name);
  if (!service || STOP.requested) return;
  const attempt = service.consecutiveFailures || 1;
  if (attempt > 8) {
    service.state = "failed";
    void log("FATAL", name, "Otto tentativi consecutivi falliti: serve intervento manuale.");
    return;
  }
  const wait = Math.min(30_000, 1000 * Math.pow(2, attempt - 1));
  service.restarts++;
  service.state = "restarting";
  void log("WARN", name, "Tentativo di riavvio " + attempt + "/8 tra " + Math.ceil(wait / 1000) + "s. Riavvii totali: " + service.restarts + ".");
  setTimeout(() => { if (!STOP.requested && service.state === "restarting") start(name); }, wait).unref();
}
function broadcast(payload) {
  const data = "data: " + JSON.stringify(payload) + "\n\n";
  for (const client of eventClients) { try { client.write(data); } catch { eventClients.delete(client); } }
}
function serviceSnapshot() {
  const labels = { postgres: "PostgreSQL", api: "Backend API", worker: "Background worker", frontend: "Frontend", web: "Frontend web", caddy: "Reverse proxy", backup: "Backup DB", migrate: "Migrazioni" };
  return [...services.values()].map(s => ({ name: s.name, label: labels[s.name] || s.name, state: s.state, stateLabel: s.state === "running" ? "Operativo" : s.state === "restarting" ? "Riavvio" : s.state === "failed" ? "Errore" : s.state === "degraded" ? "Degradato" : s.state, pid: s.child?.pid || null, restarts: s.restarts || 0, detail: s.lastCheck || s.lastExit || "" }));
}
function resolveServiceDiagnostics(serviceName, reason) {
  const normalized = String(serviceName || "").toLowerCase();
  let removed = 0;
  for (let index = diagnosticEvents.length - 1; index >= 0; index -= 1) {
    if (String(diagnosticEvents[index].service || "").toLowerCase() === normalized) {
      diagnosticEvents.splice(index, 1);
      removed += 1;
    }
  }
  if (removed) void log("INFO", "DIAGNOSTICS", "Risolte " + removed + " segnalazioni per " + normalized + ": " + reason);
}
function dashboardState() { return { services: serviceSnapshot(), logs: recentLogs.slice(-500), diagnostics: summarizeDiagnostics(diagnosticEvents), environment: "Node.js " + process.versions.node + " / " + process.platform }; }
async function startDashboard() {
  const html = await readFile(DASHBOARD_FILE, "utf8");
  dashboardServer = createServer((req, res) => {
    if (!isDashboardRequestAllowed(req.socket.remoteAddress, req.headers.host, DASHBOARD_PORT)) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      res.end("Forbidden");
      return;
    }
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); res.end(html); return; }
    if (req.method === "GET" && url.pathname === "/api/state") { res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(dashboardState())); return; }
    if (req.method === "GET" && url.pathname === "/events") { res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" }); eventClients.add(res); res.on("close", () => eventClients.delete(res)); return; }
    res.writeHead(404); res.end("Not found");
  });
  await new Promise((resolve, reject) => { dashboardServer.once("error", reject); dashboardServer.listen(DASHBOARD_PORT, "127.0.0.1", resolve); });
  await log("INFO", "DASHBOARD", "Dashboard disponibile su http://127.0.0.1:" + DASHBOARD_PORT);
}
function notifyDesktop(title, message) {
  if (!windows || STOP.requested || process.env.VIVARQO_DISABLE_TOAST === "1") return;
  const now = Date.now();
  if (now - (notificationTimes.get(title) || 0) < 20_000) return;
  notificationTimes.set(title, now);
  const t = String("Vivarqo - " + title).replace(/\x27/g, "\x27\x27").slice(0, 80);
  const m = String(message).replace(/\x27/g, "\x27\x27").slice(0, 220);
  const ps = "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $n=New-Object System.Windows.Forms.NotifyIcon; $n.Icon=[System.Drawing.SystemIcons]::Warning; $n.Visible=$true; $n.BalloonTipTitle=\x27" + t + "\x27; $n.BalloonTipText=\x27" + m + "\x27; $n.ShowBalloonTip(8000); Start-Sleep -Seconds 9; $n.Dispose()";
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-WindowStyle", "Hidden", "-Command", ps], { windowsHide: true, stdio: "ignore" });
  notificationProcesses.add(child);
  child.on("error", () => notificationProcesses.delete(child));
  child.once("close", () => notificationProcesses.delete(child));
}
async function checkWorkerHeartbeat() {
  if (process.env.VIVARQO_MANAGER_TEST_POSTGRES === "1") return true;
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
      resolveServiceDiagnostics("postgres", "pg_isready OK.");
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
      resolveServiceDiagnostics("worker", "heartbeat DB valido.");
    } catch (error) {
      workerFailures++;
      const worker = services.get("worker");
      if (worker) { worker.state = "degraded"; worker.lastCheck = error.message; }
      if (postgresAvailable && workerFailures === 2 && worker && worker.child && worker.state !== "restarting") {
        await log("ERROR", "worker", "Heartbeat non valido: " + error.message + ". Riavvio worker.");
        registerRestartFailure(worker);
        const previousChild = worker.child;
        worker.state = "restarting";
        await terminateProcessTree(previousChild);
        if (worker.child === previousChild) worker.child = null;
        scheduleRestart("worker");
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
      if (response.ok) {
        const service = services.get(label.toLowerCase());
        if (service) { service.state = "running"; service.lastCheck = "HTTP " + response.status + " OK"; }
        resolveServiceDiagnostics(label.toLowerCase(), "health check HTTP " + response.status + " OK.");
        await log("INFO", label, "Health check OK: " + url + " (HTTP " + response.status + ").");
        return;
      }
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
      if (!service || !service.child || !["running", "starting"].includes(service.state)) continue;
      try {
        const response = await fetch(item.url, { signal: AbortSignal.timeout(2500) });
        if (!response.ok) throw new Error("HTTP " + response.status);
        misses.set(item.name, 0);
        resolveServiceDiagnostics(item.name, "health check HTTP " + response.status + " OK.");
        service.state = "running";
        service.lastCheck = "HTTP " + response.status + " OK";
      } catch (e) {
        const count = (misses.get(item.name) || 0) + 1; misses.set(item.name, count);
        if (count === 3) {
          await log("ERROR", item.name, "Tre health check consecutivi falliti: " + e.message + ". Riavvio.");
          registerRestartFailure(service);
          const previousChild = service.child;
          service.state = "restarting";
          await terminateProcessTree(previousChild);
          if (service.child === previousChild) service.child = null;
          scheduleRestart(item.name);
        }
      }
    }
    broadcast({ type: "state", services: serviceSnapshot(), diagnostics: summarizeDiagnostics(diagnosticEvents) });
    await delay(10_000);
  }
}
async function prepareProduction() {
  if (process.platform !== "linux") throw new Error("La modalità production è supportata solo su Linux.");
  const nodeVersion = process.versions.node.split(".").map(Number);
  if (nodeVersion[0] !== 24 || nodeVersion[1] < 11) throw new Error("Richiesto Node.js >=24.11 e <25; rilevato " + process.versions.node);
  const envFile = process.env.VIVARQO_ENV_FILE;
  if (!envFile) throw new Error("Imposta VIVARQO_ENV_FILE con il percorso del file ambiente di produzione.");
  const absoluteEnvFile = path.resolve(ROOT, envFile);
  await access(absoluteEnvFile, constants.F_OK);
  if (!(await exists("docker"))) throw new Error("Docker Engine non disponibile nel PATH.");
  await run("docker", ["compose", "version"], true);
  process.env.VIVARQO_ENV_FILE = absoluteEnvFile;
  const args = ["compose", "--env-file", absoluteEnvFile, "-f", PRODUCTION_COMPOSE, "config", "--quiet"];
  await run("docker", args, true);
  return ["compose", "--env-file", absoluteEnvFile, "-f", PRODUCTION_COMPOSE];
}
async function productionRun(composeArgs, args, capture = false) {
  return run("docker", [...composeArgs, ...args], capture);
}
function parseComposePsOutput(output) {
  const value = String(output || "").trim();
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return value.split("\n").map(line => line.trim()).filter(Boolean).map(line => JSON.parse(line));
  }
}
async function monitorProduction(composeArgs) {
  const names = ["postgres", "api", "worker", "web", "caddy", "backup", "migrate"];
  let workerFailures = 0;
  while (!STOP.requested) {
    try {
      const result = await productionRun(composeArgs, ["ps", "--all", "--format", "json"], true);
      const rows = parseComposePsOutput(result.stdout);
      for (const name of names) {
        const current = services.get(name) || { name, restarts: 0, child: null };
        current.state = "missing";
        current.containerRunning = false;
        current.lastCheck = "Container non trovato";
        services.set(name, current);
      }
      for (const row of rows) {
        const name = row.Service || row.service;
        if (!name) continue;
        const state = String(row.State || row.state || "unknown").toLowerCase();
        const health = String(row.Health || row.health || "").toLowerCase();
        const current = services.get(name) || { name, restarts: 0, child: null };
        current.containerRunning = state === "running";
        current.state = name === "migrate" && state === "exited" && Number(row.ExitCode ?? row.exitCode) === 0
          ? "completed"
          : state === "running" && (!health || health === "healthy") ? "running"
          : state === "running" && health === "starting" ? "starting"
          : "degraded";
        current.lastCheck = health ? "container " + state + " / health " + health : "container " + state;
        services.set(name, current);
      }
      for (const name of names) {
        if (!services.has(name)) services.set(name, { name, state: "missing", restarts: 0, child: null, lastCheck: "Container non trovato" });
      }
      const pg = services.get("postgres");
      if (pg && ["degraded", "missing"].includes(pg.state) && Date.now() - (pg.lastRecoveryAt || 0) >= 60_000) {
        pg.lastRecoveryAt = Date.now();
        await log("ERROR", "postgres", "Container PostgreSQL non operativo; richiedo il ripristino Compose.");
        if (pg.lastCheck.includes("container running")) {
          await productionRun(composeArgs, ["restart", "postgres"]);
        } else {
          await productionRun(composeArgs, ["up", "-d", "--no-deps", "postgres"]);
        }
        pg.restarts++; pg.state = "restarting";
      }
      for (const name of ["api", "web", "caddy", "backup"]) {
        const service = services.get(name);
        if (service && ["degraded", "missing"].includes(service.state) && Date.now() - (service.lastRecoveryAt || 0) >= 60_000) {
          service.lastRecoveryAt = Date.now();
          await log("WARN", name, "Container non sano; richiedo il riavvio Compose.");
          if (service.lastCheck.includes("container running")) {
            await productionRun(composeArgs, ["restart", name]);
          } else {
            await productionRun(composeArgs, ["up", "-d", "--no-deps", name]);
          }
          service.restarts++; service.state = "restarting";
        }
      }
      try {
        const heartbeat = await productionRun(composeArgs, ["exec", "-T", "postgres", "sh", "-lc",
          "psql -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" -tA -c \"SELECT EXISTS (SELECT 1 FROM api_rate_limit_buckets WHERE namespace = 'worker-heartbeat' AND reset_at > NOW());\""], true);
        if (heartbeat.stdout.trim().toLowerCase() === "t") {
          workerFailures = 0;
          const worker = services.get("worker");
          if (worker && worker.state === "running") worker.lastCheck = "container running / heartbeat DB valido";
          else if (worker) worker.lastCheck += " / heartbeat DB ancora valido entro TTL";
        } else throw new Error("heartbeat worker assente/scaduto");
      } catch (error) {
        const worker = services.get("worker");
        const containerWasRunning = worker?.containerRunning === true;
        if (worker) { worker.state = "degraded"; worker.lastCheck = error.message; }
        const migrationsReady = services.get("migrate")?.state === "completed";
        const databaseReady = services.get("postgres")?.state === "running";
        if (!migrationsReady || !databaseReady) {
          workerFailures = 0;
        } else {
          const containerExited = Boolean(worker) && !containerWasRunning;
          workerFailures = containerExited ? 5 : workerFailures + 1;
          if (workerFailures >= 5 && Date.now() - (worker?.lastRecoveryAt || 0) >= 60_000) {
            if (worker) worker.lastRecoveryAt = Date.now();
            await log("ERROR", "worker", "Heartbeat assente con DB e migrazioni pronti; richiedo il riavvio del container.");
            if (worker?.containerRunning) {
              await productionRun(composeArgs, ["restart", "worker"]);
            } else {
              await productionRun(composeArgs, ["up", "-d", "--no-deps", "worker"]);
            }
            if (worker) { worker.restarts++; worker.state = "restarting"; }
            workerFailures = 0;
          }
        }
      }
      for (const name of names.filter(n => n !== "migrate")) {
        try {
          const logs = await productionRun(composeArgs, ["logs", "--no-color", "--since", "12s", name], true);
          if (logs.stdout) appendServiceLog(name, logs.stdout);
          if (logs.stderr) appendServiceLog(name, logs.stderr);
        } catch (error) { await log("WARN", name, "Lettura log container fallita: " + error.message); }
      }
    } catch (error) {
      await log("ERROR", "DOCKER", "Monitoraggio Compose non riuscito: " + error.message);
    }
    broadcast({ type: "state", services: serviceSnapshot(), diagnostics: summarizeDiagnostics(diagnosticEvents) });
    await delay(10_000);
  }
}
async function testModeMain() {
  await mkdir(LOG_DIR, { recursive: true });
  await loadPersistentLogs();
  await startDashboard();
  await log("INFO", "MANAGER", "Avvio harness di resilienza isolato.");
  if (process.env.VIVARQO_MANAGER_TEST_POSTGRES === "1") {
    services.set("postgres", { name: "postgres", state: "running", restarts: 0, child: null, lastCheck: "PostgreSQL drill" });
  }
  start("api");
  await waitHttp("API", API_URL);
  start("worker");
  start("frontend");
  await waitHttp("FRONTEND", WEB_URL);
  status();
  const monitors = [monitor()];
  if (process.env.VIVARQO_MANAGER_TEST_POSTGRES === "1") monitors.push(monitorInfrastructure());
  await Promise.all(monitors);
}
async function productionMain() {
  await mkdir(LOG_DIR, { recursive: true });
  await loadPersistentLogs();
  await startDashboard();
  await log("INFO", "MANAGER", "Avvio Vivarqo Production Manager su Linux.");
  const composeArgs = await prepareProduction();
  await productionRun(composeArgs, ["up", "-d"]);
  await log("INFO", "MANAGER", "Stack di produzione avviato. L'arresto del manager non arresta i container.");
  await monitorProduction(composeArgs);
}
function status() {
  console.log("\nSTATO SERVIZI");
  for (const s of services.values()) console.log("  " + s.name.padEnd(10) + s.state.padEnd(12) + "riavvii: " + s.restarts);
  console.log("\nFrontend: " + WEB_URL + "\nAPI:      " + API_URL + "\nLog:      " + LOG_DIR + "\nCtrl+C per arrestare i processi applicativi.\n");
}
async function shutdown(reason) {
  if (STOP.requested) return;
  STOP.requested = true;
  await log("INFO", "MANAGER", "Arresto richiesto: " + reason + " (arresto volontario).");
  const serviceChildren = [...services.values()].filter(s => s.child).map(s => { s.state = "stopping"; return s.child; });
  const children = [...new Set([...serviceChildren, ...commandProcesses, ...notificationProcesses])];
  await Promise.all(children.map(child => terminateProcessTree(child)));
  commandProcesses.clear();
  notificationProcesses.clear();
  for (const s of services.values()) { s.child = null; s.state = "stopped"; }
  for (const client of eventClients) { try { client.end(); } catch {} }
  eventClients.clear();
  if (dashboardServer) await new Promise(resolve => dashboardServer.close(resolve));
  await log("INFO", "MANAGER", process.env.VIVARQO_MANAGER_MODE === "production"
    ? "Manager arrestato; i container Docker di produzione restano attivi."
    : "Processi applicativi arrestati. PostgreSQL resta attivo e i dati non vengono rimossi.");
}
async function main() {
  if (process.env.VIVARQO_MANAGER_TEST_MODE === "1") return testModeMain();
  if (process.env.VIVARQO_MANAGER_MODE === "production") return productionMain();
  await mkdir(LOG_DIR, { recursive: true });
  await loadPersistentLogs();
  await startDashboard();
  await log("INFO", "MANAGER", "Avvio Vivarqo Dev Manager.");
  await prepare();
  await configureLocalPostgresPort();
  await validateLocalEnvironment();
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
main().catch(async e => {
  if (STOP.requested) return;
  const rawError = e && (e.stack || e.message) ? (e.stack || e.message) : String(e);
  const primary = primaryErrorMessage(rawError);
  const diagnosis = diagnose(primary);
  await log("FATAL", "MANAGER", diagnosis.title + ": " + primary + ". " + diagnosis.advice);
  await shutdown("startup failure");
  process.exitCode = 1;
});
