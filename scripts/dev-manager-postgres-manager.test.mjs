import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const composeFile = "backend/infra/docker/compose.yaml";
const compose = args => execFileSync("docker", ["compose", "-f", composeFile, ...args], {
  cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000
});
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
  throw new Error("Timeout: " + description);
}
async function waitForExit(child, timeoutMs = 15_000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Manager non terminato entro il timeout.")), timeoutMs);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}
async function main() {
  if (process.platform !== "linux") throw new Error("Il drill PostgreSQL del manager va eseguito su Linux.");
  const logDir = await mkdtemp(path.join(tmpdir(), "vivarqo-manager-postgres-"));
  const table = "dev_manager_recovery_" + process.pid;
  const marker = randomUUID();
  const apiPort = await freePort(), webPort = await freePort(), dashboardPort = await freePort();
  const stateUrl = "http://127.0.0.1:" + dashboardPort + "/api/state";
  const pids = [];
  let manager, tableCreated = false, postgresStopped = false;
  try {
    compose(["up", "-d", "postgres"]);
    await waitFor(() => { compose(["exec", "-T", "postgres", "pg_isready", "-U", "vivarqo", "-d", "vivarqo"]); return true; }, 60_000, "PostgreSQL iniziale ready");
    compose(["exec", "-T", "postgres", "psql", "-U", "vivarqo", "-d", "vivarqo", "-v", "ON_ERROR_STOP=1", "-c",
      "CREATE TABLE " + table + " (id integer PRIMARY KEY, marker text NOT NULL)"]);
    tableCreated = true;
    compose(["exec", "-T", "postgres", "psql", "-U", "vivarqo", "-d", "vivarqo", "-v", "ON_ERROR_STOP=1", "-c",
      "INSERT INTO " + table + " (id, marker) VALUES (1, '" + marker + "')"]);

    manager = spawn(process.execPath, ["scripts/dev-manager.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CI: "true",
        VIVARQO_MANAGER_TEST_MODE: "1",
        VIVARQO_MANAGER_TEST_POSTGRES: "1",
        VIVARQO_MANAGER_LOG_DIR: logDir,
        VIVARQO_MANAGER_PORT: String(dashboardPort),
        VIVARQO_TEST_API_PORT: String(apiPort),
        VIVARQO_TEST_WEB_PORT: String(webPort),
        VIVARQO_API_URL: "http://127.0.0.1:" + apiPort + "/healthz",
        VIVARQO_WEB_URL: "http://127.0.0.1:" + webPort + "/",
        VIVARQO_DISABLE_TOAST: "1"
      },
      stdio: "ignore",
      windowsHide: true
    });

    let snapshot = await waitFor(async () => {
      const response = await fetch(stateUrl, { signal: AbortSignal.timeout(1500) });
      if (!response.ok) return false;
      const state = await response.json();
      return state.services.some(x => x.name === "postgres" && x.state === "running") &&
        ["api", "worker", "frontend"].every(name => state.services.some(x => x.name === name && x.state === "running" && x.pid))
        ? state : false;
    }, 45_000, "manager e servizi di test avviati");
    pids.push(...snapshot.services.filter(x => x.pid).map(x => x.pid));

    console.log("Arresto forzato del container PostgreSQL...");
    compose(["stop", "postgres"]);
    postgresStopped = true;

    snapshot = await waitFor(async () => {
      const response = await fetch(stateUrl, { signal: AbortSignal.timeout(1500) });
      if (!response.ok) return false;
      const state = await response.json();
      const pg = state.services.find(x => x.name === "postgres");
      return pg && pg.state === "running" && pg.restarts >= 1 ? state : false;
    }, 90_000, "ripristino PostgreSQL eseguito dal manager");
    assert.ok(snapshot.services.find(x => x.name === "postgres").restarts >= 1);

    const actual = compose(["exec", "-T", "postgres", "psql", "-U", "vivarqo", "-d", "vivarqo", "-v", "ON_ERROR_STOP=1", "-At", "-c",
      "SELECT marker FROM " + table + " WHERE id = 1"]).trim();
    assert.equal(actual, marker, "il dato persistente deve sopravvivere al recupero gestito dal manager");
    console.log("PASS: il manager ha recuperato PostgreSQL e il dato persistente è rimasto intatto.");
  } finally {
    if (manager && manager.exitCode === null && manager.signalCode === null) {
      manager.kill("SIGTERM");
      await waitForExit(manager).catch(() => { try { process.kill(manager.pid, "SIGKILL"); } catch {} });
    }
    if (postgresStopped) {
      try { compose(["start", "postgres"]); } catch {}
    }
    if (tableCreated) {
      try { compose(["exec", "-T", "postgres", "psql", "-U", "vivarqo", "-d", "vivarqo", "-c", "DROP TABLE IF EXISTS " + table]); } catch {}
    }
    await rm(logDir, { recursive: true, force: true });
  }
  for (const pid of pids) {
    await delay(100);
    try { process.kill(pid, 0); assert.fail("processo orfano rilevato: PID " + pid); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
