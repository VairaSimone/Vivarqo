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
const invalidationListeners = new Set<() => void>();
const TTL_MS = 12_000;
const MAX_ENTRIES = 100;
let generation = 0;

/** Remove one cached response so an explicit reload always reaches the server. */
export function invalidateResourceCacheEntry(key: string): void {
  cache.delete(key);
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
    // Refresh insertion order so the least recently used entry is evicted first.
    cache.delete(key);
    cache.set(key, cached);
    return Promise.resolve(cached.value as T);
  }
  if (cached) cache.delete(key);

  let entry = pending.get(key);
  // React Strict Effects can unsubscribe the last consumer and immediately
  // mount a replacement before the aborted loader's rejection microtask runs.
  // Never let that replacement subscribe to an already-aborted request.
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
      if (generation === requestGeneration) remember(key, value);
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
      consumerSignal.removeEventListener("abort", onAbort);
      activeEntry.subscribers.delete(subscriber);
      if (!activeEntry.settled && activeEntry.subscribers.size === 0) {
        // Remove it before aborting so a new consumer can immediately create
        // a fresh request instead of racing the old promise's finally handler.
        if (pending.get(key) === activeEntry) pending.delete(key);
        activeEntry.controller.abort();
      }
    };
    const onAbort = () => {
      unsubscribe();
      reject(abortError());
    };
    consumerSignal.addEventListener("abort", onAbort, { once: true });
    activeEntry.promise.then((value) => {
      if (consumerSignal.aborted) return;
      unsubscribe();
      resolve(value as T);
    }, (error: unknown) => {
      if (consumerSignal.aborted) return;
      unsubscribe();
      reject(error);
    });
  });
}

export function subscribeResourceInvalidation(listener: () => void): () => void {
  invalidationListeners.add(listener);
  return () => invalidationListeners.delete(listener);
}

/** Call after a successful mutation or when the authenticated account changes. */
export function invalidateAllResourceCache(): void {
  generation++;
  cache.clear();
  invalidationListeners.forEach((listener) => listener());
}
