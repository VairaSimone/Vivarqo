import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AnyRecord, NoticeHandler } from "./types";
import { apiRequest } from "./api/api";
import { errorMessage } from "./types";

const money = (cents: number | string | null | undefined, currency = "EUR") => {
  const amount = Number(cents);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(amount / 100);
};
const initialFilters = { from: "", to: "" };

export function FinanceSummary({ onNotice = () => {}, refreshKey = 0 }: { onNotice?: NoticeHandler; refreshKey?: number }) {
  const [filters, setFilters] = useState(initialFilters);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const [summary, setSummary] = useState<AnyRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (nextFilters = initialFilters) => {
    if (nextFilters.from && nextFilters.to && nextFilters.to < nextFilters.from) {
      setError("La data finale non può precedere quella iniziale.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (nextFilters.from) params.set("from", nextFilters.from);
      if (nextFilters.to) params.set("to", nextFilters.to);
      params.set("currency", "EUR");
      setSummary(await apiRequest("finance/summary?" + params.toString()));
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      onNotice(message, "error");
    } finally { setBusy(false); }
  }, [onNotice]);

  useEffect(() => { void load(filtersRef.current); }, [load, refreshKey]);
  const updateFilter = (name: keyof typeof initialFilters, value: string) => setFilters(previous => ({ ...previous, [name]: value }));

  return <div className="advanced-stack">
    <section className="panel">
      <div className="panel-heading">
        <div><p className="eyebrow">RIEPILOGO ECONOMICO</p><h2>Entrate, uscite e saldo</h2><p className="subheading">Totali calcolati dal backend sulle voci del registro economico.</p></div>
        <button className="button secondary" type="button" onClick={() => void load(filters)} disabled={busy}>↻ Aggiorna</button>
      </div>
      <form className="form-grid" onSubmit={event => { event.preventDefault(); void load(filters); }}>
        <label className="field"><span>Dal</span><input type="date" value={filters.from} onChange={event => updateFilter("from", event.target.value)}/></label>
        <label className="field"><span>Al</span><input type="date" value={filters.to} onChange={event => updateFilter("to", event.target.value)}/></label>
        <div className="form-full inline-actions"><button className="button" type="submit" disabled={busy}>Applica periodo</button><button className="button secondary" type="button" onClick={() => { setFilters(initialFilters); void load(initialFilters); }} disabled={busy}>Tutto il periodo</button></div>
      </form>
      {error && <p className="form-message" role="alert">{error}</p>}
      {busy && !summary ? <p className="loading">Caricamento riepilogo…</p> : summary && <>
        <div className="stats-grid">
          <article className="stat-card tone-0"><span>Entrate</span><strong>{money(summary.incomeCents, summary.currency)}</strong></article>
          <article className="stat-card tone-1"><span>Uscite</span><strong>{money(summary.expenseCents, summary.currency)}</strong></article>
          <article className="stat-card tone-2"><span>Saldo</span><strong>{money(summary.balanceCents, summary.currency)}</strong></article>
        </div>
        <p className="muted">{summary.from || summary.to ? "Periodo: " + (summary.from || "inizio") + " – " + (summary.to || "fine") : "Periodo: tutte le registrazioni disponibili"}{busy ? " · Aggiornamento in corso…" : ""}</p>
        <h3>Dettaglio per categoria</h3>
        {Array.isArray(summary.categories) && summary.categories.length > 0 ? <div className="table-wrap"><table><thead><tr><th>Tipo</th><th>Categoria</th><th>Voci</th><th>Totale</th></tr></thead><tbody>{summary.categories.map((item, index) => <tr key={item.entryType + "-" + item.category + "-" + index}><td>{item.entryType === "income" ? "Entrata" : "Uscita"}</td><td>{item.category}</td><td>{item.count}</td><td>{money(item.amountCents, summary.currency)}</td></tr>)}</tbody></table></div> : <p className="muted">Nessuna voce economica nel periodo selezionato.</p>}
      </>}
    </section>
  </div>;
}
