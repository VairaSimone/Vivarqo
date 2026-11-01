import { useCallback, useEffect, useMemo, useState } from "react";
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

/** Owns section data fetching, server-side filters, loading and error states. */
export function useAppData({
  user, active, query, listPages, inventoryFilters, onUnauthorized
}: AppDataOptions): AppDataState {
  const [data, setData] = useState<AnyRecord | null>(null);
  const [busy, setBusy] = useState(false);

  const loadData = useCallback(async (section: string = active) => {
    setData(null);
    if ([
      "guide-sito", "guide-pwa", "altro", "riproduzioni", "documenti", "notifiche",
      "alimentazioni", "genetica", "cure", "peso", "mute", "note", "animali",
      "attivita", "abbonamento"
    ].includes(section)) {
      setData({});
      return;
    }

    const basePath = API[section];
    if (!basePath) {
      setData({});
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
    setBusy(true);
    try {
      const result = await apiRequest(path);
      setData(result);
    } catch (error) {
      if (typeof error === "object" && error !== null && "status" in error && error.status === 401) {
        onUnauthorized();
      }
      setData({ __error: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }, [active, listPages, inventoryFilters, query, onUnauthorized]);

  useEffect(() => {
    if (!user) return;
    const timer = window.setTimeout(() => void loadData(active), query.trim() ? 280 : 0);
    return () => window.clearTimeout(timer);
  }, [user, active, loadData, query]);

  const rows = useMemo(() => {
    if (Array.isArray(data)) return data as AnyRecord[];
    if (!data || typeof data !== "object") return [];
    return Object.values(data).find(Array.isArray) as AnyRecord[] ?? [];
  }, [data]);

  const clearData = useCallback(() => setData(null), []);
  return { data, busy, rows, loadData, clearData };
}
