const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
let csrfTokenInMemory = null;

export async function getCsrfToken({ refresh = false } = {}) {
  if (csrfTokenInMemory && !refresh) return csrfTokenInMemory;

  const response = await fetch("/api/v1/auth/csrf", {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" }
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok || typeof payload?.csrfToken !== "string") {
    throw new Error("Impossibile inizializzare la protezione CSRF.");
  }

  // Il cookie gemello è HttpOnly: il token CSRF resta solo in memoria.
  csrfTokenInMemory = payload.csrfToken;
  return csrfTokenInMemory;
}

export async function apiRequest(path, options = {}) {
  const method = (options.method ?? "GET").toUpperCase();
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
    !(body instanceof ArrayBuffer)
  ) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }

  return fetch(path, {
    ...options,
    method,
    headers,
    body,
    credentials: "include"
  });
}
