import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../lib/api";
import type { Locale } from "../../lib/domain";
import { useResource } from "../../hooks/useResource";
import { Alert, Button, Field, Input, LoadingState, Panel, PanelHeader, useToast } from "../../components/ui";

type FeedingSummary = {
  feedingIntervalDays: number | null;
  lastAcceptedAt: string | null;
  daysSinceLastFeeding: number | null;
  nextMealAt: string | null;
  consecutiveRefusals: number;
  acceptedCount: number;
  refusedCount: number;
  offeredCount: number;
  acceptanceRate: number | null;
};

export function AnimalFeedingInsights({ id, locale, readOnly }: { id: string; locale: Locale; readOnly: boolean }) {
  const it = locale === "it";
  const summary = useResource<FeedingSummary>(`/animals/${encodeURIComponent(id)}/feeding-summary`);
  const [interval, setInterval] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { toast, show } = useToast();

  useEffect(() => {
    if (summary.data) setInterval(summary.data.feedingIntervalDays == null ? "" : String(summary.data.feedingIntervalDays));
  }, [summary.data?.feedingIntervalDays]);

  async function saveInterval(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.patch(`/animals/${encodeURIComponent(id)}`, { feedingIntervalDays: interval === "" ? null : Number(interval) });
      await summary.reload();
      show(it ? "Intervallo alimentare aggiornato." : "Feeding interval updated.");
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : (it ? "Impossibile salvare l'intervallo." : "Could not save feeding interval."));
    } finally {
      setBusy(false);
    }
  }

  const date = (value: string | null) => value ? new Intl.DateTimeFormat(it ? "it-IT" : "en-GB", { dateStyle: "medium" }).format(new Date(value)) : "—";
  const percent = summary.data?.acceptanceRate == null ? "—" : new Intl.NumberFormat(it ? "it-IT" : "en-GB", { style: "percent", maximumFractionDigits: 1 }).format(summary.data.acceptanceRate);

  return <Panel>
    <PanelHeader title={it ? "Andamento alimentazione" : "Feeding overview"} />
    {summary.loading && !summary.data ? <LoadingState /> : summary.error ? <Alert tone="danger">{summary.error.message}</Alert> : summary.data && <>
      <div className="feeding-insights-grid">
        <div><span>{it ? "Giorni dall'ultimo pasto accettato" : "Days since last accepted meal"}</span><strong>{summary.data.daysSinceLastFeeding == null ? "—" : summary.data.daysSinceLastFeeding}</strong></div>
        <div><span>{it ? "Prossimo pasto previsto" : "Next expected meal"}</span><strong>{date(summary.data.nextMealAt)}</strong></div>
        <div><span>{it ? "Rifiuti consecutivi" : "Consecutive refusals"}</span><strong>{summary.data.consecutiveRefusals}</strong></div>
        <div><span>{it ? "Accettazione" : "Acceptance rate"}</span><strong>{percent}</strong><small>{summary.data.acceptedCount} / {summary.data.offeredCount} {it ? "offerti" : "offered"}</small></div>
      </div>
      {summary.data.lastAcceptedAt && <p className="muted-note">{it ? "Ultimo pasto accettato: " : "Last accepted meal: "}{date(summary.data.lastAcceptedAt)} · {summary.data.refusedCount} {it ? "rifiuti registrati" : "refusals recorded"}</p>}
    </>}
    {!readOnly && <form className="feeding-interval-form" onSubmit={saveInterval}>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label={it ? "Intervallo previsto (giorni)" : "Expected interval (days)"} hint={it ? "Impostalo in base alla specie, all'età e al piano alimentare dell'animale. Lascia vuoto per non calcolare una previsione." : "Set this according to species, age and the animal's feeding plan. Leave empty to disable predictions."}>
        <Input type="number" min="1" max="365" step="1" value={interval} onChange={(event) => setInterval(event.target.value)} placeholder={it ? "Non impostato" : "Not set"} />
      </Field>
      <Button type="submit" size="sm" disabled={busy}>{busy ? (it ? "Salvataggio…" : "Saving…") : (it ? "Salva intervallo" : "Save interval")}</Button>
    </form>}
    {toast}
  </Panel>;
}
