import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "../api/api";
import type { AccountUser, AnyRecord, InventoryFiltersState } from "../types";
import { errorMessage } from "../types";
import { API } from "./navigation";

export interface AppDataOptions {
  user: AccountUser | null;
  active: string;
  query: string;
  listPages: Record<string, number>;
  inventoryFilters: InventoryFiltersState;
  onUnauthorized: () => void;
}

export interface AppDataState {
  data: AnyRecord | null;
  busy: boolean;
  rows: AnyRecord[];
  loadData: (section?: string) => Promise<void>;
  clearData: () => void;
}

interface ScopedData {
  owner: string | null;
  section: string | null;
  value: AnyRecord | null;
}

interface ScopedBusy {
  owner: string;
  section: string;
}

const CLIENT_ONLY_SECTIONS = new Set([
  "guide-sito", "guide-pwa", "altro", "riproduzioni", "documenti", "notifiche",
  "alimentazioni", "genetica", "cure", "peso", "mute", "note", "animali",
  "attivita", "abbonamento", "dati", "impostazioni"
]);

function accountKey(user: AccountUser | null): string | null {
  if (!user) return null;
  if (user.id) return "id:" + user.id;
  if (user.email) return "email:" + user.email.trim().toLowerCase();
  return "authenticated:unknown";
}

/** Owns section data fetching, server-side filters, loading and error states. */
export function useAppData({
  user, active, query, listPages, inventoryFilters, onUnauthorized
}: AppDataOptions): AppDataState {
  const userKey = accountKey(user);
  const userKeyRef = useRef<string | null>(userKey);
  // Keep the current account visible to in-flight continuations before effects run.
  userKeyRef.current = userKey;

  const requestIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const [dataState, setDataState] = useState<ScopedData>({
    owner: null,
    section: null,
    value: null
  });
  const [busyState, setBusyState] = useState<ScopedBusy | null>(null);

  const cancelPendingRequest = useCallback(() => {
    requestIdRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const loadData = useCallback(async (section: string = active) => {
    // Ignore callbacks retained by a component from a previous account session.
    if (!userKey || userKeyRef.current !== userKey) return;

    const requestId = ++requestIdRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    const isCurrentRequest = () =>
      requestIdRef.current === requestId &&
      userKeyRef.current === userKey &&
      !controller.signal.aborted;

    setDataState({ owner: userKey, section, value: null });
    setBusyState(null);

    if (CLIENT_ONLY_SECTIONS.has(section)) {
      setDataState({ owner: userKey, section, value: {} });
      if (controllerRef.current === controller) controllerRef.current = null;
      return;
    }

    const basePath = API[section];
    if (!basePath) {
      setDataState({ owner: userKey, section, value: {} });
      if (controllerRef.current === controller) controllerRef.current = null;
      return;
    }

    const page = listPages[section] || 1;
    const [pathname, queryString = ""] = basePath.split("?");
    const params = new URLSearchParams(queryString);
    if (params.has("page")) params.set("page", String(page));

    if (section === "inventario") {
      params.set("active", inventoryFilters.active);
      if (inventoryFilters.category) params.set("category", inventoryFilters.category);
      else params.delete("category");
      if (inventoryFilters.lowStock) params.set("lowStock", "true");
      else params.delete("lowStock");
    }

    if (query.trim() && ["inventario", "finanze", "alimentazioni", "attivita"].includes(section)) {
      params.set("q", query.trim());
    } else {
      params.delete("q");
    }

    const path = pathname + (params.size ? "?" + params.toString() : "");
    setBusyState({ owner: userKey, section });

    try {
      const result = await apiRequest(path, { signal: controller.signal });
      if (!isCurrentRequest()) return;
      setDataState({ owner: userKey, section, value: result });
    } catch (error) {
      // An aborted or superseded request is expected and must never replace newer data.
      if (!isCurrentRequest()) return;
      if (typeof error === "object" && error !== null && "status" in error && error.status === 401) {
        onUnauthorized();
      }
      setDataState({ owner: userKey, section, value: { __error: errorMessage(error) } });
    } finally {
      if (isCurrentRequest()) {
        setBusyState(null);
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    }
  }, [active, inventoryFilters, listPages, onUnauthorized, query, userKey]);

  useEffect(() => {
    if (!userKey) {
      cancelPendingRequest();
      setDataState({ owner: null, section: null, value: null });
      setBusyState(null);
      return undefined;
    }

    const timer = window.setTimeout(() => void loadData(active), query.trim() ? 280 : 0);
    return () => {
      window.clearTimeout(timer);
      cancelPendingRequest();
    };
  }, [active, cancelPendingRequest, loadData, query, userKey]);

  const data = dataState.owner === userKey && dataState.section === active
    ? dataState.value
    : null;
  const busy = Boolean(userKey && busyState?.owner === userKey && busyState.section === active);

  const rows = useMemo(() => {
    if (Array.isArray(data)) return data as AnyRecord[];
    if (!data || typeof data !== "object") return [];
    return Object.values(data).find(Array.isArray) as AnyRecord[] ?? [];
  }, [data]);

  const clearData = useCallback(() => {
    cancelPendingRequest();
    setDataState({ owner: userKeyRef.current, section: null, value: null });
    setBusyState(null);
  }, [cancelPendingRequest]);

  return { data, busy, rows, loadData, clearData };
}
