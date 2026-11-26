import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../lib/api";
import { Button, Panel, PanelHeader } from "../../components/ui";
import type { Locale } from "../../lib/domain";

type HealthRecord = {
  id: string; recordType: string; status: "ongoing" | "resolved" | "chronic"; occurredAt: string;
  title: string; symptoms: string | null; diagnosis: string | null; suspectedCondition: string | null;
  veterinarian: string | null; clinic: string | null; medication: string | null; dosage: string | null;
  frequency: string | null; treatmentStartAt: string | null; treatmentEndAt: string | null;
  nextDueAt: string | null; notes: string | null;
};
type FormState = {
  recordType: string; status: "ongoing" | "resolved" | "chronic"; occurredAt: string; title: string;
  symptoms: string; diagnosis: string; suspectedCondition: string; veterinarian: string; clinic: string;
  medication: string; dosage: string; frequency: string; treatmentStartAt: string; treatmentEndAt: string;
  nextDueAt: string; notes: string;
};
const emptyForm = (): FormState => ({
  recordType: "visit", status: "ongoing", occurredAt: new Date().toISOString().slice(0, 10),
  title: "", symptoms: "", diagnosis: "", suspectedCondition: "", veterinarian: "", clinic: "",
  medication: "", dosage: "", frequency: "", treatmentStartAt: "", treatmentEndAt: "", nextDueAt: "", notes: "",
});
const asLocalDate = (value: string | null) => value ? value.slice(0, 10) : "";
const dateIso = (value: string) => value ? new Date(value + "T12:00:00").toISOString() : null;

export function AnimalHealthPanel({ animalId, locale, archived, onDocuments }: {
  animalId: string; locale: Locale; archived: boolean; onDocuments: () => void;
}) {
  const it = locale === "it";
  const [records, setRecords] = useState<HealthRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const result = await api.get<{ records: HealthRecord[] }>(`/animals/${animalId}/health-records`); setRecords(result.records); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : (it ? "Impossibile caricare la cartella sanitaria." : "Could not load health records.")); }
    finally { setLoading(false); }
  }, [animalId, it]);
  useEffect(() => { void load(); }, [load]);
  function beginEdit(record?: HealthRecord) {
    if (!record) { setEditing(null); setForm(emptyForm()); }
    else {
      setEditing(record.id);
      setForm({
        recordType: record.recordType, status: record.status, occurredAt: asLocalDate(record.occurredAt),
        title: record.title, symptoms: record.symptoms ?? "", diagnosis: record.diagnosis ?? "",
        suspectedCondition: record.suspectedCondition ?? "", veterinarian: record.veterinarian ?? "",
        clinic: record.clinic ?? "", medication: record.medication ?? "", dosage: record.dosage ?? "",
        frequency: record.frequency ?? "", treatmentStartAt: asLocalDate(record.treatmentStartAt),
        treatmentEndAt: asLocalDate(record.treatmentEndAt), nextDueAt: asLocalDate(record.nextDueAt), notes: record.notes ?? "",
      });
    }
    setShowForm(true);
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    const payload = {
      ...form, occurredAt: dateIso(form.occurredAt), treatmentStartAt: dateIso(form.treatmentStartAt),
      treatmentEndAt: dateIso(form.treatmentEndAt), nextDueAt: dateIso(form.nextDueAt),
      symptoms: form.symptoms || null, diagnosis: form.diagnosis || null,
      suspectedCondition: form.suspectedCondition || null, veterinarian: form.veterinarian || null,
      clinic: form.clinic || null, medication: form.medication || null, dosage: form.dosage || null,
      frequency: form.frequency || null, notes: form.notes || null,
    };
    try {
      if (editing) await api.patch(`/health-records/${editing}`, payload);
      else await api.post(`/animals/${animalId}/health-records`, payload);
      setShowForm(false); setEditing(null); await load();
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : (it ? "Salvataggio non riuscito." : "Could not save record.")); }
    finally { setSaving(false); }
  }
  async function remove(id: string) {
    if (!window.confirm(it ? "Eliminare questa registrazione sanitaria?" : "Delete this health record?")) return;
    try { await api.delete(`/health-records/${id}`); await load(); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : (it ? "Eliminazione non riuscita." : "Could not delete record.")); }
  }
  const update = (key: keyof FormState, value: string) => setForm(current => ({ ...current, [key]: value }));
  const label = (value: string) => it ? value : ({
    "Sintomo": "Symptom", "Visita veterinaria": "Veterinary visit", "Diagnosi": "Diagnosis",
    "Sospetto": "Suspected condition", "Trattamento": "Treatment", "Controllo": "Check-up",
    "In corso": "Ongoing", "Risolto": "Resolved", "Cronico": "Chronic",
  } as Record<string,string>)[value] ?? value;
  const typeLabels: Record<string,string> = { symptom: label("Sintomo"), visit: label("Visita veterinaria"), diagnosis: label("Diagnosi"), suspicion: label("Sospetto"), treatment: label("Trattamento"), checkup: label("Controllo"), vaccination: label("Vaccinazione") };
  const statusLabels = { ongoing: label("In corso"), resolved: label("Risolto"), chronic: label("Cronico") };
  const field = (key: keyof FormState, title: string, type = "text") => <label className="health-field" key={key}><span>{title}</span><input type={type} value={form[key]} onChange={e => update(key, e.target.value)} /></label>;
  return <Panel>
    <PanelHeader title={it ? "Cartella sanitaria" : "Health record"} action={<div className="health-panel-actions"><Button variant="secondary" onClick={onDocuments}>{it ? "Referti e allegati" : "Reports & attachments"}</Button><Button disabled={archived} onClick={() => beginEdit()}>{it ? "Nuova registrazione" : "Add record"}</Button></div>} />
    <p className="muted-note">{it ? "Registra sintomi, valutazioni, visite e trattamenti. Le informazioni non sostituiscono una diagnosi veterinaria." : "Record symptoms, assessments, visits and treatments. This log is not a substitute for veterinary diagnosis."}</p>
    {error && <div className="form-error" role="alert">{error}</div>}
    {showForm && <form className="health-form" onSubmit={submit}>
      <div className="health-form-grid">
        <label className="health-field"><span>{it ? "Tipo" : "Type"}</span><select value={form.recordType} onChange={e => update("recordType", e.target.value)}>{Object.entries(typeLabels).map(([value,title]) => <option key={value} value={value}>{title}</option>)}</select></label>
        <label className="health-field"><span>{it ? "Stato del problema" : "Problem status"}</span><select value={form.status} onChange={e => update("status", e.target.value)}><option value="ongoing">{statusLabels.ongoing}</option><option value="resolved">{statusLabels.resolved}</option><option value="chronic">{statusLabels.chronic}</option></select></label>
        {field("occurredAt", it ? "Data" : "Date", "date")}
        {field("title", it ? "Titolo / problema" : "Title / issue")}
        {field("symptoms", it ? "Sintomi osservati" : "Observed symptoms")}
        {field("diagnosis", it ? "Diagnosi veterinaria" : "Veterinary diagnosis")}
        {field("suspectedCondition", it ? "Sospetto (non confermato)" : "Suspected condition (unconfirmed)")}
        {field("veterinarian", it ? "Veterinario" : "Veterinarian")}
        {field("clinic", it ? "Clinica" : "Clinic")}
        {field("medication", it ? "Farmaco / trattamento" : "Medication / treatment")}
        {field("dosage", it ? "Dosaggio" : "Dosage")}
        {field("frequency", it ? "Frequenza / modalità" : "Frequency / instructions")}
        {field("treatmentStartAt", it ? "Inizio trattamento" : "Treatment start", "date")}
        {field("treatmentEndAt", it ? "Fine trattamento" : "Treatment end", "date")}
        {field("nextDueAt", it ? "Prossimo controllo / scadenza" : "Next check / due date", "date")}
      </div>
      <label className="health-field"><span>{it ? "Note aggiuntive" : "Additional notes"}</span><textarea rows={3} value={form.notes} onChange={e => update("notes", e.target.value)} /></label>
      <div className="health-form-actions"><Button type="button" variant="secondary" onClick={() => setShowForm(false)}>{it ? "Annulla" : "Cancel"}</Button><Button type="submit" disabled={saving || !form.title.trim() || !form.occurredAt}>{saving ? (it ? "Salvataggio…" : "Saving…") : (it ? "Salva" : "Save")}</Button></div>
    </form>}
    {loading ? <p>{it ? "Caricamento…" : "Loading…"}</p> : records.length === 0 ? <div className="empty-state"><strong>{it ? "Nessuna registrazione sanitaria" : "No health records yet"}</strong><p>{it ? "Aggiungi la prima visita, osservazione o terapia." : "Add the first visit, observation or treatment."}</p></div> : <div className="health-record-list">
      {records.map(record => <article className="health-record" key={record.id}>
        <div className="health-record-heading"><div><span className="health-record-type">{typeLabels[record.recordType] ?? record.recordType}</span><h3>{record.title}</h3></div><span className={"health-status health-status-" + record.status}>{statusLabels[record.status]}</span></div>
        <p className="muted-note">{new Date(record.occurredAt).toLocaleDateString(locale === "it" ? "it-IT" : "en-GB")}</p>
        {record.symptoms && <p><strong>{it ? "Sintomi: " : "Symptoms: "}</strong>{record.symptoms}</p>}
        {record.diagnosis && <p><strong>{it ? "Diagnosi: " : "Diagnosis: "}</strong>{record.diagnosis}</p>}
        {record.suspectedCondition && <p><strong>{it ? "Sospetto: " : "Suspected: "}</strong>{record.suspectedCondition}</p>}
        {(record.veterinarian || record.clinic) && <p>{[record.veterinarian, record.clinic].filter(Boolean).join(" · ")}</p>}
        {record.medication && <p><strong>{record.medication}</strong>{record.dosage ? " · " + record.dosage : ""}{record.frequency ? " · " + record.frequency : ""}</p>}
        {(record.treatmentStartAt || record.treatmentEndAt) && <p className="muted-note">{it ? "Trattamento: " : "Treatment: "}{asLocalDate(record.treatmentStartAt)} – {asLocalDate(record.treatmentEndAt) || "…"}</p>}
        {record.nextDueAt && <p className="health-next-due">{it ? "Prossima scadenza: " : "Next due: "}{new Date(record.nextDueAt).toLocaleDateString(locale === "it" ? "it-IT" : "en-GB")}</p>}
        {record.notes && <p>{record.notes}</p>}
        <div className="health-record-actions"><Button size="sm" variant="secondary" disabled={archived} onClick={() => beginEdit(record)}>{it ? "Modifica" : "Edit"}</Button><Button size="sm" variant="ghost" disabled={archived} onClick={() => void remove(record.id)}>{it ? "Elimina" : "Delete"}</Button></div>
      </article>)}
    </div>}
  </Panel>;
}
