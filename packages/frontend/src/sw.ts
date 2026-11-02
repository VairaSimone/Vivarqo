import { registerNotificationEventHandlers } from "./sw-notifications";

const CACHE_NAME = "vivarqo-shell-v4";
const REQUIRED_SHELL_URLS = ["/index.html"];
const OPTIONAL_SHELL_URLS = [
  "/", "/manifest.webmanifest", "/vivarqo-icon.svg",
  "/icons/icon-192.svg", "/icons/icon-512.svg",
  "/icons/icon-192.png", "/icons/icon-512.png",
];
type ExtendableLike = { waitUntil(promise: Promise<unknown>): void };
type FetchLike = ExtendableLike & { request: Request; respondWith(response: Promise<Response> | Response): void };
type WorkerScopeLike = {
  addEventListener(type: string, callback: (event: any) => void): void;
  skipWaiting(): Promise<void>;
  registration: { showNotification(title: string, options: Record<string, unknown>): Promise<void> };
  clients: {
    claim(): Promise<void>;
    matchAll(options: { type: "window"; includeUncontrolled: boolean }): Promise<Array<{url: string; focused?: boolean; focus(): Promise<unknown>; navigate?(url: string): Promise<unknown>}>>;
    openWindow(url: string): Promise<unknown>;
  };
  location: { origin: string };
};
const worker = self as unknown as WorkerScopeLike;

async function fetchPrecache(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { cache: "no-cache", signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Precache request for ${url} timed out after ${timeoutMs} ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

worker.addEventListener("install", (rawEvent) => {
  const event = rawEvent as ExtendableLike;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      for (const url of REQUIRED_SHELL_URLS) {
        const response = await fetchPrecache(url, 15_000);
        if (!response.ok) throw new Error(`Required shell resource ${url} returned HTTP ${response.status}`);
        await cache.put(url, response);
      }
      const html = await (await cache.match("/index.html"))?.text();
      if (!html) throw new Error("The cached application shell is empty");
      const assets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)]
        .map((match) => match[1]!).filter((url) => !url.includes("?"));
      for (const url of [...new Set(assets)]) {
        const response = await fetchPrecache(url, 15_000);
        if (!response.ok) throw new Error(`Required application asset ${url} returned HTTP ${response.status}`);
        await cache.put(url, response);
      }
      const optionalResults = await Promise.allSettled(OPTIONAL_SHELL_URLS.map(async (url) => {
        const response = await fetchPrecache(url, 8_000);
        if (!response.ok) throw new Error(`Optional PWA resource ${url} returned HTTP ${response.status}`);
        await cache.put(url, response);
      }));
      optionalResults.forEach((result, index) => {
        if (result.status === "rejected") console.warn("[Vivarqo SW] Optional precache failed:", OPTIONAL_SHELL_URLS[index], result.reason);
      });
      await worker.skipWaiting();
    } catch (error) {
      console.error("[Vivarqo SW] Required precache failed; installation aborted.", error);
      await caches.delete(CACHE_NAME);
      throw error;
    }
  })());
});
worker.addEventListener("activate", (rawEvent) => {
  const event = rawEvent as ExtendableLike;
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("vivarqo-shell-") && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await worker.clients.claim();
  })());
});
registerNotificationEventHandlers(worker);
worker.addEventListener("fetch", (rawEvent) => {
  const event = rawEvent as FetchLike;
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== worker.location.origin || url.pathname.startsWith("/api/") || url.pathname === "/api" || url.pathname.startsWith("/metrics")) return;
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put("/index.html", response.clone());
        }
        return response;
      } catch {
        return (await caches.match("/index.html")) ?? Response.error();
      }
    })());
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    })());
  }
});
