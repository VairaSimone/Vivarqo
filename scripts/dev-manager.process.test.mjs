import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { terminateProcessTree } from "./dev-manager-process.mjs";

test("termina davvero un processo figlio su Windows e Linux", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
    windowsHide: true,
    detached: process.platform !== "win32"
  });
  assert.ok(child.pid);
  await terminateProcessTree(child, 1500);
  assert.ok(child.exitCode !== null || child.signalCode !== null, "il processo deve risultare terminato");
});

test("l'arresto attende la chiusura del processo invece di presumere che sia immediata", async () => {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 250)"], {
    stdio: "ignore",
    windowsHide: true,
    detached: process.platform !== "win32"
  });
  await terminateProcessTree(child, 1500);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});
