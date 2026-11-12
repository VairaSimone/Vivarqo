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

test("classifica i problemi di rete come transitori, non permanenti", () => {
  assert.equal(diagnose("connect ECONNRESET").classification, "transient");
  assert.equal(diagnose("request failed with HTTP 503").classification, "transient");
  assert.equal(diagnose("Error: listen EADDRINUSE").classification, "needs-review");
});

test("non promuove un errore temporaneo isolato a problema permanente", () => {
  const result = summarizeDiagnostics([
    { service: "api", message: "connect ECONNRESET", timestamp: "2026-11-12T10:00:00Z" }
  ]);
  assert.equal(result[0].classification, "transient");
  assert.equal(result[0].confidence, "low");
  assert.equal(result[0].requiresIntervention, false);
});

test("richiede ricorrenza prima di segnalare una configurazione persistente", () => {
  const once = summarizeDiagnostics([{ service: "api", message: "Missing environment variable CSRF_SECRET" }]);
  assert.equal(once[0].classification, "likely-persistent");
  assert.equal(once[0].requiresIntervention, false);
  const repeated = summarizeDiagnostics([1, 2, 3].map((n) => ({
    service: "api", message: "Missing environment variable CSRF_SECRET",
    timestamp: "2026-11-12T10:0" + n + ":00Z"
  })));
  assert.equal(repeated[0].classification, "persistent");
  assert.equal(repeated[0].requiresIntervention, true);
});

test("non promuove errori ricorrenti ma distanti nel tempo a guasti persistenti", () => {
  const result = summarizeDiagnostics([
    { service: "api", message: "Missing environment variable CSRF_SECRET", timestamp: "2026-11-12T10:00:00Z" },
    { service: "api", message: "Missing environment variable CSRF_SECRET", timestamp: "2026-11-12T10:10:00Z" },
    { service: "api", message: "Missing environment variable CSRF_SECRET", timestamp: "2026-11-12T10:20:00Z" }
  ]);
  assert.equal(result[0].classification, "likely-persistent");
  assert.equal(result[0].requiresIntervention, false);
});
