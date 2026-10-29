import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "./api/api.js";

const arrayOf = value => Array.isArray(value) ? value : Object.values(value || {}).find(Array.isArray) || [];
const fmtDate = value => value ? new Intl.DateTimeFormat("it-IT", { dateStyle: "medium" }).format(new Date(value)) : "—";
const dtInput = value => value ? new Date(value).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16);
const inputDate = value => value ? new Date(value).toISOString().slice(0, 10) : "";
const nullIfBlank = value => value === "" || value === undefined ? null : value;
const formData = e => Object.fromEntries(Array.from(new FormData(e.currentTarget).entries()).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));
const TAB_OPTIONS = [
  ["weights", "Peso"], ["sheds", "Mute"], ["notes", "Osservazioni"], ["feedings", "Alimentazioni"], ["genetics", "Genetica"]
];
const TITLES = { weights: "Peso", sheds: "Muta", notes: "Osservazioni", feedings: "Alimentazione", genetics: "Tratti genetici" };
const SHED = [["complete", "Completa"], ["partial", "Parziale"], ["unknown", "Non valutata"]];
const FEED_OUTCOME = [["ate", "Ha mangiato"], ["refused", "Ha rifiutato"], ["not_offered", "Non offerto"], ["unknown", "Non noto"]];
function Button({ children, variant = "secondary", ...props }) { return <button className={"button " + variant} {...props}>{children}</button>; }
function Input({ label, name, type = "text", defaultValue, required = false, min, max, step, placeholder }) { return <label className="field"><span>{label}</span><input name={name} type={type} defaultValue={defaultValue ?? ""} required={required} min={min} max={max} step={step} placeholder={placeholder}/></label>; }
function Area({ label, name, defaultValue, required = false, rows = 3 }) { return <label className="field"><span>{label}</span><textarea name={name} defaultValue={defaultValue ?? ""} required={required} rows={rows}/></label>; }
function Select({ label, name, defaultValue, options, required = false }) { return <label className="field"><span>{label}</span><select name={name} defaultValue={defaultValue ?? ""} required={required}>{options.map(o => <option value={o[0]} key={o[0]}>{o[1]}</option>)}</select></label>; }

export function CareRecordsHub({ onNotice = () => {}, owner, initialTab = "weights" }) {
  const [tab, setTab] = useState(TAB_OPTIONS.some(o => o[0] === initialTab) ? initialTab : "weights");
  const [animals, setAnimals] = useState([]);
  const [animalId, setAnimalId] = useState("");
  const [records, setRecords] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);

  const api = useCallback((path, options, label) => apiRequest(path, {
    ...options,
    queueWhenOffline: Boolean(options?.method && options.method !== "GET"),
    offlineOwner: owner,
    offlineLabel: label
  }), [owner]);

  const loadAnimals = useCallback(async () => {
    const response = await apiRequest("animals?page=1&pageSize=100");
    const list = arrayOf(response.animals ?? response);
    setAnimals(list);
    if (!animalId && list.length) setAnimalId(list[0].id);
  }, [animalId]);

  const loadRecords = useCallback(async () => {
    if (!animalId && tab !== "feedings") { setRecords([]); return; }
    setBusy(true); setError("");
    try {
      if (tab === "feedings") {
        const response = await apiRequest("feeding-sessions?page=1&pageSize=100");
        const sessions = arrayOf(response.sessions ?? response);
        setRecords(sessions.flatMap(session => arrayOf(session.entries).map(entry => ({
          ...entry, sessionId: session.id, performedAt: session.performedAt, sessionNotes: session.notes
        })).filter(entry => !animalId || entry.animalId === animalId)));
      } else {
        const endpoints = {
          weights: "animals/" + animalId + "/weights?page=1&pageSize=100",
          sheds: "animals/" + animalId + "/sheds?page=1&pageSize=100",
          notes: "animals/" + animalId + "/notes?page=1&pageSize=100",
          genetics: "animals/" + animalId + "/genetic-traits?page=1&pageSize=100"
        };
        const response = await apiRequest(endpoints[tab]);
        const key = tab === "weights" ? "weights" : tab === "sheds" ? "sheds" : tab === "notes" ? "notes" : "traits";
        setRecords(arrayOf(response[key] ?? response));
      }
    } catch (e) {
      setError(e.message || "Impossibile caricare i registri.");
    } finally { setBusy(false); }
  }, [animalId, tab]);

  useEffect(() => { void loadAnimals().catch(e => setError(e.message)); }, []);
  useEffect(() => { void loadRecords(); }, [loadRecords]);
  useEffect(() => {
    const changed = () => { void loadRecords().catch(() => {}); };
    window.addEventListener("vivarqo:offline-queue-changed", changed);
    return () => window.removeEventListener("vivarqo:offline-queue-changed", changed);
  }, [loadRecords]);

  const submitNew = async e => {
    e.preventDefault(); const v = formData(e);
    let path = "", body = {};
    if (tab === "weights") {
      path = "animals/" + animalId + "/weights";
      body = { measuredAt: new Date(v.measuredAt).toISOString(), weightG: Number(v.weightG), notes: nullIfBlank(v.notes) };
    } else if (tab === "sheds") {
      path = "animals/" + animalId + "/sheds";
      body = { occurredAt: new Date(v.occurredAt).toISOString(), outcome: v.outcome, notes: nullIfBlank(v.notes) };
    } else if (tab === "notes") {
      path = "animals/" + animalId + "/notes";
      body = { occurredAt: new Date(v.occurredAt).toISOString(), title: nullIfBlank(v.title), category: v.category || "general", body: v.body };
    } else if (tab === "feedings") {
      path = "feeding-sessions";
      body = { performedAt: new Date(v.performedAt).toISOString(), notes: nullIfBlank(v.sessionNotes), entries: [{
        animalId, outcome: v.outcome, foodType: nullIfBlank(v.foodType), foodSize: nullIfBlank(v.foodSize),
        foodWeightG: v.foodWeightG === "" ? null : Number(v.foodWeightG), notes: nullIfBlank(v.notes)
      }] };
    } else {
      path = "animals/" + animalId + "/genetic-traits";
      body = { traitName: v.traitName, traitValue: v.traitValue, sourceAnimalId: nullIfBlank(v.sourceAnimalId), confidenceNote: nullIfBlank(v.confidenceNote) };
    }
    try {
      const result = await api(path, { method: "POST", body }, "Nuovo registro: " + TITLES[tab]);
      setCreateOpen(false);
      if (result.queuedOffline) onNotice("Registro conservato in coda sul dispositivo. Sarà sincronizzato al ritorno della connessione.", "warning");
      else { onNotice("Registro creato."); await loadRecords(); }
    } catch (err) { onNotice(err.message, "error"); }
  };

  const submitEdit = async e => {
    e.preventDefault(); const v = formData(e);
    let path = "", body = {};
    if (tab === "weights") {
      path = "weights/" + editing.id;
      body = { measuredAt: new Date(v.measuredAt).toISOString(), weightG: Number(v.weightG), notes: nullIfBlank(v.notes) };
    } else if (tab === "sheds") {
      path = "sheds/" + editing.id;
      body = { occurredAt: new Date(v.occurredAt).toISOString(), outcome: v.outcome, notes: nullIfBlank(v.notes) };
    } else if (tab === "notes") {
      path = "animal-notes/" + editing.id;
      body = { occurredAt: new Date(v.occurredAt).toISOString(), title: nullIfBlank(v.title), category: v.category, body: v.body };
    } else if (tab === "feedings") {
      path = "feeding-entries/" + editing.id;
      body = { outcome: v.outcome, foodType: nullIfBlank(v.foodType), foodSize: nullIfBlank(v.foodSize), foodWeightG: v.foodWeightG === "" ? null : Number(v.foodWeightG), notes: nullIfBlank(v.notes) };
    } else {
      path = "genetic-traits/" + editing.id;
      body = { traitName: v.traitName, traitValue: v.traitValue, sourceAnimalId: nullIfBlank(v.sourceAnimalId), confidenceNote: nullIfBlank(v.confidenceNote) };
    }
    try {
      const result = await api(path, { method: "PATCH", body }, "Modifica registro: " + TITLES[tab]);
      setEditing(null);
      if (result.queuedOffline) onNotice("Modifica conservata in coda sul dispositivo.", "warning");
      else { onNotice("Registro aggiornato."); await loadRecords(); }
    } catch (err) { onNotice(err.message, "error"); }
  };

  const remove = async record => {
    if (!window.confirm("Eliminare questo registro? L'operazione non è reversibile.")) return;
    const endpoint = tab === "weights" ? "weights/" + record.id : tab === "sheds" ? "sheds/" + record.id :
      tab === "notes" ? "animal-notes/" + record.id : tab === "feedings" ? "feeding-entries/" + record.id : "genetic-traits/" + record.id;
    try {
      const result = await api(endpoint, { method: "DELETE", body: {} }, "Elimina registro: " + TITLES[tab]);
      if (result.queuedOffline) onNotice("Eliminazione conservata in coda sul dispositivo.", "warning");
      else { onNotice("Registro eliminato."); await loadRecords(); }
    } catch (err) { onNotice(err.message, "error"); }
  };

  const display = record => {
    if (tab === "weights") return { Data: fmtDate(record.measuredAt), Peso: (record.weightG ?? "—") + " g", Note: record.notes || "—" };
    if (tab === "sheds") return { Data: fmtDate(record.occurredAt), Esito: record.outcome || "—", Note: record.notes || "—" };
    if (tab === "notes") return { Data: fmtDate(record.occurredAt), Titolo: record.title || "—", Categoria: record.category, Nota: record.body };
    if (tab === "feedings") return { Data: fmtDate(record.performedAt), Animale: record.animal?.name || animals.find(a => a.id === record.animalId)?.name || "—", Esito: record.outcome, Cibo: record.foodType || "—", Quantità: record.foodWeightG ? record.foodWeightG + " g" : record.foodSize || "—", Note: record.notes || "—" };
    return { Tratto: record.traitName, Valore: record.traitValue, Confidenza: record.confidenceNote || "—", Fonte: animals.find(a => a.id === record.sourceAnimalId)?.name || "—" };
  };
  const target = editing || {};
  const optionsAnimals = [["", "Nessuno"], ...animals.map(a => [a.id, a.name + " · " + a.species])];

  return <div className="advanced-stack">
    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">REGISTRI INDIVIDUALI</p><h2>Storico cure e alimentazioni</h2><p className="subheading">Ogni registro può essere modificato o eliminato. Le modifiche JSON compatibili possono essere accodate mentre il dispositivo è offline.</p></div><Button onClick={() => loadRecords()}>↻ Aggiorna</Button></div>
      <div className="tab-strip" role="tablist" aria-label="Tipo di registro">{TAB_OPTIONS.map(([id, label]) => <button type="button" role="tab" aria-selected={tab === id} className={tab === id ? "tab-button active" : "tab-button"} key={id} onClick={() => { setTab(id); setEditing(null); setCreateOpen(false); }}>{label}</button>)}</div>
      <div className="form-grid record-filter"><label className="field form-full"><span>Animale</span><select value={animalId} onChange={e => setAnimalId(e.target.value)}><option value="">Seleziona animale</option>{animals.map(a => <option value={a.id} key={a.id}>{a.name} · {a.species}</option>)}</select></label></div>
      {error && <p className="form-message" role="alert">{error}</p>}
      <div className="inline-actions record-tools"><Button variant="primary" onClick={() => { setEditing(null); setCreateOpen(v => !v); }} disabled={!animalId}>＋ Nuovo {TITLES[tab].toLowerCase()}</Button>{busy && <span className="muted">Caricamento…</span>}</div>
      {createOpen && <div className="embedded-form"><form className="form-grid" onSubmit={submitNew}>
        <h3 className="form-full">Nuovo registro · {TITLES[tab]}</h3>
        {tab === "weights" && <><Input label="Data e ora" name="measuredAt" type="datetime-local" defaultValue={dtInput()} required/><Input label="Peso in grammi" name="weightG" type="number" min="0.01" max="100000000" step="0.01" required/><div className="form-full"><Area label="Note" name="notes"/></div></>}
        {tab === "sheds" && <><Input label="Data e ora" name="occurredAt" type="datetime-local" defaultValue={dtInput()} required/><Select label="Esito" name="outcome" options={SHED} required/><div className="form-full"><Area label="Note" name="notes"/></div></>}
        {tab === "notes" && <><Input label="Data e ora" name="occurredAt" type="datetime-local" defaultValue={dtInput()} required/><Input label="Titolo" name="title"/><Input label="Categoria" name="category" defaultValue="general" required/><div className="form-full"><Area label="Osservazione" name="body" required/></div></>}
        {tab === "feedings" && <><Input label="Data e ora" name="performedAt" type="datetime-local" defaultValue={dtInput()} required/><Select label="Esito" name="outcome" options={FEED_OUTCOME} required/><Input label="Tipo di alimento" name="foodType" defaultValue="Altro"/><Input label="Dimensione" name="foodSize" placeholder="Es. ratto medio"/><Input label="Peso alimento (g)" name="foodWeightG" type="number" min="0.01" max="1000000" step="0.01"/><div className="form-full"><Area label="Note" name="notes"/></div><div className="form-full"><Area label="Note della sessione (facoltative)" name="sessionNotes"/></div></>}
        {tab === "genetics" && <><Input label="Nome tratto" name="traitName" required/><Input label="Valore / morph" name="traitValue" required/><Select label="Animale fonte (facoltativo)" name="sourceAnimalId" options={optionsAnimals}/><div className="form-full"><Area label="Nota sulla confidenza" name="confidenceNote"/></div></>}
        <div className="form-actions form-full"><Button type="button" onClick={() => setCreateOpen(false)}>Annulla</Button><Button variant="primary">Salva</Button></div>
      </form></div>}
      {editing && <div className="embedded-form"><form className="form-grid" onSubmit={submitEdit}>
        <h3 className="form-full">Modifica registro · {TITLES[tab]}</h3>
        {tab === "weights" && <><Input label="Data e ora" name="measuredAt" type="datetime-local" defaultValue={dtInput(target.measuredAt)} required/><Input label="Peso in grammi" name="weightG" type="number" min="0.01" max="100000000" step="0.01" defaultValue={target.weightG} required/><div className="form-full"><Area label="Note" name="notes" defaultValue={target.notes}/></div></>}
        {tab === "sheds" && <><Input label="Data e ora" name="occurredAt" type="datetime-local" defaultValue={dtInput(target.occurredAt)} required/><Select label="Esito" name="outcome" defaultValue={target.outcome} options={SHED} required/><div className="form-full"><Area label="Note" name="notes" defaultValue={target.notes}/></div></>}
        {tab === "notes" && <><Input label="Data e ora" name="occurredAt" type="datetime-local" defaultValue={dtInput(target.occurredAt)} required/><Input label="Titolo" name="title" defaultValue={target.title}/><Input label="Categoria" name="category" defaultValue={target.category} required/><div className="form-full"><Area label="Osservazione" name="body" defaultValue={target.body} required/></div></>}
        {tab === "feedings" && <><Select label="Esito" name="outcome" defaultValue={target.outcome} options={FEED_OUTCOME} required/><Input label="Tipo di alimento" name="foodType" defaultValue={target.foodType}/><Input label="Dimensione" name="foodSize" defaultValue={target.foodSize}/><Input label="Peso alimento (g)" name="foodWeightG" type="number" min="0.01" max="1000000" step="0.01" defaultValue={target.foodWeightG}/><div className="form-full"><Area label="Note" name="notes" defaultValue={target.notes}/></div></>}
        {tab === "genetics" && <><Input label="Nome tratto" name="traitName" defaultValue={target.traitName} required/><Input label="Valore / morph" name="traitValue" defaultValue={target.traitValue} required/><Select label="Animale fonte (facoltativo)" name="sourceAnimalId" defaultValue={target.sourceAnimalId || ""} options={optionsAnimals}/><div className="form-full"><Area label="Nota sulla confidenza" name="confidenceNote" defaultValue={target.confidenceNote}/></div></>}
        <div className="form-actions form-full"><Button type="button" onClick={() => setEditing(null)}>Annulla</Button><Button variant="primary">Salva modifiche</Button></div>
      </form></div>}
      {!busy && records.length === 0 ? <div className="empty-state"><h3>Nessun registro trovato</h3><p>Seleziona un animale oppure crea una nuova registrazione. Non vengono generati dati dimostrativi.</p></div> :
        records.length > 0 && <div className="table-wrap"><table><thead><tr>{Object.keys(display(records[0])).map(key => <th key={key}>{key}</th>)}<th>Azioni</th></tr></thead><tbody>{records.map(record => <tr key={record.id}>{Object.entries(display(record)).map(([key, value]) => <td key={key}>{String(value)}</td>)}<td><div className="inline-actions"><Button onClick={() => { setCreateOpen(false); setEditing(record); }}>Modifica</Button><Button variant="danger" onClick={() => remove(record)}>Elimina</Button></div></td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}