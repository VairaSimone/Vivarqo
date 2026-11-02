import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";

type ResourceState<T> = { data: T | null; loading: boolean; error: ApiError | null };
export function useResource<T>(url: string | null) {
  const [state, setState] = useState<ResourceState<T>>({ data: null, loading: Boolean(url), error: null });
  const [revision, setRevision] = useState(0);
  const requestId = useRef(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    const current = ++requestId.current;
    if (!url) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    setState((previous) => ({ ...previous, loading: true, error: null }));
    const controller = new AbortController();
    api.get<T>(url, { signal: controller.signal }).then((data) => {
      if (requestId.current === current) setState({ data, loading: false, error: null });
    }).catch((reason: unknown) => {
      if (controller.signal.aborted || requestId.current !== current) return;
      const error = reason instanceof ApiError ? reason : new ApiError(0, reason instanceof Error ? reason.message : "Network request failed", "NETWORK_ERROR");
      setState((previous) => ({ ...previous, loading: false, error }));
    });
    return () => {
      controller.abort();
      if (requestId.current === current) requestId.current++;
    };
  }, [url, revision]);

  return { ...state, reload };
}
