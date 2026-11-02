const API_BASE = "/api/v1";
let csrfToken: string | null = null;
let csrfPromise: Promise<string> | null = null;
let apiLocale = "it";
let unauthorizedHandler: (() => void) | null = null;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(status: number, message: string, code = "API_ERROR", details: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function setApiLocale(locale: string): void {
  apiLocale = locale === "en" ? "en" : "it";
}
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}
function notifyUnauthorized(path: string, status: number): void {
  if (status === 401 && !path.startsWith("/auth/")) unauthorizedHandler?.();
}
export function clearCsrfCache(): void {
  csrfToken = null;
  csrfPromise = null;
}

async function parseError(response: Response): Promise<ApiError> {
  let payload: Record<string, unknown> = {};
  try {
    const value: unknown = await response.json();
    if (typeof value === "object" && value !== null) payload = value as Record<string, unknown>;
  } catch { /* a proxy can return an empty or non-JSON error */ }
  const message = typeof payload.message === "string" ? payload.message
    : typeof payload.error === "string" ? payload.error
    : response.statusText || "The request could not be completed";
  const code = typeof payload.code === "string" ? payload.code : "HTTP_ERROR";
  return new ApiError(response.status, message, code, payload.details ?? null);
}

async function getCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  if (!csrfPromise) {
    csrfPromise = fetch(API_BASE + "/auth/csrf", {
      method: "GET",
      credentials: "include",
      headers: { "Accept": "application/json", "Accept-Language": apiLocale }
    }).then(async (response) => {
      if (!response.ok) throw await parseError(response);
      const payload = await response.json() as { csrfToken?: unknown };
      if (typeof payload.csrfToken !== "string" || payload.csrfToken.length < 32) {
        throw new ApiError(502, "The server did not return a valid CSRF token", "CSRF_TOKEN_INVALID");
      }
      csrfToken = payload.csrfToken;
      return payload.csrfToken;
    }).finally(() => { csrfPromise = null; });
  }
  return csrfPromise;
}

async function request<T>(path: string, method: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
  const headers = new Headers({ "Accept": "application/json", "Accept-Language": apiLocale });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (mutating) headers.set("X-CSRF-Token", await getCsrfToken());
  const response = await fetch(API_BASE + path, {
    method,
    credentials: "include",
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...(signal ? { signal } : {})
  });
  if (!response.ok) {
    const error = await parseError(response);
    notifyUnauthorized(path, error.status);
    if (error.code === "CSRF_INVALID" || error.status === 403 && mutating) clearCsrfCache();
    throw error;
  }
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return undefined as T;
  return await response.json() as T;
}

export const api = {
  get<T>(path: string, options: { signal?: AbortSignal } = {}): Promise<T> {
    return request<T>(path, "GET", undefined, options.signal);
  },
  post<T = void>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, "POST", body);
  },
  patch<T = void>(path: string, body: unknown): Promise<T> {
    return request<T>(path, "PATCH", body);
  },
  delete<T = void>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, "DELETE", body);
  },
  async upload<T>(path: string, file: File, extraHeaders: Record<string, string> = {}): Promise<T> {
    const headers = new Headers({
      "Accept": "application/json",
      "Accept-Language": apiLocale,
      "X-CSRF-Token": await getCsrfToken()
    });
    for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
    headers.set("Content-Type", file.type || "application/octet-stream");
    const response = await fetch(API_BASE + path, {
      method: "POST",
      credentials: "include",
      headers,
      body: file
    });
    if (!response.ok) {
      const error = await parseError(response);
      notifyUnauthorized(path, error.status);
      throw error;
    }
    return await response.json() as T;
  },
  async download(path: string, fallbackFilename = "download"): Promise<void> {
    // Use a same-origin native download so large files stream directly to disk rather
    // than being duplicated in JavaScript memory through response.blob().
    const anchor = document.createElement("a");
    anchor.href = API_BASE + path;
    anchor.download = fallbackFilename.replace(/[\\/\r\n]/g, "_").slice(0, 180) || "download";
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }
};
