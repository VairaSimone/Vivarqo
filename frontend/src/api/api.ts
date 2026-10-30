export interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  body?: BodyInit | Record<string, unknown> | null;
}

export interface DocumentUploadMetadata {
  category?: string;
  animalId?: string | null;
  cycleId?: string | null;
  note?: string | null;
}

export interface ApiError extends Error {
  code?: string;
  status?: number;
  details?: unknown;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
let csrfTokenInMemory: string | null = null;

function apiError(message: string, details: Partial<ApiError> = {}): ApiError {
  return Object.assign(new Error(message), details);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function getCsrfToken({ refresh = false }: { refresh?: boolean } = {}): Promise<string> {
  if (csrfTokenInMemory && !refresh) return csrfTokenInMemory;
  const response = await fetch("/api/v1/auth/csrf", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const payload = await response.json().catch(() => null) as { csrfToken?: unknown; message?: string } | null;
  if (!response.ok || typeof payload?.csrfToken !== "string") {
    throw apiError(payload?.message ?? "Impossibile inizializzare la protezione CSRF.", { status: response.status });
  }
  csrfTokenInMemory = payload.csrfToken;
  return csrfTokenInMemory;
}

async function fetchWithCsrfRetry(url: string, init: RequestInit, headers: Headers): Promise<Response> {
  let response = await fetch(url, { ...init, headers });
  if (response.status === 403) {
    const payload = await response.clone().json().catch(() => null) as {
      code?: string;
      error?: { code?: string };
      errorCode?: string;
    } | null;
    const code = payload?.code ?? payload?.error?.code ?? payload?.errorCode;
    if (code === "CSRF_INVALID") {
      headers.set("X-CSRF-Token", await getCsrfToken({ refresh: true }));
      response = await fetch(url, { ...init, headers });
    }
  }
  return response;
}

export async function apiRequest<T = Record<string, unknown>>(path: string, options: ApiRequestOptions = {}): Promise<T | null> {
  // Writes are never queued offline in the first release.
  const method = (options.method ?? "GET").toUpperCase();
  if (!SAFE_METHODS.has(method) && typeof navigator !== "undefined" && navigator.onLine === false) {
    throw apiError("Serve una connessione a Internet per modificare i dati. La modifica non è stata salvata.", {
      code: "OFFLINE_MUTATION_BLOCKED",
      status: 0,
    });
  }

  const headers = new Headers(options.headers);
  let body = options.body;
  if (!SAFE_METHODS.has(method) && !path.includes("/webhooks/stripe")) {
    headers.set("X-CSRF-Token", await getCsrfToken());
  }
  if (
    body !== undefined &&
    body !== null &&
    typeof body === "object" &&
    !(body instanceof FormData) &&
    !(body instanceof Blob) &&
    !(body instanceof ArrayBuffer) &&
    !(body instanceof URLSearchParams)
  ) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }

  const url = path.startsWith("/api/") ? path : "/api/v1/" + path.replace(/^\//, "");
  const response = await fetchWithCsrfRetry(url, {
    ...options,
    method,
    body: body as BodyInit | null | undefined,
    credentials: "include",
    cache: "no-store",
  }, headers);
  const payload = response.status === 204
    ? null
    : await response.json().catch(() => null) as unknown;

  if (!response.ok) {
    const errorPayload = isRecord(payload) ? payload : {};
    const message = typeof errorPayload.message === "string"
      ? errorPayload.message
      : typeof errorPayload.error === "string"
        ? errorPayload.error
        : "Richiesta non riuscita (HTTP " + response.status + ").";
    throw apiError(message, {
      status: response.status,
      details: errorPayload.details ?? errorPayload.issues ?? null,
    });
  }
  return payload as T | null;
}

export async function apiUpload<T = Record<string, unknown>>(path: string, file: File): Promise<T> {
  const csrf = await getCsrfToken();
  const headers = new Headers({
    "X-CSRF-Token": csrf,
    "Content-Type": file.name.toLowerCase().endsWith(".xlsx")
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "text/csv; charset=utf-8",
  });
  const url = "/api/v1/" + path.replace(/^\/+/, "");
  const response = await fetchWithCsrfRetry(url, {
    method: "POST", credentials: "include", cache: "no-store", body: file,
  }, headers);
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorPayload = isRecord(payload) ? payload : {};
    throw apiError(
      typeof errorPayload.message === "string" ? errorPayload.message : "Caricamento non riuscito (HTTP " + response.status + ").",
      { status: response.status },
    );
  }
  return payload as T;
}

export async function apiUploadDocument<T = Record<string, unknown>>(file: File, metadata: DocumentUploadMetadata): Promise<T> {
  const csrf = await getCsrfToken();
  const headers = new Headers({
    "X-CSRF-Token": csrf,
    "Content-Type": file.type || "application/octet-stream",
    "X-Document-Name": file.name,
    "X-Document-Category": metadata.category || "other",
  });
  if (metadata.animalId) headers.set("X-Animal-Id", metadata.animalId);
  if (metadata.cycleId) headers.set("X-Cycle-Id", metadata.cycleId);
  if (metadata.note) headers.set("X-Document-Note", metadata.note);
  const response = await fetchWithCsrfRetry("/api/v1/documents", {
    method: "POST", credentials: "include", cache: "no-store", body: file,
  }, headers);
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorPayload = isRecord(payload) ? payload : {};
    throw apiError(
      typeof errorPayload.message === "string" ? errorPayload.message : "Caricamento documento non riuscito (HTTP " + response.status + ").",
      { status: response.status },
    );
  }
  return payload as T;
}

export async function downloadPrivateDocument(id: string, filename: string): Promise<void> {
  const response = await fetch("/api/v1/documents/" + encodeURIComponent(id) + "/download", {
    method: "GET", credentials: "include", cache: "no-store",
    headers: { Accept: "application/octet-stream" },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw apiError(payload?.message ?? "Download non riuscito (HTTP " + response.status + ").", { status: response.status });
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
