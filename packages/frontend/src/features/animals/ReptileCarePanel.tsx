import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../lib/api";
import { Alert, Button, Field, Input, Panel, PanelHeader, Textarea } from "../../components/ui";
import type { Locale } from "../../lib/domain";

type Fasting = { id: string; periodType: "fasting" | "refusal"; startedAt: string; endedAt: string | null; lastAcceptedMealAt: string | null; refusedMealsCount: number; reason: string | null; startWeightG: string | number | null; endWeightG: string | number | null; notes: string | null };
type Brumation = { id: string; startedAt: string; endedAt: string | null; startWeightG: string | number | null; endWeightG: string | number | null; temperatureC: string | number | null; humidityPct: string | number | null; conditions: string | null; notes: string | null };
type Data = { fastingPeriods: Fasting[]; brumationPeriods: Brumation[] };
const dateInput = (value?: string | null) => value ? value.slice(0, 10) : "";
const iso = (value: string) => value ? new Date(value + "T12:00:00").toISOString() : null;
const displayDate = (value: string | null, locale: Locale) => value ? new Date(value).toLocaleDateString(locale === "it" ? "it-IT" : "en-GB") : "—";

export function ReptileCarePanel({ animalId, locale, archived }: { animalId: string; locale: Locale; archived: boolean }) {
  const it = locale === "it";
  const [data, setData] = useState<Data>({ fastingPeriods: [], brumationPeriods: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<"fasting" | "brumation" | null>(null);
  const [fasting, setFasting] = useState({ periodType: "fasting", startedAt: dateInput(new Date().toISOString()), lastAcceptedMealAt: "", refusedMealsCount: "0", reason: "", startWeightG: "", notes: "" });
  const [brumation, setBrumation] = useState({ startedAt: dateInput(new Date().toISOString()), startWeightG: "", temperatureC: "", humidityPct: "", conditions: "", notes: "" });
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setData(await api.get<Data>(`/animals/${encodeURIComponent(animalId)}/reptile-care`)); }
    catch (e) { setError(e instanceof ApiError ? e.message : (it ? "Impossibile caricare i registri." : "Could not load reptile care records.")); }
    finally { setLoading(false); }
  }, [animalId, it]);
  useEffect(() => { void load(); }, [load]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      if (form === "fasting") {
        await api.post(`/animals/${encodeURIComponent(animalId)}/fasting-periods`, {
          ...fasting, startedAt: iso(fasting.startedAt), lastAcceptedMealAt: iso(fasting.lastAcceptedMealAt),
          refusedMealsCount: Number(fasting.refusedMealsCount), startWeightG: fasting.startWeightG ? Number(fasting.startWeightG) : null,
          notes: fasting.notes || null, reason: fasting.reason || null,
        });
      } else if (form === "brumation") {
        await api.post(`/animals/${encodeURIComponent(animalId)}/brumation-periods`, {
          ...brumation, startedAt: iso(brumation.startedAt), startWeightG: brumation.startWeightG ? Number(brumation.startWeightG) : null,
          temperatureC: brumation.temperatureC ? Number(brumation.temperatureC) : null,
          humidityPct: brumation.humidityPct ? Number(brumation.humidityPct) : null,
          conditions: brumation.conditions || null, notes: brumation.notes || null,
        });
      }
      setForm(null); await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : (it ? "Salvataggio non riuscito." : "Could not save record.")); }
    finally { setSaving(false); }
  }
  async function finishFasting(row: Fasting) {
    const finalWeight = window.prompt(it ? "Peso alla fine del digiuno (g). Lascia vuoto se non misurato." : "Weight at end of fast (g). Leave blank if not measured.", row.endWeightG == null ? "" : String(row.endWeightG));
    if (finalWeight === null) return;
    if (finalWeight.trim() && (!Number.isFinite(Number(finalWeight)) || Number(finalWeight) <= 0)) { setError(it ? "Inserisci un peso valido." : "Enter a valid weight."); return; }
    try { await api.patch(`/fasting-periods/${row.id}`, { periodType: row.periodType, startedAt: row.startedAt, endedAt: new Date().toISOString(), lastAcceptedMealAt: row.lastAcceptedMealAt, refusedMealsCount: row.refusedMealsCount, reason: row.reason, startWeightG: row.startWeightG == null ? null : Number(row.startWeightG), endWeightG: finalWeight.trim() ? Number(finalWeight) : null, notes: row.notes }); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : (it ? "Aggiornamento non riuscito." : "Could not update record.")); }
  }
  async function finishBrumation(row: Brumation) {
    const finalWeight = window.prompt(it ? "Peso alla fine della brumazione (g). Lascia vuoto se non misurato." : "Weight at end of brumation (g). Leave blank if not measured.", row.endWeightG == null ? "" : String(row.endWeightG));
    if (finalWeight === null) return;
    if (finalWeight.trim() && (!Number.isFinite(Number(finalWeight)) || Number(finalWeight) <= 0)) { setError(it ? "Inserisci un peso valido." : "Enter a valid weight."); return; }
    try { await api.patch(`/brumation-periods/${row.id}`, { startedAt: row.startedAt, endedAt: new Date().toISOString(), startWeightG: row.startWeightG == null ? null : Number(row.startWeightG), endWeightG: finalWeight.trim() ? Number(finalWeight) : null, temperatureC: row.temperatureC == null ? null : Number(row.temperatureC), humidityPct: row.humidityPct == null ? null : Number(row.humidityPct), conditions: row.conditions, notes: row.notes }); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : (it ? "Aggiornamento non riuscito." : "Could not update record.")); }
  }
  const remove = async (path: string) => {
    if (!window.confirm(it ? "Eliminare questa registrazione?" : "Delete this record?")) return;
    try { await api.delete(path); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : (it ? "Eliminazione non riuscita." : "Could not delete record.")); }
  };
  return <div className="page-stack">
    <Panel>
      <PanelHeader title={it ? "Digiuno e rifiuto del pasto" : "Fasting and feeding refusal"} description={it ? "Registra periodi di digiuno, rifiuti, ultimo pasto accettato e variazioni di peso." : "Track fasting periods, refused meals, last accepted meal and weight changes."} action={!archived ? <Button size="sm" onClick={() => setForm(form === "fasting" ? null : "fasting")}>{it ? "Registra periodo" : "Add period"}</Button> : undefined} />
      {form === "fasting" && <form className="form-stack" onSubmit={submit}>
        <Field label={it ? "Tipo" : "Type"}><select value={fasting.periodType} onChange={e => setFasting({ ...fasting, periodType: e.target.value })}><option value="fasting">{it ? "Digiuno" : "Fasting"}</option><option value="refusal">{it ? "Rifiuto del pasto" : "Meal refusal"}</option></select></Field>
        <Field label={it ? "Inizio" : "Start"}><Input type="date" required value={fasting.startedAt} onChange={e => setFasting({ ...fasting, startedAt: e.target.value })} /></Field>
        <Field label={it ? "Ultimo pasto accettato" : "Last accepted meal"}><Input type="date" value={fasting.lastAcceptedMealAt} onChange={e => setFasting({ ...fasting, lastAcceptedMealAt: e.target.value })} /></Field>
        <Field label={it ? "Pasti rifiutati" : "Refused meals"}><Input type="number" min="0" max="10000" value={fasting.refusedMealsCount} onChange={e => setFasting({ ...fasting, refusedMealsCount: e.target.value })} /></Field>
        <Field label={it ? "Peso iniziale (g)" : "Starting weight (g)"}><Input type="number" min="0.01" step="0.01" value={fasting.startWeightG} onChange={e => setFasting({ ...fasting, startWeightG: e.target.value })} /></Field>
        <Field label={it ? "Motivo / osservazioni" : "Reason / observations"}><Textarea rows={2} value={fasting.reason} onChange={e => setFasting({ ...fasting, reason: e.target.value })} /></Field>
        <Field label={it ? "Note" : "Notes"}><Textarea rows={2} value={fasting.notes} onChange={e => setFasting({ ...fasting, notes: e.target.value })} /></Field>
        <div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setForm(null)}>{it ? "Annulla" : "Cancel"}</Button><Button type="submit" disabled={saving}>{it ? "Salva" : "Save"}</Button></div>
      </form>}
      {loading ? <p>{it ? "Caricamento…" : "Loading…"}</p> : data.fastingPeriods.length === 0 ? <p className="muted-note">{it ? "Nessun periodo registrato." : "No periods recorded."}</p> : data.fastingPeriods.map(row => <article className="record-row" key={row.id}>
        <div><strong>{row.periodType === "refusal" ? (it ? "Rifiuto del pasto" : "Meal refusal") : (it ? "Digiuno" : "Fasting")}</strong><small>{displayDate(row.startedAt, locale)} – {displayDate(row.endedAt, locale)} · {it ? "Rifiuti" : "Refusals"}: {row.refusedMealsCount}</small>{row.lastAcceptedMealAt && <small>{it ? "Ultimo pasto accettato" : "Last accepted meal"}: {displayDate(row.lastAcceptedMealAt, locale)}</small>}{row.reason && <p>{row.reason}</p>}{row.startWeightG && <small>{it ? "Peso iniziale" : "Start weight"}: {row.startWeightG} g</small>}</div>
        {!archived && <div className="row-actions">{!row.endedAt && <Button size="sm" variant="secondary" onClick={() => void finishFasting(row)}>{it ? "Concludi" : "Finish"}</Button>}<Button size="sm" variant="ghost" onClick={() => void remove(`/fasting-periods/${row.id}`)}>{it ? "Elimina" : "Delete"}</Button></div>}
      </article>)}
    </Panel>
    <Panel>
      <PanelHeader title={it ? "Brumazione" : "Brumation"} description={it ? "Tieni traccia di date, peso e condizioni ambientali." : "Track dates, weight and environmental conditions."} action={!archived ? <Button size="sm" onClick={() => setForm(form === "brumation" ? null : "brumation")}>{it ? "Registra brumazione" : "Add brumation"}</Button> : undefined} />
      {form === "brumation" && <form className="form-stack" onSubmit={submit}>
        <Field label={it ? "Inizio" : "Start"}><Input type="date" required value={brumation.startedAt} onChange={e => setBrumation({ ...brumation, startedAt: e.target.value })} /></Field>
        <Field label={it ? "Peso iniziale (g)" : "Starting weight (g)"}><Input type="number" min="0.01" step="0.01" value={brumation.startWeightG} onChange={e => setBrumation({ ...brumation, startWeightG: e.target.value })} /></Field>
        <Field label={it ? "Temperatura (°C)" : "Temperature (°C)"}><Input type="number" step="0.1" value={brumation.temperatureC} onChange={e => setBrumation({ ...brumation, temperatureC: e.target.value })} /></Field>
        <Field label={it ? "Umidità (%)" : "Humidity (%)"}><Input type="number" min="0" max="100" step="0.1" value={brumation.humidityPct} onChange={e => setBrumation({ ...brumation, humidityPct: e.target.value })} /></Field>
        <Field label={it ? "Condizioni" : "Conditions"}><Textarea rows={2} value={brumation.conditions} onChange={e => setBrumation({ ...brumation, conditions: e.target.value })} /></Field>
        <Field label={it ? "Note" : "Notes"}><Textarea rows={2} value={brumation.notes} onChange={e => setBrumation({ ...brumation, notes: e.target.value })} /></Field>
        <div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setForm(null)}>{it ? "Annulla" : "Cancel"}</Button><Button type="submit" disabled={saving}>{it ? "Salva" : "Save"}</Button></div>
      </form>}
      {loading ? <p>{it ? "Caricamento…" : "Loading…"}</p> : data.brumationPeriods.length === 0 ? <p className="muted-note">{it ? "Nessuna brumazione registrata." : "No brumation periods recorded."}</p> : data.brumationPeriods.map(row => <article className="record-row" key={row.id}>
        <div><strong>{it ? "Brumazione" : "Brumation"}</strong><small>{displayDate(row.startedAt, locale)} – {displayDate(row.endedAt, locale)}</small>{row.startWeightG && <small>{it ? "Peso iniziale" : "Start weight"}: {row.startWeightG} g</small>}{row.temperatureC != null && <small>{row.temperatureC} °C · {row.humidityPct ?? "—"}%</small>}{row.conditions && <p>{row.conditions}</p>}</div>
        {!archived && <div className="row-actions">{!row.endedAt && <Button size="sm" variant="secondary" onClick={() => void finishBrumation(row)}>{it ? "Concludi" : "Finish"}</Button>}<Button size="sm" variant="ghost" onClick={() => void remove(`/brumation-periods/${row.id}`)}>{it ? "Elimina" : "Delete"}</Button></div>}
      </article>)}
    </Panel>
    {error && <Alert tone="danger">{error}</Alert>}
  </div>;
}
