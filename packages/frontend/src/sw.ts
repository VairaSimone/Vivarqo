const CACHE_NAME = "vivarqo-shell-v1";
const SHELL_URLS = ["/", "/index.html", "/manifest.webmanifest"];

type ExtendableLike = { waitUntil(promise: Promise<unknown>): void };
type FetchLike = ExtendableLike & { request: Request; respondWith(response: Promise<Response> | Response): void };
type WorkerScopeLike = {
  addEventListener(type: string, callback: (event: any) => void): void;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  location: { origin: string };
};
const worker = self as unknown as WorkerScopeLike;

worker.addEventListener("install", (rawEvent) => {
  const event = rawEvent as ExtendableLike;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL_URLS);
    await worker.skipWaiting();
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
worker.addEventListener("fetch", (rawEvent) => {
  const event = rawEvent as FetchLike;
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== worker.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/metrics")) return;

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
