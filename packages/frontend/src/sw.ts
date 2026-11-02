import { handleNotificationClick, handlePushEvent } from "./sw-notifications";

const CACHE_NAME = "vivarqo-shell-v2";
const SHELL_URLS = ["/", "/index.html", "/manifest.webmanifest", "/vivarqo-icon.svg", "/icons/icon-192.svg", "/icons/icon-512.svg"];

type ExtendableLike = { waitUntil(promise: Promise<unknown>): void };
type FetchLike = ExtendableLike & { request: Request; respondWith(response: Promise<Response> | Response): void };
type WorkerScopeLike = {
  addEventListener(type: string, callback: (event: any) => void): void;
  skipWaiting(): Promise<void>;
  registration: { showNotification(title: string, options: Record<string, unknown>): Promise<void> };
  clients: {
    claim(): Promise<void>;
    matchAll(options: { type: "window"; includeUncontrolled: boolean }): Promise<Array<{
      url: string;
      focused?: boolean;
      focus(): Promise<unknown>;
      navigate?(url: string): Promise<unknown>;
    }>>;
    openWindow(url: string): Promise<unknown>;
  };
  location: { origin: string };
};
const worker = self as unknown as WorkerScopeLike;

worker.addEventListener("install", (rawEvent) => {
  const event = rawEvent as ExtendableLike;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL_URLS);
    // Precache only the production HTML-referenced static bundle. Never cache API URLs or user data.
    const shell = await cache.match("/index.html");
    const html = await shell?.text();
    const assets = html
      ? [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map((match) => match[1]!)
      : [];
    if (assets.length) await cache.addAll([...new Set(assets)]);
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
worker.addEventListener("push", (event) => {
  handlePushEvent(event, worker.registration, worker.location.origin);
});
worker.addEventListener("notificationclick", (event) => {
  handleNotificationClick(event, worker.clients, worker.location.origin);
});
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
