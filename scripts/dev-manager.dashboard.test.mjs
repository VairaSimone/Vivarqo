import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
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
function startManager(env) {
  return spawn(process.execPath, ["scripts/dev-manager.mjs"], {
    cwd: process.cwd(), env, stdio: "ignore", windowsHide: true
  });
}
async function waitForState(url, predicate, timeoutMs = 25_000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        last = await response.json();
        if (predicate(last)) return last;
      }
    } catch {}
    await delay(250);
  }
  throw new Error("Timeout dashboard. Ultimo snapshot: " + JSON.stringify(last));
}
async function readSseUntil(reader, needle, timeoutMs = 10_000) {
  const decoder = new TextDecoder();
  let output = "";
  while (true) {
    const chunk = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout lettura SSE: " + needle)), timeoutMs);
      reader.read().then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
    });
    if (chunk.done) throw new Error("Stream SSE chiuso prima di ricevere: " + needle);
    output += decoder.decode(chunk.value, { stream: true });
    if (output.includes(needle)) return output;
  }
}
function killPid(pid) {
  if (process.platform === "win32") {
    try { execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch {}
  } else {
    try { process.kill(pid, "SIGKILL"); } catch {}
  }
}
function isPidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
async function stopManager(manager) {
  if (manager.exitCode !== null || manager.signalCode !== null) return;
  manager.kill(process.platform === "win32" ? "SIGINT" : "SIGTERM");
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Manager non terminato entro 15 secondi.")), 15_000);
      manager.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  } catch (error) {
    killPid(manager.pid);
    throw error;
  }
}

test("dashboard: filtri, SSE, riconnessione e log persistenti dopo il riavvio del manager", { timeout: 120_000 }, async () => {
  const apiPort = await freePort();
  const webPort = await freePort();
  const dashboardPort = await freePort();
  const logDir = await mkdtemp(path.join(tmpdir(), "vivarqo-manager-logs-"));
  const baseEnv = {
    ...process.env,
    VIVARQO_MANAGER_TEST_MODE: "1",
    VIVARQO_MANAGER_PORT: String(dashboardPort),
    VIVARQO_MANAGER_LOG_DIR: logDir,
    VIVARQO_TEST_API_PORT: String(apiPort),
    VIVARQO_TEST_WEB_PORT: String(webPort),
    VIVARQO_API_URL: "http://127.0.0.1:" + apiPort + "/healthz",
    VIVARQO_WEB_URL: "http://127.0.0.1:" + webPort + "/",
    VIVARQO_DISABLE_TOAST: "1"
  };
  const stateUrl = "http://127.0.0.1:" + dashboardPort + "/api/state";
  const htmlUrl = "http://127.0.0.1:" + dashboardPort + "/";
  const eventsUrl = "http://127.0.0.1:" + dashboardPort + "/events";
  const pids = [];
  let manager;

  try {
    manager = startManager(baseEnv);
    let snapshot = await waitForState(stateUrl, state =>
      ["api", "worker", "frontend"].every(name => state.services.some(item => item.name === name && item.state === "running" && item.pid))
    );
    pids.push(...snapshot.services.filter(item => item.pid).map(item => item.pid));

    const html = await (await fetch(htmlUrl)).text();
    assert.ok(html.includes('data-filter="ERROR"'), "filtro errori mancante");
    assert.ok(html.includes('data-filter="WARN"'), "filtro avvisi mancante");
    assert.ok(html.includes('id="service-filter"'), "filtro per servizio mancante");
    assert.ok(html.includes("service==='all'||x.service===service"), "render dei log non applica il filtro servizio");
    assert.ok(html.includes("new EventSource('/events')"), "stream live SSE mancante");
    assert.ok(html.includes("stream.onerror=") && html.includes("stream.onopen="), "gestione riconnessione SSE mancante");

    const controller = new AbortController();
    const stream = await fetch(eventsUrl, { signal: controller.signal });
    assert.match(stream.headers.get("content-type") || "", /text\/event-stream/);
    const reader = stream.body.getReader();

    const oldApiPid = snapshot.services.find(item => item.name === "api").pid;
    killPid(oldApiPid);
    snapshot = await waitForState(stateUrl, state => {
      const api = state.services.find(item => item.name === "api");
      return api && api.state === "running" && api.pid && api.pid !== oldApiPid;
    });
    const newApiPid = snapshot.services.find(item => item.name === "api").pid;
    pids.push(newApiPid);

    const event = await readSseUntil(reader, "Processo terminato");
    assert.ok(event.includes('"service":"api"'), "evento SSE non identifica l'API");
    controller.abort();
    await reader.cancel().catch(() => {});

    const reconnectController = new AbortController();
    const reconnect = await fetch(eventsUrl, { signal: reconnectController.signal });
    assert.equal(reconnect.status, 200, "la dashboard non accetta una nuova connessione SSE");
    reconnectController.abort();
    await reconnect.body.cancel().catch(() => {});

    assert.ok(snapshot.logs.some(item => item.service === "api" && item.message.includes("Processo terminato")),
      "il log di terminazione non compare nello snapshot");

    await stopManager(manager);
    manager = undefined;

    manager = startManager(baseEnv);
    snapshot = await waitForState(stateUrl, state =>
      ["api", "worker", "frontend"].every(name => state.services.some(item => item.name === name && item.state === "running" && item.pid))
    );
    pids.push(...snapshot.services.filter(item => item.pid).map(item => item.pid));
    assert.ok(snapshot.logs.some(item => item.service === "api" && item.message.includes("Processo terminato")),
      "il log precedente non è stato ricaricato dopo il riavvio del manager");
  } finally {
    if (manager && manager.exitCode === null && manager.signalCode === null) await stopManager(manager).catch(() => killPid(manager.pid));
    await rm(logDir, { recursive: true, force: true });
  }

  for (const pid of pids) {
    await delay(100);
    assert.equal(isPidAlive(pid), false, "processo orfano rilevato: PID " + pid);
  }
});
