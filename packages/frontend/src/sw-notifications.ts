export type PushPayload = {
  title: string;
  body: string;
  icon?: string;
  tag?: string;
  category?: string;
  notificationId?: string;
  targetPath: string;
};

const MAX_TITLE = 120;
const MAX_BODY = 240;
const FALLBACK_PATH = "/today";

function boundedText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== "string") return fallback;
  const normalized = Array.from(value, (character) => { const code = character.charCodeAt(0); return code < 32 || code === 127 ? " " : character; }).join("").trim();
  return normalized ? normalized.slice(0, maxLength) : fallback;
}

/**
 * Only accepts app-relative paths. Absolute URLs, protocol-relative URLs,
 * backslashes, control characters, encoded path separators and API paths are rejected.
 */
export function safeNotificationTarget(value: unknown, origin: string): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return FALLBACK_PATH;
  if (value.includes("\\") || Array.from(value).some((character) => { const code = character.charCodeAt(0); return code < 32 || code === 127; })) return FALLBACK_PATH;
  const rawPath = value.split(/[?#]/, 1)[0] ?? value;
  if (/%(?:2f|5c)/i.test(rawPath)) return FALLBACK_PATH;
  if (rawPath.split("/").some((segment) => {
    const normalized = segment.replace(/%2e/gi, ".");
    return normalized === "." || normalized === "..";
  })) return FALLBACK_PATH;

  let parsed: URL;
  try {
    parsed = new URL(value, origin);
  } catch {
    return FALLBACK_PATH;
  }

  if (parsed.origin !== origin || !["http:", "https:"].includes(parsed.protocol)) return FALLBACK_PATH;
  if (parsed.username || parsed.password || parsed.pathname.startsWith("/api/") || parsed.pathname === "/api") return FALLBACK_PATH;
  if (parsed.pathname.split("/").some((part) => part === "." || part === "..")) return FALLBACK_PATH;

  return parsed.pathname + parsed.search + parsed.hash;
}

export function parsePushPayload(raw: string | null, origin: string): PushPayload {
  let value: unknown;
  if (raw) {
    try {
      value = JSON.parse(raw);
    } catch {
      value = { body: raw };
    }
  }

  const payload = typeof value === "string"
    ? { body: value }
    : typeof value === "object" && value !== null
      ? value as Record<string, unknown>
      : {};
  const data = typeof payload.data === "object" && payload.data !== null
    ? payload.data as Record<string, unknown>
    : {};

  return {
    title: boundedText(payload.title, "Vivarqo", MAX_TITLE),
    body: boundedText(payload.body ?? payload.message, "Hai una nuova notifica.", MAX_BODY),
    icon: "/vivarqo-icon.svg",
    tag: boundedText(payload.tag ?? payload.notificationId ?? data.notificationId, "", 120) || undefined,
    category: boundedText(payload.category ?? data.category, "", 64) || undefined,
    notificationId: boundedText(payload.notificationId ?? data.notificationId, "", 120) || undefined,
    targetPath: safeNotificationTarget(payload.targetPath ?? payload.url ?? data.targetPath, origin)
  };
}

type PushEventLike = {
  data?: { text(): string } | null;
  waitUntil(promise: Promise<unknown>): void;
};
type NotificationEventLike = {
  notification: { data?: unknown; close(): void };
  waitUntil(promise: Promise<unknown>): void;
};
type WindowClientLike = {
  url: string;
  focused?: boolean;
  focus(): Promise<unknown>;
  navigate?(url: string): Promise<unknown>;
};
type ClientsLike = {
  matchAll(options: { type: "window"; includeUncontrolled: boolean }): Promise<WindowClientLike[]>;
  openWindow(url: string): Promise<unknown>;
};

export function handlePushEvent(
  event: PushEventLike,
  registration: { showNotification(title: string, options: Record<string, unknown>): Promise<void> },
  origin: string
): void {
  event.waitUntil((async () => {
    let raw: string | null = null;
    try { raw = event.data?.text() ?? null; } catch { /* malformed payload */ }
    const payload = parsePushPayload(raw, origin);
    await registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon,
      tag: payload.tag,
      renotify: false,
      dir: "auto",
      data: {
        targetPath: payload.targetPath,
        category: payload.category,
        notificationId: payload.notificationId
      }
    });
  })());
}

export function handleNotificationClick(
  event: NotificationEventLike,
  clients: ClientsLike,
  origin: string
): void {
  event.notification.close();
  event.waitUntil((async () => {
    const data = typeof event.notification.data === "object" && event.notification.data !== null
      ? event.notification.data as Record<string, unknown>
      : {};
    const target = safeNotificationTarget(data.targetPath, origin);
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    const sameOrigin = windows.filter((client) => {
      try { return new URL(client.url).origin === origin; } catch { return false; }
    });
    const existing = sameOrigin.find((client) => client.focused) ?? sameOrigin[0];

    if (existing) {
      if (existing.navigate) await existing.navigate(target);
      await existing.focus();
      return;
    }
    await clients.openWindow(target);
  })());
}
