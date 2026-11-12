type CacheEntry = { value: unknown; expiresAt: number };
type PendingEntry = {
  controller: AbortController;
  promise: Promise<unknown>;
  subscribers: Set<symbol>;
  settled: boolean;
  generation: number;
};

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, PendingEntry>();
const invalidationListeners = new Set<(key?: string) => void>();
const TTL_MS = 12_000;
const MAX_ENTRIES = 100;
let generation = 0;

/** Invalidate both the cached value and any in-flight request for this key. */
export function invalidateResourceCacheEntry(key: string): void {
  cache.delete(key);
  const active = pending.get(key);
  if (active) {
    // Detach before aborting so the next consumer cannot attach to this request.
    pending.delete(key);
    active.controller.abort();
  }
  invalidationListeners.forEach((listener) => listener(key));
}

function remember(key: string, value: unknown): void {
  if (cache.size >= MAX_ENTRIES && !cache.has(key)) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest) cache.delete(oldest);
  }
  cache.delete(key);
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
}

function abortError(): DOMException {
  return new DOMException("The resource request was aborted", "AbortError");
}

/**
 * Short-lived in-memory GET cache with in-flight de-duplication.
 * Each consumer has its own AbortSignal; the shared network request is aborted
 * only after every consumer has unsubscribed.
 */
export function loadCachedResource<T>(
  key: string,
  loader: (signal: AbortSignal) => Promise<T>,
  consumerSignal: AbortSignal
): Promise<T> {
  if (consumerSignal.aborted) return Promise.reject(abortError());

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    cache.delete(key);
    cache.set(key, cached);
    return Promise.resolve(cached.value as T);
  }
  if (cached) cache.delete(key);

  let entry = pending.get(key);
  if (entry && (entry.controller.signal.aborted || entry.settled)) {
    if (pending.get(key) === entry) pending.delete(key);
    entry = undefined;
  }
  if (!entry) {
    const controller = new AbortController();
    const requestGeneration = generation;
    const created: PendingEntry = {
      controller,
      promise: Promise.resolve(undefined),
      subscribers: new Set(),
      settled: false,
      generation: requestGeneration
    };
    created.promise = loader(controller.signal).then((value) => {
      // An invalidated request must neither repopulate the cache nor resolve
      // with stale data, even if its loader ignores AbortSignal.
      if (
        controller.signal.aborted ||
        generation !== requestGeneration ||
        pending.get(key) !== created
      ) throw abortError();
      remember(key, value);
      return value;
    }).finally(() => {
      created.settled = true;
      if (pending.get(key) === created) pending.delete(key);
    });
    entry = created;
    pending.set(key, entry);
  }

  const activeEntry = entry;
  const subscriber = Symbol(key);
  activeEntry.subscribers.add(subscriber);

  return new Promise<T>((resolve, reject) => {
    let complete = false;
    const unsubscribe = () => {
      if (complete) return;
      complete = true;
      consumerSignal.removeEventListener("abort", onConsumerAbort);
      activeEntry.controller.signal.removeEventListener("abort", onSharedAbort);
      activeEntry.subscribers.delete(subscriber);
      if (!activeEntry.settled && activeEntry.subscribers.size === 0) {
        if (pending.get(key) === activeEntry) pending.delete(key);
        activeEntry.controller.abort();
      }
    };
    const onConsumerAbort = () => {
      unsubscribe();
      reject(abortError());
    };
    const onSharedAbort = () => {
      unsubscribe();
      reject(abortError());
    };
    consumerSignal.addEventListener("abort", onConsumerAbort, { once: true });
    activeEntry.controller.signal.addEventListener("abort", onSharedAbort, { once: true });
    if (consumerSignal.aborted || activeEntry.controller.signal.aborted) {
      onConsumerAbort();
      return;
    }
    activeEntry.promise.then((value) => {
      if (consumerSignal.aborted || activeEntry.controller.signal.aborted) return;
      unsubscribe();
      resolve(value as T);
    }, (error: unknown) => {
      if (consumerSignal.aborted || activeEntry.controller.signal.aborted) return;
      unsubscribe();
      reject(error);
    });
  });
}

export function subscribeResourceInvalidation(listener: (key?: string) => void): () => void {
  invalidationListeners.add(listener);
  return () => invalidationListeners.delete(listener);
}

/** Call after a successful mutation or when the authenticated account changes. */
export function invalidateAllResourceCache(): void {
  generation++;
  cache.clear();
  const activeEntries = [...pending.values()];
  pending.clear();
  for (const entry of activeEntries) entry.controller.abort();
  invalidationListeners.forEach((listener) => listener());
}
