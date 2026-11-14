import test from "node:test";
import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import { diagnose, primaryErrorMessage, summarizeDiagnostics } from "./dev-manager-core.mjs";
import {
  clearUnusedVapidPlaceholder, findAvailablePort, getIncompleteVapidVariables,
  getInvalidVapidVariables, getLocalPostgresPort, getPortFromComposeMapping, readEnvValue, setEnvValues,
  withLocalPostgresPort
} from "./dev-manager-config.mjs";

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

test("seleziona una porta libera senza provare a terminare il processo che occupa quella preferita", async () => {
  const tried = [];
  const selected = await findAvailablePort(5432, 5435, async port => {
    tried.push(port);
    return port === 5434;
  });
  assert.equal(selected, 5434);
  assert.deepEqual(tried, [5432, 5433, 5434]);
});

test("rifiuta una configurazione quando nessuna porta nell'intervallo è disponibile", async () => {
  const selected = await findAvailablePort(5432, 5434, async () => false);
  assert.equal(selected, null);
});

test("legge e aggiorna soltanto assegnazioni .env attive preservando i commenti", () => {
  const original = "# DATABASE_URL=postgresql://ignored\nDATABASE_URL=postgresql://vivarqo:dev@localhost:5432/vivarqo?schema=public\nVAPID_SUBJECT=mailto:admin@example.com\n";
  assert.equal(readEnvValue(original, "DATABASE_URL"), "postgresql://vivarqo:dev@localhost:5432/vivarqo?schema=public");
  const updated = setEnvValues(original, { VIVARQO_POSTGRES_HOST_PORT: "5433", VAPID_SUBJECT: "" });
  assert.match(updated, /^# DATABASE_URL=postgresql:/m);
  assert.match(updated, /^VIVARQO_POSTGRES_HOST_PORT=5433$/m);
  assert.match(updated, /^VAPID_SUBJECT=$/m);
});

test("aggiorna soltanto URL PostgreSQL locali e conserva path e query", () => {
  const url = "postgresql://user:pass@localhost:5432/vivarqo?schema=public";
  assert.equal(getLocalPostgresPort(url), 5432);
  assert.equal(getLocalPostgresPort("postgresql://db.internal:5432/vivarqo"), null);
  assert.equal(withLocalPostgresPort(url, 5433), "postgresql://user:pass@localhost:5433/vivarqo?schema=public");
  assert.equal(getPortFromComposeMapping("127.0.0.1:5433\n"), 5433);
});

test("riutilizza il subject VAPID di esempio solo quando tutte le chiavi sono assenti", () => {
  const example = "VAPID_PUBLIC_KEY=\nVAPID_PRIVATE_KEY=\nVAPID_SUBJECT=mailto:admin@example.com\n";
  const normalized = clearUnusedVapidPlaceholder(example);
  assert.equal(readEnvValue(normalized, "VAPID_SUBJECT"), "");
  assert.deepEqual(getIncompleteVapidVariables(normalized), []);
  const partial = "VAPID_PUBLIC_KEY=real-public-key\nVAPID_PRIVATE_KEY=\nVAPID_SUBJECT=\n";
  assert.deepEqual(getIncompleteVapidVariables(partial), ["VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]);
});


test("verifica chiavi VAPID P-256 con byte iniziale omesso e rileva coppie non corrispondenti", () => {
  const curve = createECDH("prime256v1");
  const fixedPrivateKey = Buffer.alloc(32);
  fixedPrivateKey[31] = 1;
  curve.setPrivateKey(fixedPrivateKey);
  const exportedPrivateKey = curve.getPrivateKey("base64url");
  assert.ok(Buffer.from(exportedPrivateKey, "base64url").length < 32, "il caso deve riprodurre l'esportazione senza zero iniziale");

  const valid = [
    "VAPID_PUBLIC_KEY=" + curve.getPublicKey("base64url", "uncompressed"),
    "VAPID_PRIVATE_KEY=" + exportedPrivateKey,
    "VAPID_SUBJECT=mailto:admin@vivarqo.example"
  ].join("\n");
  assert.deepEqual(getInvalidVapidVariables(valid), []);

  const otherCurve = createECDH("prime256v1");
  otherCurve.generateKeys();
  const mismatched = valid.replace(
    "VAPID_PUBLIC_KEY=" + curve.getPublicKey("base64url", "uncompressed"),
    "VAPID_PUBLIC_KEY=" + otherCurve.getPublicKey("base64url", "uncompressed")
  );
  assert.deepEqual(getInvalidVapidVariables(mismatched), ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"]);
});

test("diagnostica errori generici di ambiente anche quando il campo non è Sentry o Metrics", () => {
  assert.equal(diagnose("Invalid environment configuration: APP_ORIGIN: invalid URL").id, "env-invalid");
  assert.equal(diagnose("Configurazione VAPID non valida: VAPID_PRIVATE_KEY").id, "vapid-incomplete");
});

test("sceglie la causa primaria della configurazione invece dell'errore secondario tsx", () => {
  const output = [
    "Error: Invalid environment configuration: SENTRY_DSN: Invalid URL",
    "at config/env.ts:70",
    'Error: Command "tsx" not found',
    "ELIFECYCLE Command failed with exit code 1"
  ].join("\n");
  assert.match(primaryErrorMessage(output), /Invalid environment configuration: SENTRY_DSN/);
  assert.equal(diagnose(primaryErrorMessage(output)).id, "env-invalid");
});

test("classifica i problemi di binding Docker e i build script bloccati", () => {
  assert.equal(diagnose("Error response from daemon: ports are not available").id, "docker-port-binding");
  assert.equal(diagnose("Error: listen EADDRINUSE: address already in use").id, "port-in-use");
  assert.equal(diagnose("Ignored build scripts: @prisma/engines").id, "pnpm-build-scripts");
  assert.equal(diagnose("DEP0190 shell option true").id, "shell-deprecation");
});



test("estrae lo stderr Docker invece dell'involucro generico del comando fallito", () => {
  const output = [
    "Error: docker compose -f backend\\infra\\docker\\compose.yaml up -d postgres exit 1:",
    "failed to pull image 'postgres:18': failed to resolve reference",
    "    at ChildProcess.<anonymous> (scripts/dev-manager.mjs:80:16)",
    "ELIFECYCLE Command failed with exit code 1"
  ].join("\n");
  assert.equal(primaryErrorMessage(output), "failed to pull image 'postgres:18': failed to resolve reference");
  assert.equal(diagnose(primaryErrorMessage(output)).id, "docker-image");
});

test("riconosce Docker Desktop spento e non confonde il messaggio con un errore sconosciuto", () => {
  const message = "Error: docker compose up exit 1:\nerror during connect: open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.";
  const primary = primaryErrorMessage(message);
  assert.match(primary, /error during connect/);
  assert.equal(diagnose(primary).id, "docker-daemon");
});

test("mantiene la diagnosi prioritaria per gli errori Docker di binding porta", () => {
  const message = "Error: docker compose up exit 1:\nError response from daemon: ports are not available: listen tcp 127.0.0.1:5433";
  assert.match(primaryErrorMessage(message), /ports are not available/);
  assert.equal(diagnose(primaryErrorMessage(message)).id, "docker-port-binding");
});
