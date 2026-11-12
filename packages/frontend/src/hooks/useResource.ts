import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, getApiLocale } from "../lib/api";
import { invalidateResourceCacheEntry, loadCachedResource, subscribeResourceInvalidation } from "../lib/resourceCache";

type ResourceState<T> = { data: T | null; loading: boolean; error: ApiError | null };
export function useResource<T>(url: string | null) {
  const [state, setState] = useState<ResourceState<T>>({ data: null, loading: Boolean(url), error: null });
  const [cacheVersion, setCacheVersion] = useState(0);
  const requestId = useRef(0);
  const cacheKey = url ? url + "|locale:" + getApiLocale() : null;

  const reload = useCallback(() => {
    if (cacheKey) invalidateResourceCacheEntry(cacheKey);
  }, [cacheKey]);

  useEffect(() => subscribeResourceInvalidation((invalidatedKey) => {
    if (invalidatedKey === undefined || invalidatedKey === cacheKey) {
      setCacheVersion((value) => value + 1);
    }
  }), [cacheKey]);

  useEffect(() => {
    const current = ++requestId.current;
    if (!url || !cacheKey) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    setState((previous) => ({ ...previous, loading: true, error: null }));
    const controller = new AbortController();
    loadCachedResource<T>(cacheKey, (signal) => api.get<T>(url, { signal }), controller.signal).then((data) => {
      if (requestId.current === current) setState({ data, loading: false, error: null });
    }).catch((reason: unknown) => {
      if (controller.signal.aborted || requestId.current !== current || (reason instanceof Error && reason.name === "AbortError")) return;
      const error = reason instanceof ApiError ? reason : new ApiError(0, reason instanceof Error ? reason.message : "Network request failed", "NETWORK_ERROR");
      setState((previous) => ({ ...previous, loading: false, error }));
    });
    return () => {
      controller.abort();
      if (requestId.current === current) requestId.current++;
    };
  }, [url, cacheKey, cacheVersion]);

  return { ...state, reload };
}
