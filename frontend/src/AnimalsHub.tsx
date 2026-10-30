import React, { useCallback, useEffect, useState } from "react";
import type { AnyRecord, CommonHubProps } from "./types";
import { Button, Input, Select } from "./ui/FormControls";
import { apiRequest } from "./api/api";
import { Icon } from "./ui/Icon";
import { useConfirmDialog } from "./ui/ConfirmDialog";

const arrayOf = (value: unknown): AnyRecord[] => Array.isArray(value) ? value as AnyRecord[] : [];
const sexOptions = [["unknown", "Non specificato"], ["female", "Femmina"], ["male", "Maschio"]];
const statusOptions = [["active", "Attivo"], ["sold", "Venduto"], ["transferred", "Trasferito"], ["deceased", "Deceduto"]];
const dateLabel = (value?: string | Date | null) => value ? new Intl.DateTimeFormat("it-IT", { dateStyle: "medium" }).format(new Date(value)) : "—";
const cleanAnimal = (raw: AnyRecord): AnyRecord => ({
  name: String(raw.name || "").trim(),
  identifier: String(raw.identifier || "").trim() || null,
  species: String(raw.species || "").trim(),
  sex: raw.sex || "unknown",
  morph: String(raw.morph || "").trim() || null,
  geneticsNotes: String(raw.geneticsNotes || "").trim() || null,
  birthDate: raw.birthDate || null,
  birthDateEstimated: raw.birthDateEstimated === true || raw.birthDateEstimated === "on",
  acquiredDate: raw.acquiredDate || null,
  originDescription: String(raw.originDescription || "").trim() || null,
  previousBreeder: String(raw.previousBreeder || "").trim() || null,
  locationLabel: String(raw.locationLabel || "").trim() || null,
  notes: String(raw.notes || "").trim() || null,
  ...(raw.status ? { status: raw.status } : {})
});
const emptyBulkRow = () => ({ name: "", identifier: "", species: "", sex: "unknown", morph: "", birthDate: "", locationLabel: "", status: "active" });

function historyDescription(item: AnyRecord): string {
  const record = item?.record || {};
  if (item?.type === "feeding") return [record.outcome, record.foodType || "Altro", record.foodWeightG ? record.foodWeightG + " g" : record.foodSize, record.notes, record.session?.notes].filter(Boolean).join(" · ") || "Alimentazione registrata";
  if (item?.type === "weight") return [record.weightG != null ? record.weightG + " g" : "", record.notes].filter(Boolean).join(" · ") || "Pesata registrata";
  if (item?.type === "shed") return [record.outcome, record.notes].filter(Boolean).join(" · ") || "Muta registrata";
  if (item?.type === "note") return [record.title, record.body, record.category].filter(Boolean).join(" · ") || "Nota";
  return "Registro";
}

export function AnimalsHub({ owner, onNotice = () => {}, onGo = () => {}, initialAnimalId = null }: CommonHubProps) {
  const confirmAction = useConfirmDialog();
  const [animals, setAnimals] = useState<AnyRecord[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("active");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const emptyFilters = { species: "", sex: "", morph: "", location: "", sort: "updatedAt" };
  const [filterDraft, setFilterDraft] = useState(emptyFilters);
  const [filters, setFilters] = useState(emptyFilters);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<AnyRecord | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRows, setBulkRows] = useState<AnyRecord[]>([emptyBulkRow()]);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<AnyRecord | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [upcomingTasks, setUpcomingTasks] = useState<AnyRecord[]>([]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "50", status, sort: filters.sort });
      if (debouncedQuery.trim()) params.set("q", debouncedQuery.trim());
      if (filters.species.trim()) params.set("species", filters.species.trim());
      if (filters.sex) params.set("sex", filters.sex);
      if (filters.morph.trim()) params.set("morph", filters.morph.trim());
      if (filters.location.trim()) params.set("location", filters.location.trim());
      const response = await apiRequest("animals?" + params.toString());
      setAnimals(arrayOf(response.animals));
      setPagination(response.pagination || { page, pageSize: 50, total: arrayOf(response.animals).length, totalPages: 1 });
    } catch (err) {
      setError(err.message || "Impossibile caricare gli animali.");
    } finally { setBusy(false); }
  }, [page, debouncedQuery, status, filters]);

  useEffect(() => { void load(); }, [load]);

  const run = async (label, operation) => {
    setSaving(true);
    try {
      await operation();
      onNotice(label, "success");
      setEditor(null); setBulkOpen(false);
      await load();
    } catch (err) { onNotice(err.message || "Operazione non riuscita.", "error"); }
    finally { setSaving(false); }
  };
  const submitEditor = event => {
    event.preventDefault();
    const body = cleanAnimal(Object.fromEntries(new FormData(event.currentTarget).entries()));
    if (!body.name || !body.species) return onNotice("Nome e specie sono obbligatori.", "error");
    const current = editor?.animal;
    void run(current ? "Scheda animale aggiornata." : "Animale creato.", () =>
      apiRequest(current ? "animals/" + current.id : "animals", { method: current ? "PATCH" : "POST", body })
    );
  };
  const submitBulk = event => {
    event.preventDefault();
    const animalsToCreate = bulkRows.filter(row => row.name.trim() || row.species.trim()).map(cleanAnimal);
    if (!animalsToCreate.length) return onNotice("Inserisci almeno un animale.", "error");
    const invalid = animalsToCreate.findIndex(animal => !animal.name || !animal.species);
    if (invalid >= 0) return onNotice("Ogni riga compilata deve avere nome e specie.", "error");
    const ids = animalsToCreate.map(animal => animal.identifier?.toLocaleLowerCase("it-IT")).filter(Boolean);
    if (new Set(ids).size !== ids.length) return onNotice("Ci sono identificativi duplicati nel gruppo.", "error");
    void run(animalsToCreate.length + " animali creati.", () =>
      apiRequest("animals/bulk", { method: "POST", body: { animals: animalsToCreate } })
    );
  };
  const archive = async animal => {
    if (!(await confirmAction({ title: "Archiviare " + animal.name + "?", message: "La scheda verrà archiviata, non eliminata. Potrai ripristinarla in seguito.", confirmLabel: "Archivia scheda", danger: true }))) return;
    void run("Animale archiviato.", () => apiRequest("animals/" + animal.id + "/archive", { method: "POST", body: {} }));
  };
  const restore = async animal => {
    if (!(await confirmAction({ title: "Ripristinare " + animal.name + "?", message: "La scheda tornerà disponibile fra gli animali attivi.", confirmLabel: "Ripristina", danger: false }))) return;
    void run("Animale ripristinato.", () => apiRequest("animals/" + animal.id + "/restore", { method: "POST", body: {} }));
  };
  const remove = async animal => {
    if (!(await confirmAction({ title: "Eliminare " + animal.name + "?", message: "L’eliminazione è definitiva. Se esistono registri collegati, il server potrebbe impedirla.", confirmLabel: "Elimina definitivamente", danger: true }))) return;
    void run("Animale eliminato.", () => apiRequest("animals/" + animal.id, { method: "DELETE" }));
  };
  useEffect(() => {
    if (!initialAnimalId) return;
    let cancelled = false;
    apiRequest("animals/" + encodeURIComponent(initialAnimalId))
      .then(response => {
        if (cancelled) return;
        const animal = response.animal || response;
        if (animal?.id) void loadAnimalHistory(animal, 1);
      })
      .catch(error => { if (!cancelled) onNotice(error.message || "Impossibile aprire la scheda animale.", "error"); });
    return () => { cancelled = true; };
  }, [initialAnimalId]);

  const changeStatus = next => { setStatus(next); setPage(1); };
  const changeQuery = next => { setQuery(next); setPage(1); };
  const applyFilters = event => {
    event.preventDefault();
    setFilters({ ...filterDraft });
    setPage(1);
  };
  const resetFilters = () => {
    const reset = { species: "", sex: "", morph: "", location: "", sort: "updatedAt" };
    setFilterDraft(reset);
    setFilters(reset);
    setPage(1);
  };
  const loadAnimalHistory = async (animal, nextPage = 1) => {
    setHistoryLoading(true);
    setHistoryPage(nextPage);
    setHistory({ animal, page: nextPage, items: [], pagination: null });
    if (nextPage === 1) setUpcomingTasks([]);
    try {
      const [response, tasksResponse] = await Promise.all([
        apiRequest("animals/" + encodeURIComponent(animal.id) + "/history?page=" + nextPage + "&pageSize=50"),
        nextPage === 1
          ? apiRequest("tasks?animalId=" + encodeURIComponent(animal.id) + "&status=open&page=1&pageSize=5").catch(() => null)
          : Promise.resolve(null)
      ]);
      if (tasksResponse) setUpcomingTasks(arrayOf(tasksResponse.tasks).filter(task => task?.dueAt).slice(0, 5));
      setHistory({ animal, page: nextPage, items: arrayOf(response.items), pagination: response.pagination || { page: nextPage, pageSize: 50, total: arrayOf(response.items).length, truncated: false } });
    } catch (err) {
      setHistory(null);
      onNotice(err.message || "Impossibile caricare lo storico dell'animale.", "error");
    } finally { setHistoryLoading(false); }
  };

  return <div className="advanced-stack">
    <section className="panel records-panel">
      <div className="panel-heading"><div><p className="eyebrow">ANAGRAFICA</p><h2>Animali</h2><p className="subheading">Cerca, modifica, archivia o ripristina le schede. Le liste sono paginate dal server.</p></div><div className="inline-actions"><Button onClick={() => { setEditor({ animal: null }); setBulkOpen(false); }}>＋ Nuovo animale</Button><Button variant="primary" onClick={() => { setBulkOpen(v => !v); setEditor(null); }}>＋ Crea in blocco</Button></div></div>
      <div className="record-tools inline-actions">
        <label className="field"><span>Stato schede</span><select value={status} onChange={e => changeStatus(e.target.value)}><option value="active">Attivi</option><option value="sold">Venduti</option><option value="transferred">Trasferiti</option><option value="deceased">Deceduti</option><option value="archived">Archiviati</option><option value="all">Tutti gli stati</option></select></label>
        <label className="field"><span>Cerca per nome o identificativo</span><input type="search" value={query} onChange={e => changeQuery(e.target.value)} placeholder="Nome o codice…"/></label>
        <Button onClick={() => void load()}>↻ Aggiorna</Button>
      </div>
      <details className="record-filter-drawer">
        <summary>Filtri avanzati e ordinamento</summary>
        <form className="form-grid" onSubmit={applyFilters}>
          <Input label="Specie" name="filterSpecies" value={filterDraft.species} onChange={e => setFilterDraft(current => ({ ...current, species: e.target.value }))} maxLength={160}/>
          <label className="field"><span>Sesso</span><select aria-label="Filtra per sesso" value={filterDraft.sex} onChange={e => setFilterDraft(current => ({ ...current, sex: e.target.value }))}><option value="">Tutti</option>{sexOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <Input label="Morph" name="filterMorph" value={filterDraft.morph} onChange={e => setFilterDraft(current => ({ ...current, morph: e.target.value }))} maxLength={200}/>
          <Input label="Posizione / stabulazione" name="filterLocation" value={filterDraft.location} onChange={e => setFilterDraft(current => ({ ...current, location: e.target.value }))} maxLength={160}/>
          <label className="field"><span>Ordina per</span><select aria-label="Ordina elenco animali" value={filterDraft.sort} onChange={e => setFilterDraft(current => ({ ...current, sort: e.target.value }))}><option value="name">Nome</option><option value="createdAt">Data di creazione</option><option value="updatedAt">Ultima attività</option></select></label>
          <div className="form-actions form-full"><Button type="button" variant="secondary" onClick={resetFilters}>Azzera filtri</Button><Button type="submit" variant="primary">Applica filtri</Button></div>
        </form>
      </details>
      {error && <p className="form-message" role="alert">{error}</p>}
      {editor && <div className="embedded-form"><form className="form-grid" onSubmit={submitEditor} key={editor.animal?.id || "new-animal"}>
        <h3 className="form-full">{editor.animal ? "Modifica scheda" : "Nuova scheda animale"}</h3>
        <Input label="Nome" name="name" defaultValue={editor.animal?.name} required maxLength={120}/>
        <Input label="Specie" name="species" defaultValue={editor.animal?.species} required maxLength={160}/>
        <Input label="Identificativo" name="identifier" defaultValue={editor.animal?.identifier} maxLength={120}/>
        <Select label="Sesso" name="sex" defaultValue={editor.animal?.sex || "unknown"} options={sexOptions}/>
        <Input label="Morph" name="morph" defaultValue={editor.animal?.morph} maxLength={200}/>
        <Input label="Annotazioni genetiche dichiarate" name="geneticsNotes" defaultValue={editor.animal?.geneticsNotes} maxLength={10000}/>
        <Input label="Data di nascita" name="birthDate" type="date" defaultValue={editor.animal?.birthDate ? String(editor.animal.birthDate).slice(0, 10) : ""}/>
        <label className="checkbox-field form-full"><input type="checkbox" name="birthDateEstimated" defaultChecked={Boolean(editor.animal?.birthDateEstimated)}/><span>La data di nascita è stimata</span></label>
        <Input label="Data di acquisizione" name="acquiredDate" type="date" defaultValue={editor.animal?.acquiredDate ? String(editor.animal.acquiredDate).slice(0, 10) : ""}/>
        <Input label="Allevatore precedente" name="previousBreeder" defaultValue={editor.animal?.previousBreeder} maxLength={160}/>
        <label className="field form-full"><span>Provenienza</span><textarea name="originDescription" defaultValue={editor.animal?.originDescription || ""} rows={2} maxLength={5000}/></label>
        <Input label="Stabulazione / posizione" name="locationLabel" defaultValue={editor.animal?.locationLabel} maxLength={160}/>
        {editor.animal?.status !== "archived" && <Select label="Stato" name="status" defaultValue={editor.animal?.status || "active"} options={statusOptions}/>}
        <label className="field form-full"><span>Note</span><textarea name="notes" defaultValue={editor.animal?.notes || ""} rows={3} maxLength={10000}/></label>
        <div className="form-actions form-full"><Button type="button" onClick={() => setEditor(null)}>Annulla</Button><Button variant="primary" disabled={saving}>{saving ? "Salvataggio…" : "Salva scheda"}</Button></div>
      </form></div>}
      {bulkOpen && <div className="embedded-form"><form onSubmit={submitBulk}>
        <div className="panel-heading"><div><h3>Crea più animali</h3><p className="subheading">Ogni riga diventa una scheda. Nome e specie sono obbligatori; gli identificativi devono essere univoci.</p></div><Button type="button" onClick={() => setBulkRows(rows => rows.length < 500 ? [...rows, emptyBulkRow()] : rows)} disabled={bulkRows.length >= 500}>＋ Riga</Button></div>
        <div className="table-wrap"><table><thead><tr><th>Nome *</th><th>Specie *</th><th>Identificativo</th><th>Sesso</th><th>Stato</th><th>Morph</th><th>Data nascita</th><th>Posizione</th><th></th></tr></thead><tbody>
          {bulkRows.map((row, index) => <tr key={index}>
            {["name", "species", "identifier"].map(name => <td key={name}><input className="compact-input" aria-label={name} value={row[name]} required={name !== "identifier" && Boolean(row.name || row.species || row.identifier)} onChange={e => setBulkRows(rows => rows.map((item, i) => i === index ? { ...item, [name]: e.target.value } : item))}/></td>)}
            <td><select className="compact-input" value={row.sex} onChange={e => setBulkRows(rows => rows.map((item, i) => i === index ? { ...item, sex: e.target.value } : item))}>{sexOptions.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></td>
            <td><select className="compact-input" value={row.status} onChange={e => setBulkRows(rows => rows.map((item, i) => i === index ? { ...item, status: e.target.value } : item))}>{statusOptions.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></td>
            {["morph", "birthDate", "locationLabel"].map(name => <td key={name}><input className="compact-input" type={name === "birthDate" ? "date" : "text"} aria-label={name} value={row[name]} onChange={e => setBulkRows(rows => rows.map((item, i) => i === index ? { ...item, [name]: e.target.value } : item))}/></td>)}
            <td><Button type="button" variant="danger" onClick={() => setBulkRows(rows => rows.length > 1 ? rows.filter((_, i) => i !== index) : [emptyBulkRow()])}>Rimuovi</Button></td>
          </tr>)}
        </tbody></table></div>
        <div className="form-actions"><Button type="button" onClick={() => setBulkOpen(false)}>Annulla</Button><Button variant="primary" disabled={saving}>{saving ? "Creazione…" : "Crea " + bulkRows.length + " righe"}</Button></div>
      </form></div>}
      {busy ? <div className="loading">Caricamento animali…</div> : animals.length === 0 ? <div className="empty-state"><h3>Nessun animale in questa vista</h3><p>Crea una scheda oppure modifica il filtro di stato.</p></div> :
      <div className="animal-grid">{animals.map(animal => <article className="animal-card" key={animal.id}>
       <div className="animal-card-top"><span className="animal-avatar" aria-hidden="true">{String(animal.name||"?").slice(0,1).toLocaleUpperCase("it-IT")}</span><div className="animal-title-block"><h3>{animal.name}</h3><p>{animal.species}{animal.identifier ? " · "+animal.identifier : ""}</p></div><span className={"pill "+(animal.status==="active"?"sage":"")}>{animal.status==="archived"?"Archiviato":animal.status==="active"||!animal.status?"Attivo":animal.status==="sold"?"Venduto":animal.status==="transferred"?"Trasferito":animal.status==="deceased"?"Deceduto":animal.status}</span></div>
       <dl className="animal-facts"><div><dt>Sesso</dt><dd>{sexOptions.find(([key])=>key===animal.sex)?.[1]||"Non specificato"}</dd></div><div><dt>Morph</dt><dd>{animal.morph||"—"}</dd></div><div><dt>Nascita</dt><dd>{dateLabel(animal.birthDate)}{animal.birthDateEstimated ? " · stimata" : ""}</dd></div><div><dt>Stabulazione</dt><dd>{animal.locationLabel||"—"}</dd></div></dl>
       <div className="animal-card-actions"><Button variant="primary" onClick={()=>onGo("animali",{animalId:animal.id})}><Icon name="animals" size={16}/> Apri scheda</Button><Button onClick={()=>{setEditor({animal});setBulkOpen(false);}}>Modifica</Button><details className="animal-more-actions"><summary>Altro</summary><div>{animal.status==="archived"?<Button variant="primary" onClick={()=>restore(animal)}>Ripristina</Button>:<Button onClick={()=>archive(animal)}>Archivia</Button>}<Button variant="danger" onClick={()=>remove(animal)}>Elimina</Button></div></details></div>
      </article>)}</div>}
      <div className="pagination-bar"><span className="muted">Pagina {pagination.page || page} di {Math.max(1, pagination.totalPages || 1)} · {pagination.total ?? animals.length} animali</span><div className="inline-actions"><Button disabled={page <= 1 || busy} onClick={() => setPage(p => Math.max(1, p - 1))}>← Precedente</Button><Button disabled={page >= (pagination.totalPages || 1) || busy} onClick={() => setPage(p => p + 1)}>Successiva →</Button></div></div>
    </section>
      {history && <section className="panel animal-profile-panel">
        <div className="panel-heading"><div><p className="eyebrow">SCHEDA INDIVIDUALE</p><h2>{history.animal.name}</h2><p className="subheading">{history.animal.species}{history.animal.identifier ? " · "+history.animal.identifier : ""} · {history.animal.morph||"Morph non indicato"} · {sexOptions.find(([key])=>key===history.animal.sex)?.[1]||"Sesso non indicato"}</p></div><Button onClick={() => setHistory(null)}>Chiudi scheda</Button></div>
        <div className="animal-profile-summary">{[
          ["Prossima attività",upcomingTasks[0],task=>dateLabel(task.dueAt),task=>task.title+(new Date(task.dueAt)<new Date()?" · In ritardo":"")],
          ["Ultimo pasto",history.items.find(item=>item.type==="feeding"),item=>dateLabel(item.occurredAt),item=>historyDescription(item)],
          ["Ultima pesata",history.items.find(item=>item.type==="weight"),item=>dateLabel(item.occurredAt),item=>historyDescription(item)],
          ["Ultima muta",history.items.find(item=>item.type==="shed"),item=>dateLabel(item.occurredAt),item=>historyDescription(item)],
          ["Nota recente",history.items.find(item=>item.type==="note"),item=>dateLabel(item.occurredAt),item=>historyDescription(item)]
        ].map(([label,item,dateText,description])=><div className="animal-profile-metric" key={label}><small>{label}</small><strong>{item?dateText(item):(label==="Prossima attività"?"Nessuna scadenza":"Nessun dato")}</strong><span className="muted">{item?String(description(item)).slice(0,110):label==="Prossima attività"?"Nessun promemoria aperto":"Non registrato"}</span></div>)}</div>
        <div className="inline-actions profile-actions"><Button onClick={()=>{setEditor({animal:history.animal});setBulkOpen(false);}}><Icon name="edit" size={15}/> Modifica scheda</Button><Button onClick={()=>onGo("alimentazioni",{animalId:history.animal.id})}><Icon name="feeding" size={15}/> Registra pasto</Button><Button onClick={()=>onGo("peso",{animalId:history.animal.id})}><Icon name="weight" size={15}/> Registra peso</Button><Button onClick={()=>onGo("mute",{animalId:history.animal.id})}><Icon name="care" size={15}/> Registra muta</Button><Button onClick={()=>onGo("note",{animalId:history.animal.id})}><Icon name="documents" size={15}/> Aggiungi nota</Button></div>
        <div className="panel-heading profile-history-heading"><div><p className="eyebrow">STORICO</p><h2>Registrazioni recenti</h2><p className="subheading">Alimentazioni, pesate, mute e note in ordine cronologico.</p></div></div>
        {historyLoading ? <p className="loading">Caricamento storico…</p> : history.items.length === 0 ? <div className="empty-state"><h3>Nessuna registrazione</h3><p>Non risultano alimentazioni, pesate, mute o note per questo animale.</p></div> : <div className="animal-history-list">{history.items.map((item,index)=><article className="animal-history-item" key={(item.record?.id||index)+"-"+item.type}><time>{dateLabel(item.occurredAt)}</time><div><strong>{{feeding:"Alimentazione",weight:"Pesata",shed:"Muta",note:"Nota"}[item.type]||item.type}</strong><p>{historyDescription(item)}</p></div></article>)}</div>}
        {history.pagination?.truncated && <p className="notice warning">Per ogni categoria il backend carica al massimo 100 record nello storico unificato: le registrazioni più vecchie oltre tale limite potrebbero non comparire.</p>}
        <div className="pagination-bar"><span className="muted">Pagina {historyPage} · {history.pagination?.total ?? history.items.length} record restituiti</span><div className="inline-actions"><Button disabled={historyPage <= 1 || historyLoading} onClick={() => void loadAnimalHistory(history.animal, historyPage - 1)}>← Precedente</Button><Button disabled={historyLoading || history.items.length < 50 || (historyPage > 1 && historyPage >= Math.ceil((history.pagination?.total || 0) / 50))} onClick={() => void loadAnimalHistory(history.animal, historyPage + 1)}>Successiva →</Button></div></div>
      </section>}
  </div>;
}
