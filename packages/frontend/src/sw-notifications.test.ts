import { describe, expect, it, vi } from "vitest";
import { handleNotificationClick, handlePushEvent, parsePushPayload, registerNotificationEventHandlers, safeNotificationTarget } from "./sw-notifications";

const origin = "https://app.vivarqo.test";

describe("Web Push payload handling", () => {
  it("decodes backend JSON fields and preserves only safe navigation metadata", () => {
    const payload = parsePushPayload(JSON.stringify({
      title: "Promemoria",
      body: "Controlla l'alimentazione",
      category: "feeding",
      notificationId: "notice-123",
      url: "/feeding?page=2"
    }), origin);
    expect(payload).toMatchObject({
      title: "Promemoria",
      body: "Controlla l'alimentazione",
      category: "feeding",
      notificationId: "notice-123",
      targetPath: "/feeding?page=2"
    });
  });

  it("handles absent, invalid JSON and plain-text payloads safely", () => {
    expect(parsePushPayload(null, origin)).toMatchObject({ title: "Vivarqo", body: "Hai una nuova notifica.", targetPath: "/today" });
    expect(parsePushPayload("{broken", origin)).toMatchObject({ title: "Vivarqo", body: "{broken", targetPath: "/today" });
    expect(parsePushPayload("Messaggio di prova", origin).body).toBe("Messaggio di prova");
    expect(parsePushPayload(JSON.stringify("Testo serializzato"), origin).body).toBe("Testo serializzato");
  });

  it.each([
    "https://evil.example/steal",
    "//evil.example/path",
    "javascript:alert(1)",
    "/\\\\evil.example/path",
    "/%2f%2fevil.example/path",
    "/api/v1/account",
    "/safe/../private",
    "/%2e%2e/private"
  ])("rejects unsafe notification destination %s", (target) => {
    expect(safeNotificationTarget(target, origin)).toBe("/today");
  });

  it("accepts internal paths and query strings", () => {
    expect(safeNotificationTarget("/animals/abc?tab=care", origin)).toBe("/animals/abc?tab=care");
  });

  it("shows a notification with bounded fields and safe data", async () => {
    let complete: Promise<unknown> | undefined;
    const showNotification = vi.fn().mockResolvedValue(undefined);
    handlePushEvent({
      data: { text: () => JSON.stringify({ title: "New", body: "Details", targetPath: "https://evil.example" }) },
      waitUntil: (promise) => { complete = promise; }
    }, { showNotification }, origin);
    await complete;
    expect(showNotification).toHaveBeenCalledWith("New", expect.objectContaining({
      body: "Details",
      data: expect.objectContaining({ targetPath: "/today" })
    }));
  });

  it("focuses and navigates an existing same-origin window instead of opening a duplicate", async () => {
    let complete: Promise<unknown> | undefined;
    const focus = vi.fn().mockResolvedValue({});
    const navigate = vi.fn().mockResolvedValue({});
    const openWindow = vi.fn();
    const client = { url: origin + "/today", focused: true, focus, navigate };
    const close = vi.fn();
    handleNotificationClick({
      notification: { data: { targetPath: "/animals" }, close },
      waitUntil: (promise) => { complete = promise; }
    }, { matchAll: async () => [client], openWindow }, origin);
    await complete;
    expect(close).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/animals");
    expect(focus).toHaveBeenCalledOnce();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("opens a new same-origin window when no app window exists", async () => {
    let complete: Promise<unknown> | undefined;
    const openWindow = vi.fn().mockResolvedValue({});
    handleNotificationClick({
      notification: { data: { targetPath: "javascript:alert(1)" }, close: vi.fn() },
      waitUntil: (promise) => { complete = promise; }
    }, { matchAll: async () => [], openWindow }, origin);
    await complete;
    expect(openWindow).toHaveBeenCalledWith("/today");
  });

  it("registers and dispatches the actual service-worker push and click events", async () => {
    const handlers = new Map<string, (event: any) => void>();
    const showNotification = vi.fn().mockResolvedValue(undefined);
    const focus = vi.fn().mockResolvedValue({});
    const navigate = vi.fn().mockResolvedValue({});
    const openWindow = vi.fn();
    const client = { url: origin + "/today", focused: true, focus, navigate };
    const scope = {
      addEventListener: (type: string, callback: (event: any) => void) => { handlers.set(type, callback); },
      registration: { showNotification },
      clients: { matchAll: async () => [client], openWindow },
      location: { origin }
    };

    registerNotificationEventHandlers(scope);
    expect(handlers.has("push")).toBe(true);
    expect(handlers.has("notificationclick")).toBe(true);

    let pushCompletion: Promise<unknown> | undefined;
    handlers.get("push")?.({
      data: { text: () => JSON.stringify({ title: "Vivarqo", body: "Reminder", url: "/tasks/123" }) },
      waitUntil: (promise: Promise<unknown>) => { pushCompletion = promise; }
    });
    await pushCompletion;
    expect(showNotification).toHaveBeenCalledWith("Vivarqo", expect.objectContaining({
      body: "Reminder",
      data: expect.objectContaining({ targetPath: "/tasks/123" })
    }));

    let clickCompletion: Promise<unknown> | undefined;
    const close = vi.fn();
    handlers.get("notificationclick")?.({
      notification: { data: { targetPath: "/tasks/123" }, close },
      waitUntil: (promise: Promise<unknown>) => { clickCompletion = promise; }
    });
    await clickCompletion;
    expect(close).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/tasks/123");
    expect(focus).toHaveBeenCalledOnce();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("ignores existing windows from another origin", async () => {
    let complete: Promise<unknown> | undefined;
    const focus = vi.fn();
    const openWindow = vi.fn().mockResolvedValue({});
    handleNotificationClick({
      notification: { data: { targetPath: "/calendar" }, close: vi.fn() },
      waitUntil: (promise) => { complete = promise; }
    }, { matchAll: async () => [{ url: "https://evil.example", focus }], openWindow }, origin);
    await complete;
    expect(focus).not.toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledWith("/calendar");
  });
});
