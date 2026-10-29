// @ts-nocheck -- staged migration: preserve legacy runtime while explicit prop/data types are introduced.
import React, { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api/api.js";
import { useConfirmDialog } from "./ui/ConfirmDialog.tsx";
import { WeightChart } from "./components/WeightChart.tsx";

const arrayOf = value => Array.isArray(value) ? value : Object.values(value || {}).find(Array.isArray) || [];
const fmtDate = value => value ? new Intl.DateTimeFormat("it-IT", { dateStyle: "medium" }).format(new Date(value)) : "—";
const dtInput = value => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const pad = part => String(part).padStart(2, "0");
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + "T" + pad(date.getHours()) + ":" + pad(date.getMinutes());
};
const nullIfBlank = value => value === "" || value === undefined ? null : value;
const GRAMS_PER_UNIT = { g: 1, kg: 1000, oz: 28.349523125, lb: 453.59237 };
const fromGrams = (value, unit = "g") => Number(value) / (GRAMS_PER_UNIT[unit] || 1);
const toGrams = (value, unit = "g") => Number(value) * (GRAMS_PER_UNIT[unit] || 1);
const displayWeight = (value, unit = "g") => Number.isFinite(Number(value))
  ? fromGrams(value, unit).toLocaleString("it-IT", { maximumFractionDigits: 2 }) + " " + unit
  : "—";
const formData = e => Object.fromEntries(Array.from(new FormData(e.currentTarget).entries()).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));
const TAB_OPTIONS = [
  ["weights", "Peso"], ["sheds", "Mute"], ["notes", "Osservazioni"], ["feedings", "Alimentazioni"], ["genetics", "Genetica"]
];
const TITLES = { weights: "Peso", sheds: "Mute", notes: "Osservazioni", feedings: "Alimentazione", genetics: "Tratti genetici" };
const CREATE_LABELS = { weights: "Nuova pesata", sheds: "Nuova muta", notes: "Nuova nota", feedings: "Nuova sessione", genetics: "Nuovo tratto genetico" };
const SHED = [["complete", "Completa"], ["partial", "Parziale"], ["unknown", "Non valutata"]];
const FEED_OUTCOME = [["ate", "Ha mangiato"], ["refused", "Ha rifiutato"], ["not_offered", "Non offerto"], ["unknown", "Non noto"]];
function Button({ children, variant = "secondary", ...props }) { return <button className={"button " + variant} {...props}>{children}</button>; }
function Input({ label, name, type = "text", defaultValue, required = false, min, max, step, placeholder }) { return <label className="field"><span>{label}</span><input name={name} type={type} defaultValue={defaultValue ?? ""} required={required} min={min} max={max} step={step} placeholder={placeholder}/></label>; }
function Area({ label, name, defaultValue, required = false, rows = 3 }) { return <label className="field"><span>{label}</span><textarea name={name} defaultValue={defaultValue ?? ""} required={required} rows={rows}/></label>; }
function Select({ label, name, defaultValue, options, required = false }) { return <label className="field"><span>{label}</span><select name={name} defaultValue={defaultValue ?? ""} required={required}>{options.map(o => <option value={o[0]} key={o[0]}>{o[1]}</option>)}</select></label>; }
const emptyFeedingEntry = animalId => ({ animalId, outcome: "unknown", foodType: "Altro", foodSize: "", foodWeightG: "", notes: "" });

export function CareRecordsHub({ onNotice = () => {}, owner, initialTab = "weights", initialAnimalId = null, weightUnit = "g" }) {
  const confirmAction = useConfirmDialog();
  const [tab, setTab] = useState(TAB_OPTIONS.some(o => o[0] === initialTab) ? initialTab : "weights");
  const [animals, setAnimals] = useState([]);
  const [animalId, setAnimalId] = useState(initialAnimalId || "");
  const [animalsPage, setAnimalsPage] = useState(1);
  const [animalsPagination, setAnimalsPagination] = useState({ page: 1, pageSize: 100, total: 0, totalPages: 1 });
  const [records, setRecords] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [feedingEntries, setFeedingEntries] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [sessionBusy, setSessionBusy] = useState(false);

  const api = useCallback((path, options) => apiRequest(path, options), []);

  const loadAnimals = useCallback(async () => {
    const response = await apiRequest("animals?page=" + animalsPage + "&pageSize=100&status=active");
    let list = arrayOf(response.animals ?? response);
    if (initialAnimalId && !list.some(animal => animal.id === initialAnimalId)) {
      try {
        const detail = await apiRequest("animals/" + encodeURIComponent(initialAnimalId));
        const selected = detail.animal || detail;
        if (selected?.id) list = [selected, ...list];
      } catch { /* The record endpoint reports invalid identifiers or access errors. */ }
    }
    setAnimals(previous => Array.from(new Map([...previous, ...list].map(animal => [animal.id, animal])).values()));
    setAnimalsPagination(response.pagination || { page: animalsPage, pageSize: 100, total: list.length, totalPages: 1 });
    if (!animalId && list.length && tab !== "feedings") setAnimalId(initialAnimalId || list[0].id);
  }, [animalId, animalsPage, tab, initialAnimalId]);

  const loadSessionDetail = useCallback(async id => {
    if (!id) { setSelectedSession(null); return; }
    setSessionBusy(true);
    try {
      const response = await apiRequest("feeding-sessions/" + encodeURIComponent(id));
      setSelectedSession(response.session || null);
    } catch (e) {
      setError(e.message || "Impossibile caricare il dettaglio della sessione.");
    } finally { setSessionBusy(false); }
  }, []);

  const loadRecords = useCallback(async () => {
    if (!animalId && tab !== "feedings") { setRecords([]); setPagination({ page, pageSize: 25, total: 0, totalPages: 1 }); return; }
    setBusy(true); setError("");
    try {
      if (tab === "feedings") {
        const params = new URLSearchParams({ page: String(page), pageSize: "25" });
        if (animalId) params.set("animalId", animalId);
        const response = await apiRequest("feeding-sessions?" + params.toString());
        const sessions = arrayOf(response.sessions ?? response);
        setRecords(sessions);
        setPagination(response.pagination || { page, pageSize: 25, total: sessions.length, totalPages: 1 });
        if (selectedSession && !sessions.some(session => session.id === selectedSession.id)) setSelectedSession(null);
      } else {
        const endpoints = {
          weights: "animals/" + animalId + "/weights?page=" + page + "&pageSize=50",
          sheds: "animals/" + animalId + "/sheds?page=" + page + "&pageSize=50",
          notes: "animals/" + animalId + "/notes?page=" + page + "&pageSize=50",
          genetics: "animals/" + animalId + "/genetic-traits?page=" + page + "&pageSize=50"
        };
        const response = await apiRequest(endpoints[tab]);
        const key = tab === "weights" ? "weights" : tab === "sheds" ? "sheds" : tab === "notes" ? "notes" : "traits";
        const list = arrayOf(response[key] ?? response);
        setRecords(list);
        setPagination(response.pagination || { page, pageSize: 50, total: list.length, totalPages: 1 });
      }
    } catch (e) {
      setError(e.message || "Impossibile caricare i registri.");
    } finally { setBusy(false); }
  }, [animalId, tab, page, selectedSession]);

  useEffect(() => { void loadAnimals().catch(e => setError(e.message)); }, [loadAnimals]);
  useEffect(() => { if (initialAnimalId) { setAnimalId(initialAnimalId); setPage(1); } }, [initialAnimalId]);
  useEffect(() => { void loadRecords(); }, [loadRecords]);

  const changeTab = next => {
    setTab(next); setPage(1); setEditing(null); setCreateOpen(false);
    if (next === "feedings") { setAnimalId(""); setSelectedSession(null); }
    else if (!animalId && animals.length) setAnimalId(animals[0].id);
  };
  const updateFeeding = (id, patch) => setFeedingEntries(entries => entries.map(entry => entry.animalId === id ? { ...entry, ...patch } : entry));
  const toggleFeedingAnimal = (id, checked) => setFeedingEntries(entries => checked
    ? (entries.some(entry => entry.animalId === id) ? entries : [...entries, emptyFeedingEntry(id)])
    : entries.filter(entry => entry.animalId !== id));

  const submitNew = async e => {
    e.preventDefault(); const v = formData(e);
    let path = "", body = {};
    if (tab === "weights") {
      path = "animals/" + animalId + "/weights";
      body = { measuredAt: new Date(v.measuredAt).toISOString(), weightG: toGrams(Number(v.weightG), weightUnit), notes: nullIfBlank(v.notes) };
    } else if (tab === "sheds") {
      path = "animals/" + animalId + "/sheds";
      body = { occurredAt: new Date(v.occurredAt).toISOString(), outcome: v.outcome, notes: nullIfBlank(v.notes) };
    } else if (tab === "notes") {
      path = "animals/" + animalId + "/notes";
      body = { occurredAt: new Date(v.occurredAt).toISOString(), title: nullIfBlank(v.title), category: v.category || "general", body: v.body };
    } else if (tab === "feedings") {
      if (!feedingEntries.length) { onNotice("Seleziona almeno un animale per la sessione.", "error"); return; }
      path = "feeding-sessions";
      body = {
        performedAt: new Date(v.performedAt).toISOString(),
        notes: nullIfBlank(v.sessionNotes),
        entries: feedingEntries.map(entry => ({
          animalId: entry.animalId, outcome: entry.outcome, foodType: nullIfBlank(entry.foodType) || "Altro",
          foodSize: nullIfBlank(entry.foodSize), foodWeightG: entry.foodWeightG === "" || entry.foodWeightG == null ? null : Number(entry.foodWeightG),
          notes: nullIfBlank(entry.notes)
        }))
      };
    } else {
      path = "animals/" + animalId + "/genetic-traits";
      body = { traitName: v.traitName, traitValue: v.traitValue, sourceAnimalId: nullIfBlank(v.sourceAnimalId), confidenceNote: nullIfBlank(v.confidenceNote) };
    }
    try {
      const result = await api(path, { method: "POST", body }, "Nuovo registro: " + TITLES[tab]);
      setCreateOpen(false); setFeedingEntries([]);
      onNotice(tab === "feedings" ? "Sessione salvata per " + body.entries.length + " animali." : "Registro creato.", "success");
      await loadRecords();
      if (tab === "feedings" && result.session?.id) await loadSessionDetail(result.session.id);
    } catch (err) { onNotice(err.message, "error"); }
  };

  const submitEdit = async e => {
    e.preventDefault(); const v = formData(e);
    let path = "", body = {};
    if (tab === "weights") {
      path = "weights/" + editing.id;
      body = { measuredAt: new Date(v.measuredAt).toISOString(), weightG: toGrams(Number(v.weightG), weightUnit), notes: nullIfBlank(v.notes) };
    } else if (tab === "sheds") {
      path = "sheds/" + editing.id;
      body = { occurredAt: new Date(v.occurredAt).toISOString(), outcome: v.outcome, notes: nullIfBlank(v.notes) };
    } else if (tab === "notes") {
      path = "animal-notes/" + editing.id;
      body = { occurredAt: new Date(v.occurredAt).toISOString(), title: nullIfBlank(v.title), category: v.category, body: v.body };
    } else if (tab === "feedings") {
      path = "feeding-entries/" + editing.id;
      body = { outcome: v.outcome, foodType: nullIfBlank(v.foodType) || "Altro", foodSize: nullIfBlank(v.foodSize), foodWeightG: v.foodWeightG === "" ? null : Number(v.foodWeightG), notes: nullIfBlank(v.notes) };
    } else {
      path = "genetic-traits/" + editing.id;
      body = { traitName: v.traitName, traitValue: v.traitValue, sourceAnimalId: nullIfBlank(v.sourceAnimalId), confidenceNote: nullIfBlank(v.confidenceNote) };
    }
    try {
      const result = await api(path, { method: "PATCH", body }, "Modifica registro: " + TITLES[tab]);
      setEditing(null);
      onNotice("Registro aggiornato.", "success"); await loadRecords(); if (tab === "feedings" && selectedSession?.id) await loadSessionDetail(selectedSession.id);
    } catch (err) { onNotice(err.message, "error"); }
  };

  const remove = async record => {
    if (!(await confirmAction({ title: "Eliminare questo registro?", message: "L’operazione non è reversibile.", confirmLabel: "Elimina registro", danger: true }))) return;
    const endpoint = tab === "weights" ? "weights/" + record.id : tab === "sheds" ? "sheds/" + record.id :
      tab === "notes" ? "animal-notes/" + record.id : tab === "feedings" ? "feeding-entries/" + record.id : "genetic-traits/" + record.id;
    try {
      const result = await api(endpoint, { method: "DELETE", body: {} }, "Elimina registro: " + TITLES[tab]);
      onNotice("Registro eliminato.", "success"); await loadRecords(); if (tab === "feedings" && selectedSession?.id) await loadSessionDetail(selectedSession.id);
    } catch (err) { onNotice(err.message, "error"); }
  };

  const display = record => {
    if (tab === "weights") return { Data: fmtDate(record.measuredAt), Peso: displayWeight(record.weightG, weightUnit), Note: record.notes || "—" };
    if (tab === "sheds") return { Data: fmtDate(record.occurredAt), Esito: record.outcome || "—", Note: record.notes || "—" };
    if (tab === "notes") return { Data: fmtDate(record.occurredAt), Titolo: record.title || "—", Categoria: record.category, Nota: record.body };
    if (tab === "feedings") return { Data: fmtDate(record.performedAt), Animali: arrayOf(record.entries).map(entry => entry.animal?.name || animals.find(a => a.id === entry.animalId)?.name || "Animale").join(", ") || "—", Voci: arrayOf(record.entries).length, Note: record.notes || "—" };
    return { Tratto: record.traitName, Valore: record.traitValue, Confidenza: record.confidenceNote || "—", Fonte: animals.find(a => a.id === record.sourceAnimalId)?.name || "—" };
  };
  const target = editing || {};
  const optionsAnimals = [["", "Nessuno"], ...animals.map(a => [a.id, a.name + " · " + a.species])];
  const inputWeightStep = weightUnit === "kg" ? "0.001" : "0.01";
  const inputWeightMin = weightUnit === "kg" ? "0.001" : "0.01";
  const inputWeightMax = String(100000000 / (GRAMS_PER_UNIT[weightUnit] || 1));
  const openCreate = () => {
    setEditing(null);
    if (tab === "feedings") setFeedingEntries(animalId ? [emptyFeedingEntry(animalId)] : []);
    setCreateOpen(true);
  };
  const currentPage = pagination.page || page;
  const totalPages = Math.max(1, pagination.totalPages || 1);

  return <div className="advanced-stack">
    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">REGISTRI INDIVIDUALI</p><h2>Storico cure e alimentazioni</h2><p className="subheading">Sessioni alimentari multi-animale, dettagli per singola voce e paginazione dal server.</p></div><Button onClick={() => { void loadRecords(); if (selectedSession?.id) void loadSessionDetail(selectedSession.id); }}>↻ Aggiorna</Button></div>
      <div className="tab-strip" role="tablist" aria-label="Tipo di registro">{TAB_OPTIONS.map(([id, label]) => <button type="button" role="tab" aria-selected={tab === id} className={tab === id ? "tab-button active" : "tab-button"} key={id} onClick={() => changeTab(id)}>{label}</button>)}</div>
      <div className="form-grid record-filter">
        <label className="field form-full"><span>{tab === "feedings" ? "Filtra sessioni per animale (facoltativo)" : "Animale"}</span><select value={animalId} onChange={e => { setAnimalId(e.target.value); setPage(1); }}><option value="">{tab === "feedings" ? "Tutti gli animali" : "Seleziona animale"}</option>{animals.map(a => <option value={a.id} key={a.id}>{a.name} · {a.species}</option>)}</select></label>
      </div>
      {animalsPagination.totalPages > 1 && <div className="pagination-bar"><span className="muted">Animali per filtro: pagina {animalsPagination.page} di {animalsPagination.totalPages} · {animalsPagination.total} totali</span><div className="inline-actions"><Button disabled={animalsPage <= 1} onClick={() => setAnimalsPage(p => p - 1)}>← Animali precedenti</Button><Button disabled={animalsPage >= animalsPagination.totalPages} onClick={() => setAnimalsPage(p => p + 1)}>Altri animali →</Button></div></div>}
      {error && <p className="form-message" role="alert">{error}</p>}
      <div className="inline-actions record-tools"><Button variant="primary" onClick={openCreate} disabled={tab !== "feedings" && !animalId}>＋ {CREATE_LABELS[tab] || "Nuovo registro"}</Button>{busy && <span className="muted">Caricamento…</span>}</div>
      {createOpen && <div className="embedded-form"><form className="form-grid" onSubmit={submitNew} key={tab + "-create"}>
        <h3 className="form-full">Nuovo registro · {TITLES[tab]}</h3>
        {tab === "weights" && <><Input label="Data e ora" name="measuredAt" type="datetime-local" defaultValue={dtInput()} required/><Input label={"Peso (" + weightUnit + ")"} name="weightG" type="number" min={inputWeightMin} max={inputWeightMax} step={inputWeightStep} required/><div className="form-full"><Area label="Note" name="notes"/></div></>}
        {tab === "sheds" && <><Input label="Data e ora" name="occurredAt" type="datetime-local" defaultValue={dtInput()} required/><Select label="Esito" name="outcome" options={SHED} required/><div className="form-full"><Area label="Note" name="notes"/></div></>}
        {tab === "notes" && <><Input label="Data e ora" name="occurredAt" type="datetime-local" defaultValue={dtInput()} required/><Input label="Titolo" name="title"/><Input label="Categoria" name="category" defaultValue="general" required/><div className="form-full"><Area label="Osservazione" name="body" required/></div></>}
        {tab === "feedings" && <>
          <Input label="Data e ora della sessione" name="performedAt" type="datetime-local" defaultValue={dtInput()} required/>
          <div className="form-full"><Area label="Note comuni della sessione" name="sessionNotes"/></div>
          <div className="form-full"><h3>Seleziona tutti gli animali alimentati</h3><p className="muted">Ogni animale può avere esito, alimento e note diversi. La sessione viene registrata in un’unica operazione.</p><div className="feeding-animal-picker">{animals.map(animal => {
            const checked = feedingEntries.some(entry => entry.animalId === animal.id);
            return <label className="feeding-animal-option" key={animal.id}><input type="checkbox" checked={checked} onChange={e => toggleFeedingAnimal(animal.id, e.target.checked)}/><span><strong>{animal.name}</strong><small>{animal.species}{animal.identifier ? " · " + animal.identifier : ""}</small></span></label>;
          })}</div></div>
          {feedingEntries.map((entry, index) => {
            const animal = animals.find(item => item.id === entry.animalId);
            return <fieldset className="feeding-entry-form form-full" key={entry.animalId}><legend>{animal?.name || "Animale selezionato"}</legend><div className="form-grid">
              <label className="field"><span>Esito</span><select value={entry.outcome} onChange={e => updateFeeding(entry.animalId, { outcome: e.target.value })} required>{FEED_OUTCOME.map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label className="field"><span>Tipo alimento</span><input value={entry.foodType} maxLength="120" onChange={e => updateFeeding(entry.animalId, { foodType: e.target.value })} placeholder="Altro"/></label>
              <label className="field"><span>Dimensione</span><input value={entry.foodSize} maxLength="120" onChange={e => updateFeeding(entry.animalId, { foodSize: e.target.value })} placeholder="Es. ratto medio"/></label>
              <label className="field"><span>Peso alimento (g)</span><input type="number" min="0.01" max="1000000" step="0.01" value={entry.foodWeightG} onChange={e => updateFeeding(entry.animalId, { foodWeightG: e.target.value })}/></label>
              <div className="form-full"><label className="field"><span>Note per l’animale</span><textarea rows="2" maxLength="5000" value={entry.notes} onChange={e => updateFeeding(entry.animalId, { notes: e.target.value })}/></label></div>
              <div className="form-full"><Button type="button" variant="danger" onClick={() => toggleFeedingAnimal(entry.animalId, false)}>Rimuovi dalla sessione</Button></div>
            </div></fieldset>;
          })}
        </>}
        {tab === "genetics" && <><Input label="Nome tratto" name="traitName" required/><Input label="Valore / morph" name="traitValue" required/><Select label="Animale fonte (facoltativo)" name="sourceAnimalId" options={optionsAnimals}/><div className="form-full"><Area label="Nota sulla confidenza" name="confidenceNote"/></div></>}
        <div className="form-actions form-full"><Button type="button" onClick={() => { setCreateOpen(false); setFeedingEntries([]); }}>Annulla</Button><Button variant="primary" disabled={tab === "feedings" && feedingEntries.length === 0}>Salva</Button></div>
      </form></div>}
      {editing && <div className="embedded-form"><form className="form-grid" onSubmit={submitEdit}>
        <h3 className="form-full">Modifica registro · {TITLES[tab]}</h3>
        {tab === "weights" && <><Input label="Data e ora" name="measuredAt" type="datetime-local" defaultValue={dtInput(target.measuredAt)} required/><Input label={"Peso (" + weightUnit + ")"} name="weightG" type="number" min={inputWeightMin} max={inputWeightMax} step={inputWeightStep} defaultValue={fromGrams(target.weightG, weightUnit)} required/><div className="form-full"><Area label="Note" name="notes" defaultValue={target.notes}/></div></>}
        {tab === "sheds" && <><Input label="Data e ora" name="occurredAt" type="datetime-local" defaultValue={dtInput(target.occurredAt)} required/><Select label="Esito" name="outcome" defaultValue={target.outcome} options={SHED} required/><div className="form-full"><Area label="Note" name="notes" defaultValue={target.notes}/></div></>}
        {tab === "notes" && <><Input label="Data e ora" name="occurredAt" type="datetime-local" defaultValue={dtInput(target.occurredAt)} required/><Input label="Titolo" name="title" defaultValue={target.title}/><Input label="Categoria" name="category" defaultValue={target.category} required/><div className="form-full"><Area label="Osservazione" name="body" defaultValue={target.body} required/></div></>}
        {tab === "feedings" && <><Select label="Esito" name="outcome" defaultValue={target.outcome} options={FEED_OUTCOME} required/><Input label="Tipo di alimento" name="foodType" defaultValue={target.foodType || "Altro"}/><Input label="Dimensione" name="foodSize" defaultValue={target.foodSize}/><Input label="Peso alimento (g)" name="foodWeightG" type="number" min="0.01" max="1000000" step="0.01" defaultValue={target.foodWeightG}/><div className="form-full"><Area label="Note" name="notes" defaultValue={target.notes}/></div></>}
        {tab === "genetics" && <><Input label="Nome tratto" name="traitName" defaultValue={target.traitName} required/><Input label="Valore / morph" name="traitValue" defaultValue={target.traitValue} required/><Select label="Animale fonte (facoltativo)" name="sourceAnimalId" defaultValue={target.sourceAnimalId || ""} options={optionsAnimals}/><div className="form-full"><Area label="Nota sulla confidenza" name="confidenceNote" defaultValue={target.confidenceNote}/></div></>}
        <div className="form-actions form-full"><Button type="button" onClick={() => setEditing(null)}>Annulla</Button><Button variant="primary">Salva modifiche</Button></div>
      </form></div>}
      {!busy && records.length === 0 ? <div className="empty-state"><h3>Nessun registro trovato</h3><p>Seleziona un animale oppure crea una nuova registrazione. Non vengono generati dati dimostrativi.</p></div> :
        records.length > 0 && <div className="table-wrap"><table><thead><tr>{Object.keys(display(records[0])).map(key => <th key={key}>{key}</th>)}<th>Azioni</th></tr></thead><tbody>{records.map(record => <tr key={record.id}>{Object.entries(display(record)).map(([key, value]) => <td key={key}>{String(value)}</td>)}<td><div className="inline-actions">{tab === "feedings" ? <Button onClick={() => void loadSessionDetail(record.id)}>Dettagli sessione</Button> : <Button onClick={() => { setCreateOpen(false); setEditing(record); }}>Modifica</Button>}{tab !== "feedings" && <Button variant="danger" onClick={() => remove(record)}>Elimina</Button>}</div></td></tr>)}</tbody></table></div>}
      {tab === "weights" && animalId && <WeightChart points={records} unit={weightUnit} />}
      {tab === "feedings" && selectedSession && <section className="embedded-form"><div className="panel-heading"><div><p className="eyebrow">DETTAGLIO SESSIONE</p><h3>{fmtDate(selectedSession.performedAt)} · {arrayOf(selectedSession.entries).length} animali</h3><p className="subheading">{selectedSession.notes || "Nessuna nota comune"}</p></div><Button onClick={() => setSelectedSession(null)}>Chiudi dettagli</Button></div>{sessionBusy ? <p className="muted">Caricamento voci…</p> : <div className="table-wrap"><table><thead><tr><th>Animale</th><th>Esito</th><th>Alimento</th><th>Dimensione/peso</th><th>Note</th><th>Azioni</th></tr></thead><tbody>{arrayOf(selectedSession.entries).map(entry => <tr key={entry.id}><td>{entry.animal?.name || animals.find(a => a.id === entry.animalId)?.name || "—"}</td><td>{FEED_OUTCOME.find(([value]) => value === entry.outcome)?.[1] || entry.outcome}</td><td>{entry.foodType || "Altro"}</td><td>{entry.foodWeightG ? entry.foodWeightG + " g" : entry.foodSize || "—"}</td><td>{entry.notes || "—"}</td><td><div className="inline-actions"><Button onClick={() => { setCreateOpen(false); setEditing(entry); }}>Modifica voce</Button><Button variant="danger" onClick={() => void remove(entry)}>Elimina voce</Button></div></td></tr>)}</tbody></table></div>}</section>}
      {pagination.totalPages > 1 && <div className="pagination-bar"><span className="muted">Pagina {currentPage} di {totalPages} · {pagination.total} registri</span><div className="inline-actions"><Button disabled={currentPage <= 1 || busy} onClick={() => setPage(p => Math.max(1, p - 1))}>← Precedente</Button><Button disabled={currentPage >= totalPages || busy} onClick={() => setPage(p => p + 1)}>Successiva →</Button></div></div>}
    </section>
  </div>;
}
