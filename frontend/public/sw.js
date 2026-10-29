/* Cache only same-origin static assets. Never cache API responses or navigation HTML containing account data. */
const CACHE = "vivarqo-static-v1";
const STATIC = ["/", "/manifest.webmanifest", "/pwa-icon.svg"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("vivarqo-static-") && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname === "/readyz" || url.pathname === "/healthz") return;
  if (request.destination === "script" || request.destination === "style" || request.destination === "image" || request.destination === "font" || url.pathname === "/manifest.webmanifest" || url.pathname === "/pwa-icon.svg") {
    event.respondWith(caches.open(CACHE).then(async cache => {
      const cached = await cache.match(request);
      const network = fetch(request).then(response => { if (response.ok) cache.put(request, response.clone()); return response; });
      return cached || network;
    }));
  }
});
