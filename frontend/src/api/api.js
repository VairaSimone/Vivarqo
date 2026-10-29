import { enqueueOfflineMutation } from "../offlineQueue.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
let csrfTokenInMemory = null;

function normalizedPath(path) {
  return String(path || "").replace(/^\/api\/v1\//, "").replace(/^\/+/, "").split("?")[0];
}
function isOfflineQueueable(method, path, body) {
  if (SAFE_METHODS.has(method)) return false;
  if (body !== undefined && body !== null && (typeof body !== "object" || body instanceof FormData || body instanceof Blob || body instanceof ArrayBuffer)) return false;
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
  const p = normalizedPath(path);
  const allowed = [
    new RegExp("^animals(?:/" + uuid + ")?$"),
    new RegExp("^animals/" + uuid + "/(?:weights|sheds|notes)$"),
    new RegExp("^(?:weights|sheds|animal-notes|feeding-entries|genetic-traits)/" + uuid + "$"),
    new RegExp("^animals/" + uuid + "/genetic-traits$"),
    new RegExp("^feeding-sessions$"),
    new RegExp("^tasks(?:/" + uuid + "(?:/complete)?)?$"),
    new RegExp("^inventory/items(?:/" + uuid + ")?(?:/movements)?$"),
    new RegExp("^finance/entries(?:/" + uuid + ")?$"),
    new RegExp("^reproduction-cycles(?:/" + uuid + ")?(?:/events)?$"),
    new RegExp("^reproductive-events/" + uuid + "$"),
    new RegExp("^clutches(?:/" + uuid + ")?(?:/(?:eggs|incubation-logs))?$"),
    new RegExp("^eggs/" + uuid + "$"),
    new RegExp("^incubation-logs/" + uuid + "$"),
    new RegExp("^offspring-batches(?:/" + uuid + ")?(?:/animals)?$")
  ];
  return allowed.some(pattern => pattern.test(p));
}
export async function getCsrfToken({ refresh = false } = {}) {
  if (csrfTokenInMemory && !refresh) return csrfTokenInMemory;
  const response = await fetch("/api/v1/auth/csrf", { method: "GET", credentials: "include", cache: "no-store", headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => null);
  if (!response.ok || typeof payload?.csrfToken !== "string") throw new Error(payload?.message ?? "Impossibile inizializzare la protezione CSRF.");
  csrfTokenInMemory = payload.csrfToken;
  return csrfTokenInMemory;
}
async function fetchWithCsrfRetry(url, init, headers) {
  let response = await fetch(url, { ...init, headers });
  if (response.status === 403) {
    const payload = await response.clone().json().catch(() => null);
    const code = payload?.code ?? payload?.error?.code ?? payload?.errorCode;
    if (code === "CSRF_INVALID") {
      headers.set("X-CSRF-Token", await getCsrfToken({ refresh: true }));
      response = await fetch(url, { ...init, headers });
    }
  }
  return response;
}
export async function apiRequest(path, options = {}) {
  const { queueWhenOffline = false, offlineOwner = null, offlineLabel = null, ...requestOptions } = options;
  const method = (requestOptions.method ?? "GET").toUpperCase();
  const headers = new Headers(requestOptions.headers);
  let body = requestOptions.body;
  if (queueWhenOffline && !SAFE_METHODS.has(method) && typeof navigator !== "undefined" && navigator.onLine === false) {
    if (!isOfflineQueueable(method, path, body)) {
      throw new Error("Questa operazione non può essere messa in coda offline. Riprova quando la connessione è disponibile.");
    }
    return enqueueOfflineMutation(offlineOwner, {
      method,
      path: normalizedPath(path),
      body: body === undefined ? null : body,
      label: offlineLabel || method + " " + normalizedPath(path)
    });
  }
  if (!SAFE_METHODS.has(method) && !path.includes("/webhooks/stripe")) headers.set("X-CSRF-Token", await getCsrfToken());
  if (body !== undefined && body !== null && typeof body === "object" && !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }
  const url = path.startsWith("/api/") ? path : "/api/v1/" + path.replace(/^\//, "");
  const response = await fetchWithCsrfRetry(url, {
    ...requestOptions,
    method,
    body,
    credentials: "include",
    cache: "no-store"
  }, headers);
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.message ?? payload?.error ?? "Richiesta non riuscita (HTTP " + response.status + ").");
    error.status = response.status;
    error.details = payload?.details ?? payload?.issues ?? null;
    throw error;
  }
  return payload;
}
export async function apiUpload(path, file) {
  const csrf = await getCsrfToken();
  const headers = new Headers({ "X-CSRF-Token": csrf, "Content-Type": file.name.toLowerCase().endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv; charset=utf-8" });
  const url = "/api/v1/" + path.replace(/^\/+/, "");
  const response = await fetchWithCsrfRetry(url, { method: "POST", credentials: "include", cache: "no-store", body: file }, headers);
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message ?? "Caricamento non riuscito (HTTP " + response.status + ").");
  return payload;
}
export async function apiUploadDocument(file, metadata) {
  const csrf = await getCsrfToken();
  const headers = new Headers({
    "X-CSRF-Token": csrf,
    "Content-Type": file.type || "application/octet-stream",
    "X-Document-Name": file.name,
    "X-Document-Category": metadata.category || "other"
  });
  if (metadata.animalId) headers.set("X-Animal-Id", metadata.animalId);
  if (metadata.cycleId) headers.set("X-Cycle-Id", metadata.cycleId);
  if (metadata.note) headers.set("X-Document-Note", metadata.note);
  const response = await fetchWithCsrfRetry("/api/v1/documents", { method: "POST", credentials: "include", cache: "no-store", body: file }, headers);
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message ?? "Caricamento documento non riuscito (HTTP " + response.status + ").");
  return payload;
}
export async function downloadPrivateDocument(id, filename) {
  const response = await fetch("/api/v1/documents/" + encodeURIComponent(id) + "/download", { method: "GET", credentials: "include", cache: "no-store", headers: { Accept: "application/octet-stream" } });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message ?? "Download non riuscito (HTTP " + response.status + ").");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "documento";
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}