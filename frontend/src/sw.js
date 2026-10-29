import { clientsClaim } from "workbox-core";
import { createHandlerBoundToURL, cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
clientsClaim();

// Navigate to the precached shell for client-side routes while offline.
// Authenticated APIs, health endpoints, and all non-navigation requests are excluded.
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html"), {
  denylist: [/^\/api\//, /^\/(?:healthz|readyz)$/],
}));

// Activation is explicit: the current worker stays active until the user accepts
// an update in the application UI.
self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

// Display push messages without persisting authenticated responses in Cache Storage.
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

// Open only same-origin relative paths from validated push payloads.
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
