import { useCallback, useState } from "react";
import type { QuickEntryKind } from "../components/QuickEntryDialog";
import type { AnyRecord, InventoryFiltersState } from "../types";
import type { ModalForm } from "./AppModals";

/** Keeps page-local transient state out of the root composition component. */
export function useAppViewState() {
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<ModalForm | null>(null);
  const [listPages, setListPages] = useState<Record<string, number>>({});
  const [historyItem, setHistoryItem] = useState<AnyRecord | null>(null);
  const [inventoryFilters, setInventoryFilters] = useState<InventoryFiltersState>({
    active: "true",
    category: "",
    lowStock: false
  });
  const [financeRefreshKey, setFinanceRefreshKey] = useState(0);
  const [quickEntryKind, setQuickEntryKind] = useState<QuickEntryKind | null>(null);
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0);

  const resetNavigationState = useCallback(() => {
    setQuery("");
    setModal(null);
    setHistoryItem(null);
  }, []);

  return {
    query, setQuery,
    modal, setModal,
    listPages, setListPages,
    historyItem, setHistoryItem,
    inventoryFilters, setInventoryFilters,
    financeRefreshKey, setFinanceRefreshKey,
    quickEntryKind, setQuickEntryKind,
    dashboardRefreshKey, setDashboardRefreshKey,
    resetNavigationState
  };
}
