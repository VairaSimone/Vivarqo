import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import type { Locale } from "../lib/domain";
import { Alert, Button, Field, Input, LoadingState, PageHeader, Panel, Select, Textarea } from "../components/ui";

type CompanionAnimal = { id: string; name: string; species: string };
type CareRecord = { id: string; animalId: string; kind: string; title: string; occurredAt: string; nextDueAt: string | null; provider: string | null; dosage: string | null; notes: string | null; animal: CompanionAnimal };
const kinds = ["vaccination", "medication", "vet_visit", "parasite_prevention", "surgery", "grooming", "other"];

export function CompanionCarePage({ locale }: { locale: Locale }) {
  const it = locale === "it";
  const [animals, setAnimals] = useState<CompanionAnimal[]>([]);
  const [records, setRecords] = useState<CareRecord[]>([]);
  const [animalId, setAnimalId] = useState("");
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
      await api.post("/companion-care", {
        animalId, kind, title,
        occurredAt: new Date(occurredAt + "T12:00:00").toISOString(),
        nextDueAt: nextDueAt ? new Date(nextDueAt + "T12:00:00").toISOString() : null,
        provider: provider || null, dosage: dosage || null, notes: notes || null,
      });
      await reload();
      setTitle(""); setNextDueAt(""); setProvider(""); setDosage(""); setNotes("");
      setNotice(it ? "Evento registrato correttamente." : "Care event saved.");
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : (it ? "Salvataggio non riuscito." : "Unable to save record."));
    } finally { setSaving(false); }
  }

  if (loading) return <LoadingState />;
  return <div className="page-stack">
    <PageHeader eyebrow={it ? "CANI E GATTI" : "DOGS & CATS"} title={it ? "Cura e salute" : "Health & care"}
      description={it ? "Tieni sotto controllo vaccinazioni, terapie, visite veterinarie e prossime scadenze." : "Track vaccinations, medication, vet visits and upcoming care."} />
    {error && <Alert tone="danger">{error}</Alert>}
    {notice && <Alert tone="success">{notice}</Alert>}
    <Panel>
      <h2>{it ? "Registra un evento" : "Add a care event"}</h2>
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
          <div className="modal-actions"><Button type="submit" disabled={saving || !animalId}>{saving ? (it ? "Salvataggio…" : "Saving…") : (it ? "Registra evento" : "Save event")}</Button></div>
        </form>}
    </Panel>
    <Panel>
      <h2>{it ? "Storico e scadenze" : "History & due dates"}</h2>
      {records.length === 0 ? <p>{it ? "Non ci sono ancora eventi registrati." : "No care events recorded yet."}</p> :
        <div className="ecosys-history">{records.map((record) => <article className="ecosys-reading" key={record.id}>
          <strong>{record.animal.name} · {record.title}</strong>
          <span>{record.kind.replaceAll("_"," ")} · {new Date(record.occurredAt).toLocaleDateString(it ? "it-IT" : "en-GB")}{record.nextDueAt ? " · " + (it ? "Prossima scadenza: " : "Next due: ") + new Date(record.nextDueAt).toLocaleDateString(it ? "it-IT" : "en-GB") : ""}</span>
          {record.provider && <span>{record.provider}{record.dosage ? " · " + record.dosage : ""}</span>}
          {record.notes && <span>{record.notes}</span>}
        </article>)}</div>}
    </Panel>
  </div>;
}
