const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
let csrfTokenInMemory = null;

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
  // Ignore legacy offline-queue options: writes are never queued in the first release.
  const { queueWhenOffline: _queueWhenOffline, offlineOwner: _offlineOwner, offlineLabel: _offlineLabel, ...requestOptions } = options;
  const method = (requestOptions.method ?? "GET").toUpperCase();
  if (!SAFE_METHODS.has(method) && typeof navigator !== "undefined" && navigator.onLine === false) {
    const error = new Error("Serve una connessione a Internet per modificare i dati. La modifica non è stata salvata.");
    error.code = "OFFLINE_MUTATION_BLOCKED";
    error.status = 0;
    throw error;
  }
  const headers = new Headers(requestOptions.headers);
  let body = requestOptions.body;
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