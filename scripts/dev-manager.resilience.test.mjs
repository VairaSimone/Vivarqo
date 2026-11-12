import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
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
  throw new Error("Timeout in attesa dello stato manager. Ultimo snapshot: " + JSON.stringify(last));
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
async function waitForExit(child, timeoutMs = 15_000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise(resolve => child.once("exit", resolve)),
    delay(timeoutMs).then(() => { throw new Error("Manager non terminato entro il timeout."); })
  ]);
}

test("riavvia API, worker e frontend dopo terminazione forzata e non lascia processi orfani", { timeout: 120_000 }, async () => {
  const apiPort = await freePort();
  const webPort = await freePort();
  const dashboardPort = await freePort();
  const stateUrl = "http://127.0.0.1:" + dashboardPort + "/api/state";
  const manager = spawn(process.execPath, ["scripts/dev-manager.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      VIVARQO_MANAGER_TEST_MODE: "1",
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
  const observedPids = [];
  try {
    let snapshot = await waitForState(stateUrl, s =>
      ["api", "worker", "frontend"].every(name => s.services.some(x => x.name === name && x.state === "running" && x.pid))
    );
    for (const name of ["api", "worker", "frontend"]) {
      const before = snapshot.services.find(x => x.name === name).pid;
      observedPids.push(before);
      killPid(before);
      snapshot = await waitForState(stateUrl, s => {
        const service = s.services.find(x => x.name === name);
        return service && service.state === "running" && service.pid && service.pid !== before;
      });
      const after = snapshot.services.find(x => x.name === name).pid;
      observedPids.push(after);
      assert.notEqual(after, before, name + " deve avere un PID nuovo dopo il riavvio");
      if (name === "api") {
        const health = await fetch("http://127.0.0.1:" + apiPort + "/healthz");
        assert.equal(health.status, 200);
      }
      if (name === "frontend") {
        const health = await fetch("http://127.0.0.1:" + webPort + "/");
        assert.equal(health.status, 200);
      }
    }
  } finally {
    if (manager.exitCode === null && manager.signalCode === null) {
      manager.kill("SIGTERM");
      await waitForExit(manager).catch(() => killPid(manager.pid));
    }
  }
  for (const pid of observedPids) {
    await delay(100);
    assert.equal(isPidAlive(pid), false, "processo figlio orfano rilevato: PID " + pid);
  }
});
