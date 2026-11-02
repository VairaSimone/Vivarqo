import { describe, expect, it, vi } from "vitest";
import { invalidateAllResourceCache, loadCachedResource } from "./resourceCache";

describe("resource cache", () => {
  it("deduplicates concurrent requests and reuses the short-lived result", async () => {
    let calls = 0;
    let finish: ((value: { id: number }) => void) | undefined;
    const loader = () => {
      calls++;
      return new Promise<{ id: number }>((resolve) => { finish = resolve; });
    };
    const first = loadCachedResource("animals|it", loader, new AbortController().signal);
    const second = loadCachedResource("animals|it", loader, new AbortController().signal);
    expect(calls).toBe(1);
    finish?.({ id: 7 });
    await expect(Promise.all([first, second])).resolves.toEqual([{ id: 7 }, { id: 7 }]);
    const cached = await loadCachedResource("animals|it", async () => ({ id: 8 }), new AbortController().signal);
    expect(cached).toEqual({ id: 7 });
    expect(calls).toBe(1);
  });

  it("invalidates cached data after a mutation", async () => {
    let calls = 0;
    const loader = async () => ({ version: ++calls });
    await expect(loadCachedResource("tasks|it", loader, new AbortController().signal)).resolves.toEqual({ version: 1 });
    invalidateAllResourceCache();
    await expect(loadCachedResource("tasks|it", loader, new AbortController().signal)).resolves.toEqual({ version: 2 });
  });

  it("aborts the shared request after the last consumer leaves", async () => {
    let sharedSignal: AbortSignal | undefined;
    const consumer = new AbortController();
    const promise = loadCachedResource("slow|it", (signal) => {
      sharedSignal = signal;
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    }, consumer.signal);
    consumer.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(sharedSignal?.aborted).toBe(true);
  });

  it("starts a fresh request when a consumer remounts before an aborted request settles", async () => {
    const firstConsumer = new AbortController();
    let firstSignal: AbortSignal | undefined;
    let secondCalls = 0;

    const first = loadCachedResource("strict-effects|it", (signal) => {
      firstSignal = signal;
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    }, firstConsumer.signal);

    // Simulate React Strict Effects: cleanup aborts the only consumer, then
    // the replacement effect subscribes synchronously before promise cleanup.
    firstConsumer.abort();
    expect(firstSignal?.aborted).toBe(true);

    const second = loadCachedResource("strict-effects|it", async (signal) => {
      secondCalls++;
      expect(signal.aborted).toBe(false);
      return "fresh response";
    }, new AbortController().signal);

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).resolves.toBe("fresh response");
    expect(secondCalls).toBe(1);
  });

  it("expires cached values after the TTL", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const loader = async () => ++calls;
    await loadCachedResource("expires|it", loader, new AbortController().signal);
    vi.advanceTimersByTime(12_001);
    await expect(loadCachedResource("expires|it", loader, new AbortController().signal)).resolves.toBe(2);
    vi.useRealTimers();
  });
});
