import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import type { Locale } from "../lib/domain";
import { Alert, Button, Field, Input, LoadingState, PageHeader, Panel, Select, Textarea } from "../components/ui";

type CompanionAnimal = { id: string; name: string; species: string };
type CareRecord = { id: string; animalId: string; kind: string; title: string; occurredAt: string; nextDueAt: string | null; completedAt?: string | null; dueStatus?: "none" | "overdue" | "imminent" | "future" | "upcoming" | "completed"; task?: { id: string; status: string } | null; provider: string | null; dosage: string | null; notes: string | null; animal: CompanionAnimal };
const kinds = ["vaccination", "medication", "vet_visit", "parasite_prevention", "surgery", "grooming", "other"];

export function CompanionCarePage({ locale }: { locale: Locale }) {
  const it = locale === "it";
  const [animals, setAnimals] = useState<CompanionAnimal[]>([]);
  const [records, setRecords] = useState<CareRecord[]>([]);
  const [dueFilter, setDueFilter] = useState<"all" | "overdue" | "imminent" | "future" | "completed">("all");
  const [animalId, setAnimalId] = useState("");
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [kind, setKind] = useState("vaccination");
  const [title, setTitle] = useState("");
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 10));
  const [nextDueAt, setNextDueAt] = useState("");
  const [provider, setProvider] = useState("");
  const [dosage, setDosage] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function reload() {
    const result = await api.get<{ records: CareRecord[] }>("/companion-care");
    setRecords(result.records);
  }
  useEffect(() => {
    let active = true;
    Promise.all([
      api.get<{ animals: CompanionAnimal[] }>("/animals?category=dogs_cats&status=all&page=1&pageSize=100"),
      api.get<{ records: CareRecord[] }>("/companion-care"),
    ]).then(([animalResult, recordResult]) => {
      if (!active) return;
      setAnimals(animalResult.animals);
      setAnimalId(animalResult.animals[0]?.id ?? "");
      setRecords(recordResult.records);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof ApiError ? reason.message : (it ? "Impossibile caricare i dati." : "Unable to load data."));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [it]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(""); setNotice("");
    try {
      const payload = {
        animalId, kind, title,
        occurredAt: new Date(occurredAt + "T12:00:00").toISOString(),
        nextDueAt: nextDueAt ? new Date(nextDueAt + "T12:00:00").toISOString() : null,
        provider: provider || null, dosage: dosage || null, notes: notes || null,
      };
      if (editingRecordId) {
        await api.patch("/companion-care/" + editingRecordId, {
          kind, title, occurredAt: payload.occurredAt, nextDueAt: payload.nextDueAt,
          provider: payload.provider, dosage: payload.dosage, notes: payload.notes,
        });
      } else {
        await api.post("/companion-care", payload);
      }
      await reload();
      setEditingRecordId(null);
      setTitle(""); setNextDueAt(""); setProvider(""); setDosage(""); setNotes("");
      setNotice(it ? (editingRecordId ? "Evento aggiornato." : "Evento registrato correttamente.") : (editingRecordId ? "Care event updated." : "Care event saved."));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : (it ? "Salvataggio non riuscito." : "Unable to save record."));
    } finally { setSaving(false); }
  }

  function editRecord(record: CareRecord) {
    setEditingRecordId(record.id);
    setAnimalId(record.animalId);
    setKind(record.kind);
    setTitle(record.title);
    setOccurredAt(new Date(record.occurredAt).toISOString().slice(0, 10));
    setNextDueAt(record.nextDueAt ? new Date(record.nextDueAt).toISOString().slice(0, 10) : "");
    setProvider(record.provider ?? "");
    setDosage(record.dosage ?? "");
    setNotes(record.notes ?? "");
    setError("");
    setNotice("");
  }

  async function deleteRecord(record: CareRecord) {
    if (!window.confirm(it ? `Eliminare l'evento "${record.title}"?` : `Delete care event "${record.title}"?`)) return;
    setSaving(true); setError(""); setNotice("");
    try {
      await api.delete("/companion-care/" + record.id);
      if (editingRecordId === record.id) setEditingRecordId(null);
      await reload();
      setNotice(it ? "Evento eliminato." : "Care event deleted.");
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : (it ? "Eliminazione non riuscita." : "Unable to delete record."));
    } finally { setSaving(false); }
  }

  if (loading) return <LoadingState />;
  return <div className="page-stack">
    <PageHeader eyebrow={it ? "CANI E GATTI" : "DOGS & CATS"} title={it ? "Cura e salute" : "Health & care"}
      description={it ? "Tieni sotto controllo vaccinazioni, terapie, visite veterinarie e prossime scadenze." : "Track vaccinations, medication, vet visits and upcoming care."} />
    {error && <Alert tone="danger">{error}</Alert>}
    {notice && <Alert tone="success">{notice}</Alert>}
    <Panel>
      <h2>{editingRecordId ? (it ? "Modifica evento" : "Edit care event") : (it ? "Registra un evento" : "Add a care event")}</h2>
      {animals.length === 0 ? <p>{it ? "Prima crea una scheda cane o gatto nella sezione Animali." : "Create a dog or cat profile in Animals first."}</p> :
        <form className="form-stack" onSubmit={save}>
          <div className="form-grid">
            <Field label={it ? "Animale" : "Animal"}><Select required value={animalId} onChange={(e) => setAnimalId(e.target.value)}>{animals.map((animal) => <option key={animal.id} value={animal.id}>{animal.name} · {animal.species}</option>)}</Select></Field>
            <Field label={it ? "Tipo evento" : "Event type"}><Select value={kind} onChange={(e) => setKind(e.target.value)}>{kinds.map((value) => <option key={value} value={value}>{it ? ({vaccination:"Vaccinazione",medication:"Farmaco/terapia",vet_visit:"Visita veterinaria",parasite_prevention:"Antiparassitario",surgery:"Intervento",grooming:"Toelettatura",other:"Altro"} as Record<string,string>)[value] : value.replaceAll("_"," ")}</option>)}</Select></Field>
            <Field label={it ? "Descrizione" : "Title"}><Input required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label={it ? "Data evento" : "Event date"}><Input type="date" required value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} /></Field>
            <Field label={it ? "Prossima scadenza" : "Next due date"}><Input type="date" value={nextDueAt} onChange={(e) => setNextDueAt(e.target.value)} /></Field>
            <Field label={it ? "Veterinario / struttura" : "Veterinarian / provider"}><Input maxLength={160} value={provider} onChange={(e) => setProvider(e.target.value)} /></Field>
            <Field label={it ? "Dosaggio" : "Dosage"}><Input maxLength={120} value={dosage} onChange={(e) => setDosage(e.target.value)} /></Field>
          </div>
          <Field label={it ? "Note" : "Notes"}><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <div className="modal-actions"><Button type="submit" disabled={saving || !animalId}>{saving ? (it ? "Salvataggio…" : "Saving…") : (editingRecordId ? (it ? "Salva modifiche" : "Save changes") : (it ? "Registra evento" : "Save event"))}</Button>
            {editingRecordId && <Button type="button" variant="secondary" disabled={saving} onClick={() => { setEditingRecordId(null); setTitle(""); setNextDueAt(""); setProvider(""); setDosage(""); setNotes(""); }}>{it ? "Annulla" : "Cancel"}</Button>}</div>
        </form>}
    </Panel>
    <Panel>
      <h2>{it ? "Storico e scadenze" : "History & due dates"}</h2>
      <div className="dashboard-task-filters" role="group" aria-label={it ? "Filtra scadenze sanitarie" : "Filter health due dates"}>
        {(["all", "overdue", "imminent", "future", "completed"] as const).map((filter) => <button key={filter} type="button" className={dueFilter === filter ? "dashboard-task-filter is-active" : "dashboard-task-filter"} aria-pressed={dueFilter === filter} onClick={() => setDueFilter(filter)}>{({all: it ? "Tutte" : "All", overdue: it ? "Scadute" : "Overdue", imminent: it ? "Imminenti (7 gg)" : "Due soon (7 days)", future: it ? "Future" : "Future", completed: it ? "Completate" : "Completed"})[filter]}</button>)}
      </div>
      {records.filter((record) => dueFilter === "all" || (record.dueStatus ?? (record.completedAt ? "completed" : !record.nextDueAt ? "none" : new Date(record.nextDueAt).getTime() < Date.now() ? "overdue" : new Date(record.nextDueAt).getTime() <= Date.now() + 7 * 86_400_000 ? "imminent" : "future")) === dueFilter).length === 0
        ? <p>{it ? "Nessun evento in questa categoria." : "No records in this category."}</p>
        : <div className="ecosys-history">{records.filter((record) => dueFilter === "all" || (record.dueStatus ?? (record.completedAt ? "completed" : !record.nextDueAt ? "none" : new Date(record.nextDueAt).getTime() < Date.now() ? "overdue" : new Date(record.nextDueAt).getTime() <= Date.now() + 7 * 86_400_000 ? "imminent" : "future")) === dueFilter).map((record) => {
          const status = record.dueStatus ?? (record.completedAt ? "completed" : !record.nextDueAt ? "none" : new Date(record.nextDueAt).getTime() < Date.now() ? "overdue" : new Date(record.nextDueAt).getTime() <= Date.now() + 7 * 86_400_000 ? "imminent" : "future");
          return <article className="ecosys-reading" key={record.id}>
            <strong>{record.animal.name} · {record.title}</strong>
            <span>{record.kind.replaceAll("_"," ")} · {new Date(record.occurredAt).toLocaleDateString(it ? "it-IT" : "en-GB")}{record.nextDueAt ? " · " + (it ? "Scadenza: " : "Due: ") + new Date(record.nextDueAt).toLocaleDateString(it ? "it-IT" : "en-GB") : ""}</span>
            <span>{status === "overdue" ? (it ? "Scaduta" : "Overdue") : status === "completed" ? (it ? "Completata" : "Completed") : status === "imminent" ? (it ? "In scadenza entro 7 giorni" : "Due within 7 days") : status === "future" ? (it ? "Futura" : "Future") : (it ? "Senza scadenza" : "No due date")}</span>
            {record.provider && <span>{record.provider}{record.dosage ? " · " + record.dosage : ""}</span>}
            {record.notes && <span>{record.notes}</span>}
            <div className="inline-actions">
              {status !== "completed" && record.task?.status === "open" && <Button size="sm" disabled={saving} onClick={async () => { setSaving(true); setError(""); try { await api.post("/tasks/" + record.task!.id + "/complete", {}); await reload(); setNotice(it ? "Scadenza segnata come completata." : "Due date marked as completed."); } catch (reason) { setError(reason instanceof ApiError ? reason.message : (it ? "Operazione non riuscita." : "Operation failed.")); } finally { setSaving(false); } }}>{it ? "Segna completata" : "Mark complete"}</Button>}
              <Button size="sm" variant="secondary" disabled={saving} onClick={() => editRecord(record)}>{it ? "Modifica" : "Edit"}</Button>
              <Button size="sm" variant="danger" disabled={saving} onClick={() => void deleteRecord(record)}>{it ? "Elimina" : "Delete"}</Button>
            </div>
          </article>;
        })}</div>
    </Panel>
  </div>;
}
