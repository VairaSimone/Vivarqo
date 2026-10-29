const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
let csrfTokenInMemory = null;

export async function getCsrfToken({ refresh = false } = {}) {
  if (csrfTokenInMemory && !refresh) return csrfTokenInMemory;
  const response = await fetch("/api/v1/auth/csrf", { method: "GET", credentials: "include", headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => null);
  if (!response.ok || typeof payload?.csrfToken !== "string") throw new Error(payload?.message ?? "Impossibile inizializzare la protezione CSRF.");
  csrfTokenInMemory = payload.csrfToken;
  return csrfTokenInMemory;
}
export async function apiRequest(path, options = {}) {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  let body = options.body;
  if (!SAFE_METHODS.has(method) && !path.includes("/webhooks/stripe")) headers.set("X-CSRF-Token", await getCsrfToken());
  if (body !== undefined && body !== null && typeof body === "object" && !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) {
    headers.set("Content-Type", "application/json"); body = JSON.stringify(body);
  }
  const response = await fetch(path.startsWith("/api/") ? path : "/api/v1/" + path.replace(/^\//, ""), { ...options, method, headers, body, credentials: "include" });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.message ?? payload?.error ?? `Richiesta non riuscita (HTTP ${response.status}).`);
    error.status = response.status; error.details = payload?.details ?? payload?.issues ?? null; throw error;
  }
  return payload;
}
export async function apiUpload(path, file) {
  const csrf = await getCsrfToken();
  const contentType = file.name.toLowerCase().endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv; charset=utf-8";
  const response = await fetch("/api/v1/" + path.replace(/^\//, ""), { method: "POST", credentials: "include", headers: { "X-CSRF-Token": csrf, "Content-Type": contentType }, body: file });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message ?? `Caricamento non riuscito (HTTP ${response.status}).`);
  return payload;
}
