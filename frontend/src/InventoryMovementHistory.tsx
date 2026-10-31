import React, { useCallback, useEffect, useState } from "react";
import { getIntlLocale } from "./i18n";
import type { AnyRecord } from "./types";
import { apiRequest } from "./api/api";
import { errorMessage } from "./types";

const dateLabel = (value?: string | Date | null) => value ? new Intl.DateTimeFormat(getIntlLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
const money = (value: number | string | null | undefined) => value == null ? "—" : new Intl.NumberFormat(getIntlLocale(), { style: "currency", currency: "EUR" }).format(Number(value) / 100);
function Button({ children, variant = "secondary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) { return <button className={"button " + variant} {...props}>{children}</button>; }
export function InventoryMovementHistory({ item, onClose }: { item: AnyRecord; onClose: () => void }) {
  const [movements, setMovements] = useState<AnyRecord[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!item?.id) return;
    setBusy(true); setError("");
    try {
      const response = await apiRequest("inventory/items/" + encodeURIComponent(item.id) + "/movements?page=" + page + "&pageSize=25");
      setMovements(Array.isArray(response?.movements) ? response.movements : []);
      setPagination(response?.pagination || { page, pageSize: 25, total: 0, totalPages: 0 });
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }, [item?.id, page]);
  useEffect(() => { setPage(1); }, [item?.id]);
  useEffect(() => { void load(); }, [load]);
  if (!item) return null;
  return <section className="panel">
    <div className="panel-heading"><div><p className="eyebrow">TRACCIABILITÀ MAGAZZINO</p><h2>Storico movimenti · {item.name}</h2><p className="subheading">Giacenza attuale: {item.quantityOnHand ?? "—"} {item.unit || ""}</p></div><div className="inline-actions"><Button onClick={() => void load()}>↻ Aggiorna</Button><Button onClick={onClose}>Chiudi</Button></div></div>
    {error && <p className="form-message" role="alert">{error}</p>}
    {busy ? <div className="loading">Caricamento movimenti…</div> : movements.length === 0 ? <div className="empty-state"><h3>Nessun movimento registrato</h3><p>Quando registri un carico, uno scarico o una rettifica, comparirà qui.</p></div> : <div className="table-wrap"><table><thead><tr><th>Data</th><th>Tipo</th><th>Quantità</th><th>Costo unitario</th><th>Riferimento</th><th>Note</th></tr></thead><tbody>{movements.map(row => <tr key={row.id}><td>{dateLabel(row.occurredAt)}</td><td>{(({ in: "Carico", out: "Scarico", adjustment: "Rettifica" } as Record<string, string>)[row.movementType] || row.movementType)}</td><td>{row.movementType === "out" ? "−" : row.movementType === "in" ? "+" : ""}{row.quantity} {item.unit || ""}</td><td>{money(row.unitCostCents)}</td><td>{row.reference || "—"}</td><td>{row.notes || "—"}</td></tr>)}</tbody></table></div>}
    <div className="pagination-bar"><span className="muted">Pagina {pagination.page || page} di {Math.max(1, pagination.totalPages || 1)} · {pagination.total ?? movements.length} movimenti</span><div className="inline-actions"><Button disabled={page <= 1 || busy} onClick={() => setPage(p => Math.max(1, p - 1))}>← Precedente</Button><Button disabled={page >= (pagination.totalPages || 1) || busy} onClick={() => setPage(p => p + 1)}>Successiva →</Button></div></div>
  </section>;
}
