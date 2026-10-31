/* Public static-shell cache only. Never intercept or store API responses, authenticated documents or account data. */
const CACHE = "vivarqo-static-v2";
const STATIC = ["/", "/manifest.webmanifest", "/pwa-icon.svg"];
const STATIC_DESTINATIONS = new Set(["script", "style", "image", "font"]);
self.addEventListener("install", event => {
  // Keep the previous worker active until the user accepts an available update.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC)));
});
self.addEventListener("message", event => {
  if (event.origin !== self.location.origin) return;
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("vivarqo-static-") && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/readyz" || url.pathname === "/healthz") return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match("/")) || new Response(
        "<!doctype html><html lang=\"it\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Vivarqo offline</title><body><main><h1>Vivarqo non è raggiungibile</h1><p>Riconnettiti a Internet per caricare il sito e sincronizzare le modifiche locali.</p></main></body></html>",
        { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
      );
    }));
    return;
  }
  const explicitStatic = url.pathname === "/manifest.webmanifest" || url.pathname === "/pwa-icon.svg";
  if (!STATIC_DESTINATIONS.has(request.destination) && !explicitStatic) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(request);
    if (cached) {
      event.waitUntil(fetch(request).then(response => {
        if (response.ok && response.type === "basic") return cache.put(request, response.clone());
      }).catch(() => undefined));
      return cached;
    }
    const response = await fetch(request);
    if (response.ok && response.type === "basic") await cache.put(request, response.clone());
    return response;
  }));
});

/* Show server-sent Web Push messages while the app is closed or in the background. */
self.addEventListener("push", event => {
  event.waitUntil((async () => {
    let payload = {};
    try {
      payload = event.data ? event.data.json() : {};
    } catch {
      payload = { body: event.data ? event.data.text().slice(0, 1000) : "" };
    }

    const title = typeof payload.title === "string" && payload.title.trim()
      ? payload.title.slice(0, 160)
      : "Vivarqo";
    const body = typeof payload.body === "string" ? payload.body.slice(0, 1000) : "";
    const requestedUrl = typeof payload.url === "string" ? payload.url : "/";
    const safeUrl = requestedUrl.startsWith("/") && !requestedUrl.startsWith("//")
      ? requestedUrl
      : "/";
    const category = typeof payload.category === "string" ? payload.category.slice(0, 30) : "general";

    await self.registration.showNotification(title, {
      body,
      icon: "/pwa-icon.svg",
      badge: "/pwa-icon.svg",
      tag: "vivarqo-" + category,
      data: { url: safeUrl },
      renotify: false
    });
  })());
});

/* Open only same-origin relative paths from validated push payloads. */
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const requestedUrl = event.notification?.data?.url;
  const safeUrl = typeof requestedUrl === "string" && requestedUrl.startsWith("/") && !requestedUrl.startsWith("//")
    ? requestedUrl
    : "/";
  const target = new URL(safeUrl, self.location.origin);

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      if ("navigate" in client) await client.navigate(target.href);
      await client.focus();
      return;
    }
    if (self.clients.openWindow) await self.clients.openWindow(target.href);
  })());
});
