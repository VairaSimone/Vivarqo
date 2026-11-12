import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function waitFor(predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { last = await predicate(); if (last) return last; } catch {}
    await delay(500);
  }
  throw new Error("Timeout: " + description + ". Ultimo stato: " + JSON.stringify(last));
}
async function stopManager(manager) {
  if (!manager || manager.exitCode !== null || manager.signalCode !== null) return;
  manager.kill("SIGTERM");
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Production Manager non terminato entro 15 secondi.")), 15_000);
    manager.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}

async function main() {
  if (process.platform !== "linux") throw new Error("Il test del Production Manager richiede Linux.");
  const temp = await mkdtemp(path.join(tmpdir(), "vivarqo-production-manager-"));
  const composeFile = path.join(temp, "compose.production.test.yaml");
  const envFile = path.join(temp, "production.env");
  const logDir = path.join(temp, "logs");
  const port = await freePort();
  const yaml = `services:
  postgres:
    image: postgres:18
    environment:
      POSTGRES_USER: vivarqo
      POSTGRES_DB: vivarqo
      POSTGRES_PASSWORD: manager-test-password
    volumes:
      - prod-manager-test-data:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U vivarqo -d vivarqo"]
      interval: 2s
      timeout: 3s
      retries: 30
    restart: unless-stopped

  migrate:
    image: postgres:18
    environment:
      POSTGRES_USER: vivarqo
      POSTGRES_DB: vivarqo
      PGPASSWORD: manager-test-password
    depends_on:
      postgres:
        condition: service_healthy
    entrypoint: ["/bin/sh", "-c"]
    command: >
      psql -h postgres -U vivarqo -d vivarqo -v ON_ERROR_STOP=1
      -c "CREATE TABLE api_rate_limit_buckets (namespace text PRIMARY KEY, reset_at timestamptz NOT NULL);"
      -c "INSERT INTO api_rate_limit_buckets VALUES ('worker-heartbeat', NOW() + INTERVAL '1 day');"
    restart: "no"

  api:
    image: alpine:3.22
    command: ["sh", "-c", "sleep infinity"]
    restart: unless-stopped
  web:
    image: alpine:3.22
    command: ["sh", "-c", "sleep infinity"]
    restart: unless-stopped
  worker:
    image: alpine:3.22
    command: ["sh", "-c", "sleep infinity"]
    depends_on:
      migrate:
        condition: service_completed_successfully
    restart: unless-stopped
  caddy:
    image: alpine:3.22
    command: ["sh", "-c", "sleep infinity"]
    restart: unless-stopped
  backup:
    image: alpine:3.22
    command: ["sh", "-c", "sleep infinity"]
    restart: unless-stopped

volumes:
  prod-manager-test-data:
`;
  await writeFile(composeFile, yaml, "utf8");
  await writeFile(envFile, "POSTGRES_USER=vivarqo\nPOSTGRES_DB=vivarqo\nPOSTGRES_PASSWORD=manager-test-password\n", "utf8");
  const compose = args => execFileSync("docker", ["compose", "--env-file", envFile, "-f", composeFile, ...args], {
    cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000
  });
  const stateUrl = "http://127.0.0.1:" + port + "/api/state";
  let manager, composeStarted = false;
  try {
    manager = spawn(process.execPath, ["scripts/dev-manager.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CI: "true",
        VIVARQO_MANAGER_MODE: "production",
        VIVARQO_MANAGER_PRODUCTION_COMPOSE: composeFile,
        VIVARQO_ENV_FILE: envFile,
        VIVARQO_MANAGER_LOG_DIR: logDir,
        VIVARQO_MANAGER_PORT: String(port)
      },
      stdio: "ignore",
      windowsHide: true
    });
    composeStarted = true;
    let snapshot = await waitFor(async () => {
      const response = await fetch(stateUrl, { signal: AbortSignal.timeout(2000) });
      if (!response.ok) return false;
      const state = await response.json();
      const get = name => state.services.find(x => x.name === name);
      return get("postgres")?.state === "running" &&
        get("migrate")?.state === "completed" &&
        ["api", "web", "worker", "caddy", "backup"].every(name => get(name)?.state === "running")
        ? state : false;
    }, 120_000, "stack Compose production isolato pronto");

    compose(["exec", "-T", "postgres", "psql", "-U", "vivarqo", "-d", "vivarqo", "-v", "ON_ERROR_STOP=1", "-c",
      "INSERT INTO api_rate_limit_buckets VALUES ('persist-marker', '2099-01-01T00:00:00Z')"]);
    console.log("Stop PostgreSQL: il Production Manager deve recuperare il container senza perdere il volume.");
    compose(["stop", "postgres"]);

    snapshot = await waitFor(async () => {
      const response = await fetch(stateUrl, { signal: AbortSignal.timeout(2000) });
      if (!response.ok) return false;
      const state = await response.json();
      const pg = state.services.find(x => x.name === "postgres");
      return pg && pg.state === "running" && pg.restarts >= 1 ? state : false;
    }, 120_000, "recovery PostgreSQL eseguito dal Production Manager");
    assert.ok(snapshot.services.find(x => x.name === "postgres").restarts >= 1);

    const value = compose(["exec", "-T", "postgres", "psql", "-U", "vivarqo", "-d", "vivarqo", "-v", "ON_ERROR_STOP=1", "-At", "-c",
      "SELECT COUNT(*) FROM api_rate_limit_buckets WHERE namespace = 'persist-marker'"]).trim();
    assert.equal(value, "1", "il dato deve sopravvivere al recovery del Production Manager");

    await stopManager(manager);
    manager = undefined;
    const psOutput = compose(["ps", "--all", "--format", "json"]).trim();
    let rows;
    try {
      const parsed = JSON.parse(psOutput);
      rows = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      rows = psOutput.split("\n").map(x => x.trim()).filter(Boolean).map(x => JSON.parse(x));
    }
    assert.ok(rows.some(row => row.Service === "postgres" && row.State === "running"),
      "chiudere il manager non deve arrestare i container di produzione");
    console.log("PASS: Production Manager Linux ha recuperato PostgreSQL, preservato i dati e lasciato lo stack attivo allo shutdown.");
  } finally {
    if (manager && manager.exitCode === null && manager.signalCode === null) await stopManager(manager).catch(() => { try { process.kill(manager.pid, "SIGKILL"); } catch {} });
    if (composeStarted) { try { compose(["down", "-v"]); } catch {} }
    await rm(temp, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
