import test from "node:test";
import assert from "node:assert/strict";
import { diagnose, summarizeDiagnostics } from "./dev-manager-core.mjs";

test("classifica problemi comuni con suggerimenti operativi", () => {
  assert.equal(diagnose("Error: connect ECONNREFUSED 127.0.0.1:5432").id, "db-connection");
  assert.equal(diagnose("Error: listen EADDRINUSE: address already in use").id, "port-in-use");
  assert.equal(diagnose("ERR_MODULE_NOT_FOUND: Cannot find package").id, "dependency");
  assert.equal(diagnose("Migration failed P3018").id, "migration");
});

test("raggruppa errori equivalenti senza perdere servizi e conteggio", () => {
  const result = summarizeDiagnostics([
    { service: "api", message: "listen EADDRINUSE port 3000", timestamp: "2026-01-01T10:00:00Z" },
    { service: "frontend", message: "listen EADDRINUSE port 5173", timestamp: "2026-01-01T10:01:00Z" }
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].count, 2);
  assert.deepEqual(result[0].services.sort(), ["api", "frontend"]);
});

test("non espone messaggi vuoti o illimitati", () => {
  const item = diagnose("x".repeat(10000));
  assert.equal(item.id, "unknown");
  assert.ok(item.signature.length <= 230);
});
