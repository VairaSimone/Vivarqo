import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import type { Locale } from "../lib/domain";
import { Alert, Button, Field, Input, LoadingState, PageHeader, Panel, Select, Textarea } from "../components/ui";

type CompanionAnimal = { id: string; name: string; species: string };
type CompanionProfile = { microchip?: string | null; veterinarianName?: string | null; veterinaryClinic?: string | null; veterinaryPhone?: string | null; veterinaryEmail?: string | null; veterinaryAddress?: string | null; allergies?: string | null; chronicConditions?: string | null };
type Weight = { id: string; measuredAt: string; weightG: string | number; notes: string | null };
type CompanionDocument = { id: string; originalFilename: string; category: string; sizeBytes: string; createdAt: string };
type CareRecord = { id: string; animalId: string; kind: string; title: string; occurredAt: string; nextDueAt: string | null; completedAt?: string | null; dueStatus?: "none" | "overdue" | "imminent" | "future" | "upcoming" | "completed"; task?: { id: string; status: string } | null; provider: string | null; clinic?: string | null; treatmentStartAt?: string | null; treatmentEndAt?: string | null; isOngoing?: boolean; dosage: string | null; frequency?: string | null; notes: string | null; animal: CompanionAnimal };
const kinds = ["vaccination", "medication", "vet_visit", "parasite_prevention", "surgery", "grooming", "other"];

export function CompanionCarePage({ locale }: { locale: Locale }) {
  const it = locale === "it";
  const [animals, setAnimals] = useState<CompanionAnimal[]>([]);
  const [records, setRecords] = useState<CareRecord[]>([]);
  const [profile, setProfile] = useState<CompanionProfile>({});
  const [weights, setWeights] = useState<Weight[]>([]);
  const [documents, setDocuments] = useState<CompanionDocument[]>([]);
  const [weightKg, setWeightKg] = useState("");
  const [weightDate, setWeightDate] = useState(new Date().toISOString().slice(0, 10));
  const [weightNotes, setWeightNotes] = useState("");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentCategory, setDocumentCategory] = useState("veterinary_report");
  const [clinic, setClinic] = useState("");
  const [therapyStartAt, setTherapyStartAt] = useState("");
  const [therapyEndAt, setTherapyEndAt] = useState("");
  const [isOngoing, setIsOngoing] = useState(false);
  const [dueFilter, setDueFilter] = useState<"all" | "overdue" | "imminent" | "future" | "completed">("all");
  const [animalId, setAnimalId] = useState("");
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [kind, setKind] = useState("vaccination");
  const [title, setTitle] = useState("");
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 10));
  const [nextDueAt, setNextDueAt] = useState("");
  const [provider, setProvider] = useState("");
  const [dosage, setDosage] = useState("");
  const [frequency, setFrequency] = useState("");
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

  useEffect(() => {
    if (!animalId) { setProfile({}); setWeights([]); setDocuments([]); return; }
    let active = true;
    Promise.all([
      api.get<{ animal: { domainProfile?: CompanionProfile | null } }>("/animals/" + animalId),
      api.get<{ weights: Weight[] }>("/animals/" + animalId + "/weights?page=1&pageSize=50"),
      api.get<{ documents: CompanionDocument[] }>("/documents?animalId=" + animalId + "&page=1&pageSize=50"),
    ]).then(([animalResult, weightResult, documentResult]) => {
      if (!active) return;
      setProfile(animalResult.animal.domainProfile ?? {});
      setWeights(weightResult.weights);
      setDocuments(documentResult.documents);
    }).catch((reason: unknown) => { if (active) setError(reason instanceof ApiError ? reason.message : (it ? "Impossibile caricare la scheda sanitaria." : "Unable to load medical profile.")); });
    return () => { active = false; };
  }, [animalId, it]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); setNotice("");
    try {
      await api.patch("/animals/" + animalId, { domainProfile: { ...profile, microchip: profile.microchip || null, veterinarianName: profile.veterinarianName || null, veterinaryClinic: profile.veterinaryClinic || null, veterinaryPhone: profile.veterinaryPhone || null, veterinaryEmail: profile.veterinaryEmail || null, veterinaryAddress: profile.veterinaryAddress || null, allergies: profile.allergies || null, chronicConditions: profile.chronicConditions || null } });
      setNotice(it ? "Scheda sanitaria aggiornata." : "Medical profile updated.");
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : (it ? "Salvataggio non riuscito." : "Unable to save profile.")); }
    finally { setSaving(false); }
  }
  async function addWeight(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      await api.post("/animals/" + animalId + "/weights", { measuredAt: new Date(weightDate + "T12:00:00").toISOString(), weightG: Number(weightKg) * 1000, notes: weightNotes || null });
      const result = await api.get<{ weights: Weight[] }>("/animals/" + animalId + "/weights?page=1&pageSize=50");
      setWeights(result.weights); setWeightKg(""); setWeightNotes(""); setNotice(it ? "Peso registrato." : "Weight recorded.");
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : (it ? "Impossibile registrare il peso." : "Unable to record weight.")); }
    finally { setSaving(false); }
  }
  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!documentFile) return;
    setSaving(true); setError("");
    try {
      await api.upload("/documents", documentFile, { "X-Animal-Id": animalId, "X-Document-Category": documentCategory });
      const result = await api.get<{ documents: CompanionDocument[] }>("/documents?animalId=" + animalId + "&page=1&pageSize=50");
      setDocuments(result.documents); setDocumentFile(null); setNotice(it ? "Documento caricato." : "Document uploaded.");
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : (it ? "Caricamento non riuscito." : "Upload failed.")); }
    finally { setSaving(false); }
  }
  async function deleteDocument(document: CompanionDocument) {
    if (!window.confirm(it ? "Eliminare il documento selezionato?" : "Delete this document?")) return;
    setSaving(true); setError("");
    try { await api.delete("/documents/" + document.id); setDocuments((current) => current.filter((item) => item.id !== document.id)); setNotice(it ? "Documento eliminato." : "Document deleted."); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : (it ? "Eliminazione non riuscita." : "Delete failed.")); }
    finally { setSaving(false); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(""); setNotice("");
    try {
      const payload = {
        animalId, kind, title,
        occurredAt: new Date(occurredAt + "T12:00:00").toISOString(),
        nextDueAt: nextDueAt ? new Date(nextDueAt + "T12:00:00").toISOString() : null,
        provider: provider || null, clinic: clinic || null, dosage: dosage || null, frequency: frequency || null, notes: notes || null, treatmentStartAt: therapyStartAt ? new Date(therapyStartAt + "T12:00:00").toISOString() : null, treatmentEndAt: therapyEndAt ? new Date(therapyEndAt + "T12:00:00").toISOString() : null, isOngoing,
      };
      if (editingRecordId) {
        await api.patch("/companion-care/" + editingRecordId, {
          kind, title, occurredAt: payload.occurredAt, nextDueAt: payload.nextDueAt,
          provider: payload.provider, clinic: payload.clinic, dosage: payload.dosage, frequency: payload.frequency, notes: payload.notes, treatmentStartAt: payload.treatmentStartAt, treatmentEndAt: payload.treatmentEndAt, isOngoing: payload.isOngoing,
        });
      } else {
        await api.post("/companion-care", payload);
      }
      await reload();
      setEditingRecordId(null);
      setTitle(""); setNextDueAt(""); setProvider(""); setClinic(""); setDosage(""); setFrequency(""); setNotes(""); setTherapyStartAt(""); setTherapyEndAt(""); setIsOngoing(false);
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
    setProvider(record.provider ?? ""); setClinic(record.clinic ?? ""); setTherapyStartAt(record.treatmentStartAt ? new Date(record.treatmentStartAt).toISOString().slice(0,10) : ""); setTherapyEndAt(record.treatmentEndAt ? new Date(record.treatmentEndAt).toISOString().slice(0,10) : ""); setIsOngoing(Boolean(record.isOngoing));
    setDosage(record.dosage ?? ""); setFrequency(record.frequency ?? "");
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

  const chronologicalWeights = [...weights].reverse();
  const weightNumbers = chronologicalWeights.map((item) => Number(item.weightG) / 1000).filter(Number.isFinite);
  const weightMin = weightNumbers.length ? Math.min(...weightNumbers) : 0;
  const weightMax = weightNumbers.length ? Math.max(...weightNumbers) : 0;
  const weightSpan = weightMax - weightMin || 1;
  const weightPoints = chronologicalWeights.map((item, index) => ({
    x: chronologicalWeights.length < 2 ? 300 : 12 + index * 576 / (chronologicalWeights.length - 1),
    y: 112 - ((Number(item.weightG) / 1000 - weightMin) / weightSpan) * 96,
  }));
  const weightPath = weightPoints.map((point, index) => (index ? "L" : "M") + point.x.toFixed(1) + " " + point.y.toFixed(1)).join(" ");
  const activeTherapies = records.filter((record) => record.animalId === animalId && record.kind === "medication" && record.isOngoing && !record.completedAt);
  async function finishTherapy(record: CareRecord) {
    if (!window.confirm(it ? "Segnare questa terapia come terminata?" : "Mark this therapy as ended?")) return;
    setSaving(true); setError("");
    try {
      await api.patch("/companion-care/" + record.id, { isOngoing: false, treatmentEndAt: new Date().toISOString() });
      await reload();
      setNotice(it ? "Terapia terminata." : "Therapy ended.");
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : (it ? "Impossibile aggiornare la terapia." : "Unable to update therapy.")); }
    finally { setSaving(false); }
  }

  const veterinaryHistory = records.filter((record) => record.animalId === animalId && (record.provider || record.clinic));
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
            <Field label={it ? "Tipo evento" : "Event type"}><Select value={kind} onChange={(e) => { setKind(e.target.value); if (e.target.value !== "medication") setIsOngoing(false); }}>{kinds.map((value) => <option key={value} value={value}>{it ? ({vaccination:"Vaccinazione",medication:"Farmaco/terapia",vet_visit:"Visita veterinaria",parasite_prevention:"Antiparassitario",surgery:"Intervento",grooming:"Toelettatura",other:"Altro"} as Record<string,string>)[value] : value.replaceAll("_"," ")}</option>)}</Select></Field>
            <Field label={it ? "Descrizione" : "Title"}><Input required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label={it ? "Data evento" : "Event date"}><Input type="date" required value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} /></Field>
            <Field label={it ? "Prossima scadenza" : "Next due date"}><Input type="date" value={nextDueAt} onChange={(e) => setNextDueAt(e.target.value)} /></Field>
            <Field label={it ? "Veterinario" : "Veterinarian"}><Input maxLength={160} value={provider} onChange={(e) => setProvider(e.target.value)} /></Field><Field label={it ? "Struttura veterinaria" : "Veterinary clinic"}><Input maxLength={160} value={clinic} onChange={(e) => setClinic(e.target.value)} /></Field>
            <Field label={it ? "Dosaggio" : "Dosage"}><Input maxLength={120} value={dosage} onChange={(e) => setDosage(e.target.value)} /></Field>{kind === "medication" && <Field label={it ? "Frequenza" : "Frequency"}><Input maxLength={120} placeholder={it ? "es. 1 volta al giorno" : "e.g. once daily"} value={frequency} onChange={(e) => setFrequency(e.target.value)} /></Field>}{kind === "medication" && <><Field label={it ? "Inizio terapia" : "Therapy start"}><Input type="date" value={therapyStartAt} onChange={(e) => setTherapyStartAt(e.target.value)} /></Field><Field label={it ? "Fine terapia" : "Therapy end"}><Input type="date" value={therapyEndAt} onChange={(e) => setTherapyEndAt(e.target.value)} /></Field><label className="field"><span>{it ? "Terapia continuativa" : "Ongoing therapy"}</span><input type="checkbox" checked={isOngoing} onChange={(e) => setIsOngoing(e.target.checked)} /></label></>}
          </div>
          <Field label={it ? "Note" : "Notes"}><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <div className="modal-actions"><Button type="submit" disabled={saving || !animalId}>{saving ? (it ? "Salvataggio…" : "Saving…") : (editingRecordId ? (it ? "Salva modifiche" : "Save changes") : (it ? "Registra evento" : "Save event"))}</Button>
            {editingRecordId && <Button type="button" variant="secondary" disabled={saving} onClick={() => { setEditingRecordId(null); setTitle(""); setNextDueAt(""); setProvider(""); setClinic(""); setDosage(""); setNotes(""); setTherapyStartAt(""); setTherapyEndAt(""); setIsOngoing(false); }}>{it ? "Annulla" : "Cancel"}</Button>}</div>
        </form>}
    </Panel>
    {animalId && <>
      <Panel><h2>{it ? "Scheda sanitaria dell'animale" : "Animal medical profile"}</h2>
        <form className="form-stack" onSubmit={saveProfile}>
          <div className="form-grid">
            <Field label={it ? "Numero microchip" : "Microchip number"}><Input maxLength={40} value={profile.microchip ?? ""} onChange={(e) => setProfile((p) => ({...p,microchip:e.target.value}))} /></Field>
            <Field label={it ? "Veterinario di riferimento" : "Primary veterinarian"}><Input maxLength={160} value={profile.veterinarianName ?? ""} onChange={(e) => setProfile((p) => ({...p,veterinarianName:e.target.value}))} /></Field>
            <Field label={it ? "Struttura veterinaria" : "Veterinary clinic"}><Input maxLength={160} value={profile.veterinaryClinic ?? ""} onChange={(e) => setProfile((p) => ({...p,veterinaryClinic:e.target.value}))} /></Field>
            <Field label={it ? "Telefono veterinario" : "Veterinary phone"}><Input maxLength={40} value={profile.veterinaryPhone ?? ""} onChange={(e) => setProfile((p) => ({...p,veterinaryPhone:e.target.value}))} /></Field>
            <Field label="Email"><Input type="email" maxLength={254} value={profile.veterinaryEmail ?? ""} onChange={(e) => setProfile((p) => ({...p,veterinaryEmail:e.target.value}))} /></Field>
            <Field label={it ? "Indirizzo struttura" : "Clinic address"}><Input maxLength={300} value={profile.veterinaryAddress ?? ""} onChange={(e) => setProfile((p) => ({...p,veterinaryAddress:e.target.value}))} /></Field>
          </div>
          <Field label={it ? "Allergie" : "Allergies"}><Textarea rows={2} maxLength={5000} value={profile.allergies ?? ""} onChange={(e) => setProfile((p) => ({...p,allergies:e.target.value}))} /></Field>
          <Field label={it ? "Patologie e condizioni croniche" : "Conditions and chronic diseases"}><Textarea rows={3} maxLength={5000} value={profile.chronicConditions ?? ""} onChange={(e) => setProfile((p) => ({...p,chronicConditions:e.target.value}))} /></Field>
          <Button type="submit" disabled={saving}>{it ? "Salva scheda sanitaria" : "Save medical profile"}</Button>
        </form>
      </Panel>
      <Panel><h2>{it ? "Peso e andamento" : "Weight tracking"}</h2>
        <form className="form-grid" onSubmit={addWeight}>
          <Field label={it ? "Peso (kg)" : "Weight (kg)"}><Input type="number" min="0.001" max="250" step="0.001" required value={weightKg} onChange={(e) => setWeightKg(e.target.value)} /></Field>
          <Field label={it ? "Data misurazione" : "Measurement date"}><Input type="date" required value={weightDate} onChange={(e) => setWeightDate(e.target.value)} /></Field>
          <Field label={it ? "Note" : "Notes"}><Input value={weightNotes} onChange={(e) => setWeightNotes(e.target.value)} maxLength={5000} /></Field>
          <Button type="submit" disabled={saving}>{it ? "Registra peso" : "Save weight"}</Button>
        </form>
        {weights.length > 0 ? <><div className="ecosys-trend"><svg viewBox="0 0 600 132" role="img" aria-label={it ? "Andamento del peso in chilogrammi" : "Weight trend in kilograms"}><path d="M8 16H592 M8 64H592 M8 112H592" stroke="currentColor" opacity=".15" fill="none"/><path d={weightPath} stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>{weightPoints.map((point,index)=><circle key={index} cx={point.x} cy={point.y} r="3" fill="currentColor"/>)}</svg><div className="inline-actions"><span>{it ? "Minimo" : "Min"}: {weightMin.toFixed(3)} kg</span><span>{it ? "Massimo" : "Max"}: {weightMax.toFixed(3)} kg</span><span>{weights.length} {it ? "misurazioni" : "measurements"}</span></div></div><div className="ecosys-history">{[...weights].reverse().map((w) => <article className="ecosys-reading" key={w.id}><strong>{(Number(w.weightG)/1000).toFixed(3)} kg</strong><span>{new Date(w.measuredAt).toLocaleDateString(it ? "it-IT" : "en-GB")}</span>{w.notes && <span>{w.notes}</span>}</article>)}</div></> : <p>{it ? "Nessuna pesata registrata." : "No weight measurements yet."}</p>}
      </Panel>
      <Panel><h2>{it ? "Storico veterinari e strutture" : "Veterinarian and clinic history"}</h2>
        {veterinaryHistory.length === 0 ? <p>{it ? "Nessun veterinario o struttura registrati negli eventi sanitari." : "No veterinarians or clinics recorded in care events."}</p> :
          <div className="ecosys-history">{veterinaryHistory.map((record) => <article className="ecosys-reading" key={record.id}><strong>{record.provider || (it ? "Struttura veterinaria" : "Veterinary provider")}</strong><span>{record.clinic || (it ? "Struttura non indicata" : "Clinic not specified")} · {record.title}</span><span>{new Date(record.occurredAt).toLocaleDateString(it ? "it-IT" : "en-GB")}</span></article>)}</div>}
      </Panel>
      <Panel><h2>{it ? "Terapie continuative" : "Ongoing therapies"}</h2>
        {activeTherapies.length === 0 ? <p>{it ? "Nessuna terapia continuativa attiva." : "No active ongoing therapies."}</p> :
          <div className="ecosys-history">{activeTherapies.map((therapy) => <article className="ecosys-reading" key={therapy.id}><strong>{therapy.title}</strong><span>{[therapy.dosage, therapy.frequency].filter(Boolean).join(" · ") || (it ? "Dosaggio non indicato" : "Dosage not specified")}{therapy.treatmentStartAt ? " · " + (it ? "Dal " : "Since ") + new Date(therapy.treatmentStartAt).toLocaleDateString(it ? "it-IT" : "en-GB") : ""}</span>{therapy.provider && <span>{therapy.provider}{therapy.clinic ? " · " + therapy.clinic : ""}</span>}{therapy.notes && <span>{therapy.notes}</span>}<div className="inline-actions"><Button size="sm" variant="secondary" onClick={() => editRecord(therapy)}>{it ? "Modifica" : "Edit"}</Button><Button size="sm" variant="secondary" onClick={() => void finishTherapy(therapy)}>{it ? "Termina terapia" : "End therapy"}</Button></div></article>)}</div>}
      </Panel>
      <Panel><h2>{it ? "Documenti sanitari" : "Medical documents"}</h2>
        <form className="form-grid" onSubmit={uploadDocument}>
          <Field label={it ? "Tipo documento" : "Document type"}><Select value={documentCategory} onChange={(e) => setDocumentCategory(e.target.value)}><option value="veterinary_report">{it ? "Referto" : "Veterinary report"}</option><option value="prescription">{it ? "Ricetta" : "Prescription"}</option><option value="certificate">{it ? "Certificato" : "Certificate"}</option><option value="invoice">{it ? "Fattura" : "Invoice"}</option></Select></Field>
          <Field label={it ? "File (PDF/JPG/PNG/WebP, max 10 MB)" : "File (PDF/JPG/PNG/WebP, max 10 MB)"}><input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setDocumentFile(e.target.files?.[0] ?? null)} /></Field>
          <Button type="submit" disabled={saving || !documentFile}>{it ? "Carica documento" : "Upload document"}</Button>
        </form>
        {documents.length > 0 ? <div className="ecosys-history">{documents.map((doc) => <article className="ecosys-reading" key={doc.id}><strong>{doc.originalFilename}</strong><span>{({veterinary_report:it ? "Referto" : "Report",prescription:it ? "Ricetta" : "Prescription",certificate:it ? "Certificato" : "Certificate",invoice:it ? "Fattura" : "Invoice"} as Record<string,string>)[doc.category] ?? doc.category} · {(Number(doc.sizeBytes)/1024).toFixed(0)} KB</span><div className="inline-actions"><Button size="sm" onClick={() => void api.download("/documents/" + doc.id + "/download",doc.originalFilename)}>{it ? "Scarica" : "Download"}</Button><Button size="sm" variant="danger" disabled={saving} onClick={() => void deleteDocument(doc)}>{it ? "Elimina" : "Delete"}</Button></div></article>)}</div> : <p>{it ? "Nessun documento caricato." : "No documents uploaded."}</p>}
      </Panel>
    </>}
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
            {(record.provider || record.clinic) && <span>{[record.provider, record.clinic].filter(Boolean).join(" · ")}</span>}{record.dosage && <span>{record.dosage}</span>}{record.frequency && <span>{record.frequency}</span>}{record.isOngoing && <span>{it ? "Terapia continuativa attiva" : "Ongoing therapy"}</span>}
            {record.notes && <span>{record.notes}</span>}
            <div className="inline-actions">
              {status !== "completed" && record.task?.status === "open" && <Button size="sm" disabled={saving} onClick={async () => { setSaving(true); setError(""); try { await api.post("/tasks/" + record.task!.id + "/complete", {}); await reload(); setNotice(it ? "Scadenza segnata come completata." : "Due date marked as completed."); } catch (reason) { setError(reason instanceof ApiError ? reason.message : (it ? "Operazione non riuscita." : "Operation failed.")); } finally { setSaving(false); } }}>{it ? "Segna completata" : "Mark complete"}</Button>}
              <Button size="sm" variant="secondary" disabled={saving} onClick={() => editRecord(record)}>{it ? "Modifica" : "Edit"}</Button>
              <Button size="sm" variant="danger" disabled={saving} onClick={() => void deleteRecord(record)}>{it ? "Elimina" : "Delete"}</Button>
            </div>
          </article>;
        })}</div>}
    </Panel>
  </div>;
}
