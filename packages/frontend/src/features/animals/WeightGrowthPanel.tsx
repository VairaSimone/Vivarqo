import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../../lib/api";
import type { Locale } from "../../lib/domain";
import { formatWeight } from "../../lib/domain";
import { translate } from "../../lib/i18n";
import { Alert, Button, Field, Input, Panel, PanelHeader } from "../../components/ui";

type Measurement = { id: string; measuredAt: string; weightG: string | number; notes?: string | null };
type GrowthResponse = {
  measurements: Measurement[];
  current: { count: number; firstWeightG: number | null; lastWeightG: number | null; changeG: number | null; changePercent: number | null };
  previous: { count: number; firstWeightG: number | null; lastWeightG: number | null; changeG: number | null; changePercent: number | null };
  periodDays: number | null;
  alerts: Array<{ type: "loss" | "variation"; measuredAt: string; previousWeightG: number; weightG: number; changeG: number; changePercent: number }>;
  truncated: boolean;
};

function dateLabel(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", { day: "2-digit", month: "short" }).format(new Date(value));
}

export function WeightGrowthPanel({ animalId, locale, readOnly }: { animalId: string; locale: Locale; readOnly: boolean }) {
  const t = (key: string) => translate(locale, key);
  const [period, setPeriod] = useState("90");
  const [data, setData] = useState<GrowthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [intervalDays, setIntervalDays] = useState("30");
  const [nextDueAt, setNextDueAt] = useState(() => {
    const date = new Date(); date.setDate(date.getDate() + 30);
    return date.toISOString().slice(0, 10);
  });
  const [reminderBusy, setReminderBusy] = useState(false);
  const [reminderMessage, setReminderMessage] = useState("");
  const [exportBusy, setExportBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    api.get<GrowthResponse>(`/animals/${encodeURIComponent(animalId)}/weight-growth?periodDays=${period}`, { signal: controller.signal })
      .then(setData)
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof ApiError ? reason.message : t("operationFailed")); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [animalId, period]);

  const points = useMemo(() => data?.measurements ?? [], [data]);
  const chart = useMemo(() => {
    if (points.length < 2) return null;
    const values = points.map((point) => Number(point.weightG));
    const min = Math.min(...values); const max = Math.max(...values);
    const padding = Math.max((max - min) * 0.15, 1);
    const low = min - padding; const range = Math.max(max - min + padding * 2, 1);
    const coords = values.map((value, index) => ({ x: 24 + index * (552 / Math.max(values.length - 1, 1)), y: 126 - ((value - low) / range) * 104 }));
    return { coords, min, max, polyline: coords.map((point) => `${point.x},${point.y}`).join(" ") };
  }, [points]);

  async function createReminder() {
    const days = Number(intervalDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650 || !nextDueAt) {
      setReminderMessage(locale === "it" ? "Inserisci un intervallo valido e una data." : "Enter a valid interval and date.");
      return;
    }
    setReminderBusy(true); setReminderMessage("");
    try {
      await api.post("/tasks/reminder-rules", {
        title: locale === "it" ? "Pesatura periodica" : "Periodic weighing",
        description: locale === "it" ? "Promemoria automatico per registrare il peso dell'animale." : "Automatic reminder to record this animal's weight.",
        category: "weighing", intervalDays: days, nextDueAt: new Date(nextDueAt + "T09:00:00").toISOString(), animalId, isEnabled: true
      });
      setReminderMessage(locale === "it" ? "Promemoria ricorrente creato." : "Recurring reminder created.");
    } catch (reason) {
      setReminderMessage(reason instanceof ApiError ? reason.message : t("operationFailed"));
    } finally { setReminderBusy(false); }
  }

  async function exportHistory() {
    setExportBusy(true);
    try { await api.download(`/animals/${encodeURIComponent(animalId)}/weights/export.csv`, "storico-pesature.csv"); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setExportBusy(false); }
  }

  const current = data?.current;
  const previous = data?.previous;
  const number = (value: number | null) => value == null ? "—" : `${value > 0 ? "+" : ""}${value.toLocaleString(locale === "it" ? "it-IT" : "en-GB", { maximumFractionDigits: 2 })}`;
  return <Panel>
    <PanelHeader title={locale === "it" ? "Analisi della crescita" : "Growth analysis"} action={<Button size="sm" variant="secondary" disabled={exportBusy || points.length === 0} onClick={() => void exportHistory()}>{exportBusy ? t("loading") : (locale === "it" ? "Esporta CSV" : "Export CSV")}</Button>} />
    <div className="weight-growth-controls">
      <Field label={locale === "it" ? "Periodo analizzato" : "Analysis period"}>
        <select value={period} onChange={(event) => setPeriod(event.target.value)}>
          <option value="30">{locale === "it" ? "Ultimi 30 giorni" : "Last 30 days"}</option>
          <option value="90">{locale === "it" ? "Ultimi 90 giorni" : "Last 90 days"}</option>
          <option value="180">{locale === "it" ? "Ultimi 6 mesi" : "Last 6 months"}</option>
          <option value="365">{locale === "it" ? "Ultimi 12 mesi" : "Last 12 months"}</option>
          <option value="all">{locale === "it" ? "Tutto lo storico" : "All history"}</option>
        </select>
      </Field>
    </div>
    {loading ? <p className="muted-note">{t("loading")}</p> : error ? <Alert tone="danger">{error}</Alert> : <>
      <div className="weight-growth-stats">
        <div><span>{locale === "it" ? "Variazione periodo" : "Period change"}</span><strong>{number(current?.changeG ?? null)} g</strong><small>{number(current?.changePercent ?? null)}%</small></div>
        <div><span>{locale === "it" ? "Peso iniziale" : "Starting weight"}</span><strong>{current?.firstWeightG == null ? "—" : formatWeight(current.firstWeightG, locale)}</strong></div>
        <div><span>{locale === "it" ? "Peso più recente" : "Latest weight"}</span><strong>{current?.lastWeightG == null ? "—" : formatWeight(current.lastWeightG, locale)}</strong></div>
      </div>
      {chart ? <div className="weight-growth-chart">
        <svg viewBox="0 0 600 160" role="img" aria-label={locale === "it" ? "Grafico dello storico del peso" : "Weight history chart"}>
          {[30, 80, 130].map((y) => <line key={y} x1="20" x2="580" y1={y} y2={y} stroke="currentColor" opacity=".12" />)}
          <polyline points={chart.polyline} fill="none" stroke="var(--forest)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          {chart.coords.map((point, index) => <circle key={points[index]!.id} cx={point.x} cy={point.y} r="4" fill="var(--terracotta)" />)}
        </svg>
        <div className="chart-caption"><span>{dateLabel(points[0]!.measuredAt, locale)}</span><span>{dateLabel(points.at(-1)!.measuredAt, locale)}</span></div>
      </div> : <p className="muted-note">{locale === "it" ? "Servono almeno due pesature nel periodo per disegnare il grafico." : "At least two weigh-ins in this period are needed to draw the chart."}</p>}
      {period !== "all" && <div className="weight-growth-comparison">
        <strong>{locale === "it" ? "Confronto con il periodo precedente" : "Compared with previous period"}</strong>
        <span>{locale === "it" ? "Variazione precedente" : "Previous change"}: {number(previous?.changeG ?? null)} g ({number(previous?.changePercent ?? null)}%)</span>
      </div>}
      {data?.alerts.map((alert, index) => <Alert key={index} tone={alert.type === "loss" ? "warning" : "info"}>{alert.type === "loss" ? (locale === "it" ? "Perdita di peso rilevata" : "Weight loss detected") : (locale === "it" ? "Variazione marcata rilevata" : "Marked variation detected")} · {dateLabel(alert.measuredAt, locale)} · {number(alert.changeG)} g ({number(alert.changePercent)}%)</Alert>)}
      {data?.alerts.length === 0 && <p className="muted-note">{locale === "it" ? "Nessuna variazione anomala secondo le soglie automatiche." : "No unusual changes detected by the automatic thresholds."}</p>}
      <p className="muted-note">{locale === "it" ? "Le soglie sono indicatori orientativi (perdita ≥5% o aumento ≥30% tra due pesate), non una diagnosi veterinaria." : "Thresholds are screening indicators (loss ≥5% or gain ≥30% between weigh-ins), not a veterinary diagnosis."}</p>
      {data?.truncated && <p className="muted-note">{locale === "it" ? "Lo storico visualizzato è limitato alle 2.000 misurazioni più recenti." : "The displayed history is limited to the latest 2,000 measurements."}</p>}
    </>}
    {!readOnly && <div className="weight-growth-reminder">
      <strong>{locale === "it" ? "Promemoria pesature" : "Weighing reminder"}</strong>
      <div className="weight-growth-reminder-fields">
        <Field label={locale === "it" ? "Ogni (giorni)" : "Every (days)"}><Input type="number" min="1" max="3650" value={intervalDays} onChange={(event) => setIntervalDays(event.target.value)} /></Field>
        <Field label={locale === "it" ? "Prima scadenza" : "First due date"}><Input type="date" value={nextDueAt} onChange={(event) => setNextDueAt(event.target.value)} /></Field>
        <Button disabled={reminderBusy} onClick={() => void createReminder()}>{reminderBusy ? t("loading") : (locale === "it" ? "Crea promemoria" : "Create reminder")}</Button>
      </div>
      {reminderMessage && <p className="muted-note" role="status">{reminderMessage}</p>}
    </div>}
  </Panel>;
}
