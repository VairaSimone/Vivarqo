import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { getArray, getString, queryString } from "../lib/domain";
import type { Locale } from "../lib/domain";
import { Button, Icon, Input } from "./ui";

type Item = Record<string, unknown>;
type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  endpoint: string;
  responseKey: string;
  labelKey?: string;
  secondaryKey?: string;
  detailEndpoint?: (id: string) => string;
  detailKey?: string;
  filters?: Record<string, string | number | boolean>;
  locale: Locale;
  emptyLabel?: string;
  disabled?: boolean;
};

/** A page-sized, searchable select backed by an authenticated API endpoint. */
export function RemoteSelect({
  label, value, onChange, endpoint, responseKey, labelKey = "name", secondaryKey,
  detailEndpoint, detailKey, filters, locale, emptyLabel = "—", disabled = false
}: Props) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [options, setOptions] = useState<Item[]>([]);
  const [selectedOption, setSelectedOption] = useState<Item | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const filtersKey = JSON.stringify(filters ?? {});

  useEffect(() => {
    const current = ++requestId.current;
    const controller = new AbortController();
    const filterValues = JSON.parse(filtersKey) as Record<string, string | number | boolean>;
    const url = endpoint + queryString({ ...filterValues, q: search.trim() || null, page, pageSize: 25 });
    setLoading(true);
    setError("");
    api.get<Record<string, unknown>>(url, { signal: controller.signal }).then((payload) => {
      if (requestId.current !== current) return;
      const rows = getArray<Item>(payload, responseKey);
      setOptions((previous) => page === 1 ? rows : [
        ...previous.filter((item) => !rows.some((row) => getString(row, "id") === getString(item, "id"))),
        ...rows
      ]);
      const pagination = payload.pagination && typeof payload.pagination === "object"
        ? payload.pagination as Record<string, unknown> : {};
      const pages = Number(pagination.totalPages);
      setTotalPages(Number.isFinite(pages) && pages > 0 ? pages : 1);
    }).catch((reason: unknown) => {
      if (controller.signal.aborted || requestId.current !== current) return;
      setError(reason instanceof Error ? reason.message : (locale === "it" ? "Impossibile caricare i risultati." : "Could not load results."));
    }).finally(() => {
      if (requestId.current === current && !controller.signal.aborted) setLoading(false);
    });
    return () => {
      controller.abort();
      if (requestId.current === current) requestId.current++;
    };
  }, [endpoint, responseKey, filtersKey, search, page, locale]);

  useEffect(() => {
    if (!value || options.some((item) => getString(item, "id") === value)
      || (selectedOption && getString(selectedOption, "id") === value) || !detailEndpoint) return;
    const controller = new AbortController();
    const current = ++requestId.current;
    api.get<Record<string, unknown>>(detailEndpoint(value), { signal: controller.signal }).then((payload) => {
      if (requestId.current !== current) return;
      const candidate = detailKey ? payload[detailKey] : payload;
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) setSelectedOption(candidate as Item);
    }).catch(() => { /* Keep the selected ID if its display record cannot be fetched. */ });
    return () => controller.abort();
  }, [value, options, selectedOption, detailEndpoint, detailKey]);

  const current = options.find((item) => getString(item, "id") === value)
    ?? (selectedOption && getString(selectedOption, "id") === value ? selectedOption : null);
  const selectedLabel = current ? getString(current, labelKey) : value;
  const optionLabel = (item: Item) => {
    const primary = getString(item, labelKey) || getString(item, "id");
    const secondary = secondaryKey ? getString(item, secondaryKey) : "";
    return secondary ? primary + " · " + secondary : primary;
  };

  return <div className="field remote-select">
    <span className="field-label">{label}</span>
    <label className="search-control">
      <Icon name="search" size={14} />
      <Input type="search" aria-label={(locale === "it" ? "Cerca " : "Search ") + label.toLocaleLowerCase()}
        value={search} placeholder={locale === "it" ? "Cerca per nome…" : "Search by name…"}
        onChange={(event) => { setSearch(event.target.value); setPage(1); }} disabled={disabled} />
    </label>
    <select className="control" aria-label={label} value={value} disabled={disabled} onChange={(event) => {
      const next = event.target.value;
      setSelectedOption(options.find((item) => getString(item, "id") === next) ?? null);
      onChange(next);
    }}>
      <option value="">{emptyLabel}</option>
      {value && !options.some((item) => getString(item, "id") === value) && <option value={value}>{selectedLabel || value}</option>}
      {options.map((item) => <option key={getString(item, "id")} value={getString(item, "id")}>{optionLabel(item)}</option>)}
    </select>
    {error && <span className="field-error" role="alert">{error}</span>}
    {totalPages > page && <Button type="button" size="sm" variant="ghost" disabled={loading} onClick={() => setPage((currentPage) => currentPage + 1)}>
      {loading ? (locale === "it" ? "Caricamento…" : "Loading…") : (locale === "it" ? "Carica altri risultati" : "Load more results")}
    </Button>}
  </div>;
}
