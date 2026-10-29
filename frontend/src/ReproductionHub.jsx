import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "./api/api.js";

const arrayOf = value => Array.isArray(value) ? value : Object.values(value || {}).find(Array.isArray) || [];
const dateValue = value => value ? new Date(value).toISOString().slice(0, 10) : "";
const localDateTime = value => value ? new Date(value).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16);
const prettyDate = value => value ? new Intl.DateTimeFormat("it-IT", { dateStyle: "medium" }).format(new Date(value)) : "—";
const val = (obj, key, fallback = "—") => obj?.[key] === null || obj?.[key] === undefined || obj?.[key] === "" ? fallback : obj[key];
const readForm = e => Object.fromEntries(Array.from(new FormData(e.currentTarget).entries()).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]));
const isoDateTime = value => value ? new Date(value).toISOString() : null;
const nullable = value => value === "" || value === undefined ? null : value;

function Input({ label, name, type = "text", defaultValue, required = false, min, max, step, placeholder }) {
  return <label className="field"><span>{label}</span><input name={name} type={type} defaultValue={defaultValue ?? ""} required={required} min={min} max={max} step={step} placeholder={placeholder}/></label>;
}
function TextArea({ label, name, defaultValue, rows = 3, placeholder }) {
  return <label className="field"><span>{label}</span><textarea name={name} defaultValue={defaultValue ?? ""} rows={rows} placeholder={placeholder}/></label>;
}
function Choice({ label, name, defaultValue, options, required = false }) {
  return <label className="field"><span>{label}</span><select name={name} defaultValue={defaultValue ?? ""} required={required}>{options.map(o => Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
}
function Action({ children, variant = "secondary", ...props }) {
  return <button className={"button " + variant} {...props}>{children}</button>;
}
function SectionTitle({ eyebrow, title, children }) {
  return <div className="panel-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><div className="inline-actions">{children}</div></div>;
}
const cycleStatuses = [["planned", "Pianificato"], ["active", "In corso"], ["completed", "Completato"], ["cancelled", "Annullato"]];
const eventTypes = [["pairing", "Accoppiamento"], ["observation", "Osservazione"], ["ovulation", "Ovulazione"], ["gravid", "Gravidanza"], ["laying", "Deposizione"], ["live_birth", "Parto"], ["incubation_start", "Avvio incubazione"], ["hatch", "Schiusa"], ["loss", "Perdita"], ["other", "Altro"]];
const eggStatuses = [["unknown", "Da valutare"], ["incubating", "In incubazione"], ["fertile", "Fertile"], ["infertile", "Non fertile"], ["hatched", "Schiuso"], ["lost", "Perso"], ["retained", "Trattenuto"]];

export function ReproductionHub({ onNotice = () => {}, owner }) {
  const [cycles, setCycles] = useState([]);
  const [animals, setAnimals] = useState([]);
  const [cycleId, setCycleId] = useState("");
  const [cycle, setCycle] = useState(null);
  const [clutches, setClutches] = useState([]);
  const [events, setEvents] = useState([]);
  const [batches, setBatches] = useState([]);
  const [clutchId, setClutchId] = useState("");
  const [clutch, setClutch] = useState(null);
  const [eggs, setEggs] = useState([]);
  const [logs, setLogs] = useState([]);
  const [editCycle, setEditCycle] = useState(null);
  const [editClutch, setEditClutch] = useState(null);
  const [editEvent, setEditEvent] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const api = useCallback(async (path, options = {}, label) => {
    const result = await apiRequest(path, { ...options, queueWhenOffline: options.method && options.method !== "GET", offlineOwner: owner, offlineLabel: label });
    if (result?.queuedOffline) {
      onNotice("Modifica conservata sul dispositivo. Verrà sincronizzata quando tornerà la connessione.", "warning");
      return result;
    }
    onNotice("Modifiche salvate.");
    return result;
  }, [owner, onNotice]);

  const loadLists = useCallback(async () => {
    const [cycleResult, animalResult, batchResult] = await Promise.all([
      apiRequest("reproduction-cycles?page=1&pageSize=100"),
      apiRequest("animals?page=1&pageSize=100"),
      apiRequest("offspring-batches?page=1&pageSize=100")
    ]);
    const nextCycles = arrayOf(cycleResult.cycles ?? cycleResult);
    setCycles(nextCycles);
    setAnimals(arrayOf(animalResult.animals ?? animalResult));
    setBatches(arrayOf(batchResult.offspringBatches ?? batchResult));
    if (!cycleId && nextCycles.length) setCycleId(nextCycles[0].id);
    if (cycleId && !nextCycles.some(item => item.id === cycleId)) setCycleId(nextCycles[0]?.id || "");
  }, [cycleId]);

  const loadCycle = useCallback(async (id = cycleId) => {
    if (!id) {
      setCycle(null); setClutches([]); setEvents([]); setClutchId(""); setBatches([]);
      return;
    }
    const response = await apiRequest("reproduction-cycles/" + id);
    const value = response.cycle;
    setCycle(value);
    setClutches(arrayOf(value?.clutches));
    setEvents(arrayOf(value?.events));
    setBatches(arrayOf(value?.offspringBatches));
    if (clutchId && !arrayOf(value?.clutches).some(item => item.id === clutchId)) setClutchId("");
    else if (!clutchId && arrayOf(value?.clutches).length) setClutchId(arrayOf(value.clutches)[0].id);
  }, [cycleId, clutchId]);

  const loadClutch = useCallback(async (id = clutchId) => {
    if (!id) { setClutch(null); setEggs([]); setLogs([]); return; }
    const [detail, eggResult, logResult] = await Promise.all([
      apiRequest("clutches/" + id),
      apiRequest("clutches/" + id + "/eggs?page=1&pageSize=100"),
      apiRequest("clutches/" + id + "/incubation-logs?page=1&pageSize=100")
    ]);
    setClutch(detail.clutch);
    setEggs(arrayOf(eggResult.eggs ?? eggResult));
    setLogs(arrayOf(logResult.logs ?? logResult));
  }, [clutchId]);

  const refresh = useCallback(async () => {
    setError(""); setBusy(true);
    try { await loadLists(); if (cycleId) await loadCycle(cycleId); }
    catch (e) { setError(e.message || "Impossibile caricare i dati riproduttivi."); }
    finally { setBusy(false); }
  }, [cycleId, loadLists, loadCycle]);

  useEffect(() => { void loadLists().catch(e => setError(e.message)); }, []);
  useEffect(() => { void loadCycle(cycleId).catch(e => setError(e.message)); }, [cycleId]);
  useEffect(() => { void loadClutch(clutchId).catch(e => setError(e.message)); }, [clutchId]);
  useEffect(() => {
    const changed = () => { void loadLists().then(() => loadCycle()).catch(() => {}); };
    window.addEventListener("vivarqo:offline-queue-changed", changed);
    return () => window.removeEventListener("vivarqo:offline-queue-changed", changed);
  }, [loadLists, loadCycle]);

  const submitCycle = async e => {
    e.preventDefault(); const v = readForm(e);
    const body = {
      name: nullable(v.name), startedOn: v.startedOn, endedOn: nullable(v.endedOn),
      status: v.status, parentAAnimalId: nullable(v.parentAAnimalId), parentBAnimalId: nullable(v.parentBAnimalId), notes: nullable(v.notes)
    };
    try {
      const response = await api(editCycle ? "reproduction-cycles/" + editCycle.id : "reproduction-cycles", {
        method: editCycle ? "PATCH" : "POST", body
      }, "Ciclo riproduttivo");
      if (response.queuedOffline) { setEditCycle(null); return; }
      setEditCycle(null);
      await loadLists();
      const created = response.cycle;
      if (created?.id) setCycleId(created.id);
      await loadCycle(created?.id || cycleId);
    } catch (err) { onNotice(err.message, "error"); }
  };
  const deleteCycle = async item => {
    if (!window.confirm("Eliminare il ciclo “" + (item.name || prettyDate(item.startedOn)) + "”? I cicli con registri collegati potrebbero richiedere prima la rimozione dei record figli.")) return;
    try {
      const result = await api("reproduction-cycles/" + item.id, { method: "DELETE", body: {} }, "Elimina ciclo");
      if (result.queuedOffline) return;
      if (cycleId === item.id) { setCycleId(""); setClutchId(""); }
      await loadLists();
    } catch (err) { onNotice(err.message, "error"); }
  };
  const submitEvent = async e => {
    e.preventDefault(); const v = readForm(e);
    const body = {
      eventType: v.eventType, occurredAt: isoDateTime(v.occurredAt), animalId: nullable(v.animalId),
      details: nullable(v.details), temperatureC: v.temperatureC === "" ? null : Number(v.temperatureC),
      humidityPct: v.humidityPct === "" ? null : Number(v.humidityPct)
    };
    try {
      const response = await api(editEvent ? "reproductive-events/" + editEvent.id : "reproduction-cycles/" + cycleId + "/events", {
        method: editEvent ? "PATCH" : "POST", body
      }, "Evento riproduttivo");
      if (!response.queuedOffline) { setEditEvent(null); await loadCycle(); }
      else setEditEvent(null);
    } catch (err) { onNotice(err.message, "error"); }
  };
  const deleteEvent = async item => {
    if (!window.confirm("Eliminare questo evento riproduttivo?")) return;
    try { const r = await api("reproductive-events/" + item.id, { method: "DELETE", body: {} }, "Elimina evento"); if (!r.queuedOffline) await loadCycle(); }
    catch (err) { onNotice(err.message, "error"); }
  };
  const submitClutch = async e => {
    e.preventDefault(); const v = readForm(e);
    const body = {
      laidOn: v.laidOn, eggCount: Number(v.eggCount), status: v.status,
      incubatorLabel: nullable(v.incubatorLabel), incubationStartedAt: v.incubationStartedAt ? isoDateTime(v.incubationStartedAt) : null,
      notes: nullable(v.notes)
    };
    try {
      const response = await api(editClutch ? "clutches/" + editClutch.id : "clutches", {
        method: editClutch ? "PATCH" : "POST",
        body: editClutch ? body : { ...body, cycleId }
      }, "Covata");
      if (response.queuedOffline) { setEditClutch(null); return; }
      setEditClutch(null);
      if (response.clutch?.id) setClutchId(response.clutch.id);
      await loadCycle();
    } catch (err) { onNotice(err.message, "error"); }
  };
  const deleteClutch = async item => {
    if (!window.confirm("Eliminare la covata e le relative uova/registrazioni d'incubazione? Le covate collegate a piccoli registrati non possono essere eliminate.")) return;
    try {
      const r = await api("clutches/" + item.id, { method: "DELETE", body: {} }, "Elimina covata");
      if (r.queuedOffline) return;
      if (clutchId === item.id) setClutchId("");
      await loadCycle();
    } catch (err) { onNotice(err.message, "error"); }
  };
  const addEggs = async e => {
    e.preventDefault(); const v = readForm(e);
    const count = Math.max(1, Math.min(1000, Number(v.count || 1)));
    const prefix = v.prefix || "";
    const created = Array.from({ length: count }, (_, i) => ({
      code: prefix ? prefix + "-" + String(i + 1).padStart(2, "0") : null,
      status: v.status || "unknown", notes: nullable(v.notes)
    }));
    try {
      const r = await api("clutches/" + clutchId + "/eggs", { method: "POST", body: { eggs: created } }, "Aggiungi uova");
      if (!r.queuedOffline) { await loadClutch(); await loadCycle(); }
    } catch (err) { onNotice(err.message, "error"); }
  };
  const saveEgg = async (e, egg) => {
    e.preventDefault(); const v = readForm(e);
    try { const r = await api("eggs/" + egg.id, { method: "PATCH", body: { code: nullable(v.code), status: v.status, notes: nullable(v.notes) } }, "Modifica uovo"); if (!r.queuedOffline) await loadClutch(); }
    catch (err) { onNotice(err.message, "error"); }
  };
  const deleteEgg = async egg => {
    if (!window.confirm("Eliminare l'uovo " + (egg.code || "") + "?")) return;
    try { const r = await api("eggs/" + egg.id, { method: "DELETE", body: {} }, "Elimina uovo"); if (!r.queuedOffline) { await loadClutch(); await loadCycle(); } }
    catch (err) { onNotice(err.message, "error"); }
  };
  const addIncubationLog = async e => {
    e.preventDefault(); const v = readForm(e);
    const body = {
      recordedAt: isoDateTime(v.recordedAt), eventType: v.eventType,
      temperatureC: v.temperatureC === "" ? null : Number(v.temperatureC),
      humidityPct: v.humidityPct === "" ? null : Number(v.humidityPct),
      notes: nullable(v.notes)
    };
    try { const r = await api("clutches/" + clutchId + "/incubation-logs", { method: "POST", body }, "Registro incubazione"); if (!r.queuedOffline) await loadClutch(); }
    catch (err) { onNotice(err.message, "error"); }
  };
  const editIncubationLog = async (e, log) => {
    e.preventDefault(); const v = readForm(e);
    const body = {
      recordedAt: isoDateTime(v.recordedAt), eventType: v.eventType,
      temperatureC: v.temperatureC === "" ? null : Number(v.temperatureC),
      humidityPct: v.humidityPct === "" ? null : Number(v.humidityPct),
      notes: nullable(v.notes)
    };
    try { const r = await api("incubation-logs/" + log.id, { method: "PATCH", body }, "Modifica registro incubazione"); if (!r.queuedOffline) await loadClutch(); }
    catch (err) { onNotice(err.message, "error"); }
  };
  const deleteIncubationLog = async log => {
    if (!window.confirm("Eliminare il registro di incubazione?")) return;
    try { const r = await api("incubation-logs/" + log.id, { method: "DELETE", body: {} }, "Elimina registro incubazione"); if (!r.queuedOffline) await loadClutch(); }
    catch (err) { onNotice(err.message, "error"); }
  };
  const createBatch = async e => {
    e.preventDefault(); const v = readForm(e);
    const body = { cycleId, clutchId: nullable(v.clutchId), bornOn: v.bornOn, count: Number(v.count), notes: nullable(v.notes) };
    try { const r = await api("offspring-batches", { method: "POST", body }, "Registro piccoli"); if (!r.queuedOffline) { await loadCycle(); await loadLists(); } }
    catch (err) { onNotice(err.message, "error"); }
  };
  const editBatch = async (e, batch) => {
    e.preventDefault(); const v = readForm(e);
    const body = { bornOn: v.bornOn, count: Number(v.count), notes: nullable(v.notes), clutchId: nullable(v.clutchId) };
    try { const r = await api("offspring-batches/" + batch.id, { method: "PATCH", body }, "Modifica registro piccoli"); if (!r.queuedOffline) { await loadCycle(); await loadLists(); } }
    catch (err) { onNotice(err.message, "error"); }
  };
  const deleteBatch = async batch => {
    if (!window.confirm("Eliminare il registro dei piccoli? Non sarà possibile se sono già state create schede animali da questa covata.")) return;
    try { const r = await api("offspring-batches/" + batch.id, { method: "DELETE", body: {} }, "Elimina registro piccoli"); if (!r.queuedOffline) { await loadCycle(); await loadLists(); } }
    catch (err) { onNotice(err.message, "error"); }
  };
  const createAnimalCards = async batch => {
    const prefix = window.prompt("Prefisso dei nomi dei piccoli (es. Cucciolo)", "Piccolo");
    if (prefix === null || !prefix.trim()) return;
    const species = window.prompt("Specie dei piccoli", val(cycle?.parentA, "species", ""));
    if (species === null || !species.trim()) return;
    const count = Math.max(0, Math.min(500, Number(window.prompt("Quante schede creare?", String(batch.count)) || 0)));
    if (!count) return;
    const bornOn = dateValue(batch.bornOn);
    const animalsPayload = Array.from({ length: count }, (_, i) => ({
      name: prefix.trim() + " " + String(i + 1).padStart(2, "0"),
      species: species.trim(), sex: "unknown", identifier: null, birthDate: bornOn || null
    }));
    try {
      const r = await api("offspring-batches/" + batch.id + "/animals", { method: "POST", body: { animals: animalsPayload } }, "Crea schede dei piccoli");
      if (!r.queuedOffline) onNotice("Create " + (r.createdCount ?? count) + " schede animale.");
    } catch (err) { onNotice(err.message, "error"); }
  };

  const cycleForForm = editCycle || {};
  const clutchForForm = editClutch || {};
  const cycleBatches = useMemo(() => batches.filter(b => !cycleId || b.cycleId === cycleId), [batches, cycleId]);

  return <div className="advanced-stack">
    <section className="panel">
      <SectionTitle eyebrow="GESTIONE RIPRODUTTIVA" title="Cicli riproduttivi">
        <Action onClick={() => setEditCycle({})}>＋ Nuovo ciclo</Action><Action onClick={() => refresh()} disabled={busy}>↻ Aggiorna</Action>
      </SectionTitle>
      {error && <p className="form-message" role="alert">{error}</p>}
      {busy && <p className="muted">Caricamento dati riproduttivi…</p>}
      {cycles.length === 0 ? <div className="empty-state"><h3>Nessun ciclo registrato</h3><p>Crea un ciclo per collegare genitori, eventi, covate e piccoli.</p></div> :
        <div className="cycle-grid">{cycles.map(item => <article className={"cycle-card " + (item.id === cycleId ? "selected" : "")} key={item.id}>
          <button className="cycle-select" onClick={() => setCycleId(item.id)}><strong>{item.name || "Ciclo senza nome"}</strong><span>{prettyDate(item.startedOn)} · {val(item, "status")}</span><small>{item.parentA?.name || animals.find(a => a.id === item.parentAAnimalId)?.name || "Genitore A non assegnato"} × {item.parentB?.name || animals.find(a => a.id === item.parentBAnimalId)?.name || "Genitore B non assegnato"}</small><small>{item._count?.clutches ?? 0} covate · {item._count?.events ?? 0} eventi · {item._count?.offspringBatches ?? 0} registri piccoli</small></button>
          <div className="inline-actions"><Action onClick={() => setEditCycle(item)}>Modifica</Action><Action variant="danger" onClick={() => deleteCycle(item)}>Elimina</Action></div>
        </article>)}</div>}
      {editCycle && <div className="embedded-form"><form className="form-grid" onSubmit={submitCycle}>
        <h3 className="form-full">{editCycle.id ? "Modifica ciclo" : "Nuovo ciclo"}</h3>
        <Input label="Nome del ciclo" name="name" defaultValue={cycleForForm.name} placeholder="Es. Riproduzione 2026"/>
        <Choice label="Stato" name="status" defaultValue={cycleForForm.status || "planned"} options={cycleStatuses} required/>
        <Input label="Data inizio" name="startedOn" type="date" defaultValue={dateValue(cycleForForm.startedOn)} required/>
        <Input label="Data fine" name="endedOn" type="date" defaultValue={dateValue(cycleForForm.endedOn)}/>
        <Choice label="Genitore A" name="parentAAnimalId" defaultValue={cycleForForm.parentAAnimalId || ""} options={[["", "Non assegnato"], ...animals.map(a => [a.id, a.name + " · " + a.species])]} />
        <Choice label="Genitore B" name="parentBAnimalId" defaultValue={cycleForForm.parentBAnimalId || ""} options={[["", "Non assegnato"], ...animals.map(a => [a.id, a.name + " · " + a.species])]} />
        <div className="form-full"><TextArea label="Note" name="notes" defaultValue={cycleForForm.notes}/></div>
        <div className="form-actions form-full"><Action type="button" onClick={() => setEditCycle(null)}>Annulla</Action><Action variant="primary">Salva ciclo</Action></div>
      </form></div>}
    </section>

    {!cycle ? null : <>
      <section className="panel">
        <SectionTitle eyebrow="EVENTI DEL CICLO" title={cycle.name || "Dettaglio ciclo"}>
          <Action onClick={() => setEditEvent({})}>＋ Evento</Action>
        </SectionTitle>
        <p className="muted">Genitori: {cycle.parentA?.name || "—"} e {cycle.parentB?.name || "—"} · Periodo: {prettyDate(cycle.startedOn)} – {prettyDate(cycle.endedOn)}</p>
        {editEvent && <div className="embedded-form"><form className="form-grid" onSubmit={submitEvent}>
          <h3 className="form-full">{editEvent.id ? "Modifica evento" : "Registra evento"}</h3>
          <Choice label="Tipo evento" name="eventType" defaultValue={editEvent.eventType || "observation"} options={eventTypes} required/>
          <Input label="Data e ora" name="occurredAt" type="datetime-local" defaultValue={localDateTime(editEvent.occurredAt)} required/>
          <Choice label="Animale coinvolto (facoltativo)" name="animalId" defaultValue={editEvent.animalId || ""} options={[["", "Nessuno"], ...animals.map(a => [a.id, a.name])]} />
          <Input label="Temperatura °C" name="temperatureC" type="number" step="0.1" defaultValue={editEvent.temperatureC}/>
          <Input label="Umidità %" name="humidityPct" type="number" min="0" max="100" step="0.1" defaultValue={editEvent.humidityPct}/>
          <div className="form-full"><TextArea label="Dettagli" name="details" defaultValue={editEvent.details}/></div>
          <div className="form-actions form-full"><Action type="button" onClick={() => setEditEvent(null)}>Annulla</Action><Action variant="primary">Salva evento</Action></div>
        </form></div>}
        {events.length === 0 ? <p className="muted">Nessun evento registrato per questo ciclo.</p> : <div className="table-wrap"><table><thead><tr><th>Quando</th><th>Evento</th><th>Animale</th><th>Dettagli</th><th>Azioni</th></tr></thead><tbody>{events.map(item => <tr key={item.id}><td>{prettyDate(item.occurredAt)}</td><td>{eventTypes.find(o => o[0] === item.eventType)?.[1] || item.eventType}</td><td>{item.animal?.name || "—"}</td><td>{item.details || "—"}</td><td><div className="inline-actions"><Action onClick={() => setEditEvent(item)}>Modifica</Action><Action variant="danger" onClick={() => deleteEvent(item)}>Elimina</Action></div></td></tr>)}</tbody></table></div>}
      </section>

      <section className="panel">
        <SectionTitle eyebrow="DEPOSIZIONI" title="Covate">
          <Action onClick={() => setEditClutch({})}>＋ Nuova covata</Action>
        </SectionTitle>
        {editClutch && <div className="embedded-form"><form className="form-grid" onSubmit={submitClutch}>
          <h3 className="form-full">{editClutch.id ? "Modifica covata" : "Registra covata"}</h3>
          <Input label="Data deposizione" name="laidOn" type="date" defaultValue={dateValue(clutchForForm.laidOn)} required/>
          <Input label="Numero uova" name="eggCount" type="number" min="0" max="10000" defaultValue={clutchForForm.eggCount ?? 1} required/>
          <Choice label="Stato" name="status" defaultValue={clutchForForm.status || "active"} options={[["active","Attiva"],["incubating","In incubazione"],["completed","Completata"],["lost","Persa"],["archived","Archiviata"]]} required/>
          <Input label="Incubatrice / posizione" name="incubatorLabel" defaultValue={clutchForForm.incubatorLabel}/>
          <Input label="Inizio incubazione" name="incubationStartedAt" type="datetime-local" defaultValue={localDateTime(clutchForForm.incubationStartedAt)}/>
          <div className="form-full"><TextArea label="Note covata" name="notes" defaultValue={clutchForForm.notes}/></div>
          <div className="form-actions form-full"><Action type="button" onClick={() => setEditClutch(null)}>Annulla</Action><Action variant="primary">Salva covata</Action></div>
        </form></div>}
        {clutches.length === 0 ? <p className="muted">Nessuna covata collegata a questo ciclo.</p> : <div className="clutch-grid">{clutches.map(item => <article key={item.id} className={"clutch-card " + (item.id === clutchId ? "selected" : "")}>
          <button className="cycle-select" onClick={() => setClutchId(item.id)}><strong>{prettyDate(item.laidOn)} · {item.eggCount} uova</strong><span>{item.status} · {item.incubatorLabel || "Incubatrice non indicata"}</span><small>{item._count?.eggs ?? 0} uova registrate · {item._count?.incubationLogs ?? 0} controlli</small></button>
          <div className="inline-actions"><Action onClick={() => setEditClutch(item)}>Modifica</Action><Action variant="danger" onClick={() => deleteClutch(item)}>Elimina</Action></div>
        </article>)}</div>}
      </section>

      {clutch && <section className="panel">
        <SectionTitle eyebrow="SCHEDA COVATA" title={"Uova · " + prettyDate(clutch.laidOn)}>
          <span className="muted">{eggs.length} visibili</span>
        </SectionTitle>
        <div className="embedded-form"><form className="form-grid" onSubmit={addEggs}>
          <h3 className="form-full">Aggiungi uova in blocco</h3>
          <Input label="Quante uova" name="count" type="number" min="1" max="1000" defaultValue="1" required/>
          <Input label="Prefisso codice (facoltativo)" name="prefix" placeholder="Es. COVATA-A"/>
          <Choice label="Stato iniziale" name="status" defaultValue="unknown" options={eggStatuses}/>
          <Input label="Nota iniziale (facoltativa)" name="notes"/>
          <div className="form-actions form-full"><Action variant="primary">Aggiungi uova</Action></div>
        </form></div>
        {eggs.length === 0 ? <p className="muted">Nessun uovo tracciato singolarmente. Il conteggio della covata rimane separato dalle schede individuali.</p> : <div className="table-wrap"><table><thead><tr><th>Codice</th><th>Stato</th><th>Note</th><th>Azioni</th></tr></thead><tbody>{eggs.map(egg => <tr key={egg.id}><td><form className="inline-form" onSubmit={e => saveEgg(e, egg)}><input className="compact-input" name="code" defaultValue={egg.code || ""} placeholder="Codice"/></form></td><td><form className="inline-form" onSubmit={e => saveEgg(e, egg)}><select name="status" defaultValue={egg.status}>{eggStatuses.map(o => <option key={o[0]} value={o[0]}>{o[1]}</option>)}</select></form></td><td><form className="inline-form" onSubmit={e => saveEgg(e, egg)}><input className="compact-input" name="notes" defaultValue={egg.notes || ""} placeholder="Note"/></form></td><td><div className="inline-actions"><Action onClick={e => { const row = e.currentTarget.closest("tr"); const forms = row.querySelectorAll("form"); const values = Object.fromEntries(Array.from(new FormData(forms[0]).entries())); const status = forms[1].querySelector("select").value; const notes = forms[2].querySelector("input").value; void api("eggs/" + egg.id, { method: "PATCH", body: { code: nullable(values.code), status, notes: nullable(notes) } }, "Modifica uovo").then(r => { if (!r.queuedOffline) loadClutch(); }).catch(err => onNotice(err.message, "error")); }}>Salva</Action><Action variant="danger" onClick={() => deleteEgg(egg)}>Elimina</Action></div></td></tr>)}</tbody></table></div>}

        <SectionTitle eyebrow="CONTROLLI AMBIENTALI" title="Registro incubazione"/>
        <div className="embedded-form"><form className="form-grid" onSubmit={addIncubationLog}>
          <Input label="Data e ora" name="recordedAt" type="datetime-local" defaultValue={localDateTime()} required/>
          <Input label="Evento" name="eventType" defaultValue="controllo" required/>
          <Input label="Temperatura °C" name="temperatureC" type="number" step="0.1"/>
          <Input label="Umidità %" name="humidityPct" type="number" min="0" max="100" step="0.1"/>
          <div className="form-full"><TextArea label="Note" name="notes"/></div>
          <div className="form-actions form-full"><Action variant="primary">Registra controllo</Action></div>
        </form></div>
        {logs.length > 0 && <div className="log-list">{logs.map(log => <article className="log-row" key={log.id}><div><strong>{prettyDate(log.recordedAt)} · {log.eventType}</strong><p>{log.temperatureC ?? "—"} °C · {log.humidityPct ?? "—"}% umidità</p><small>{log.notes || "Nessuna nota"}</small></div><details><summary>Modifica</summary><form className="form-stack" onSubmit={e => editIncubationLog(e, log)}><Input label="Data e ora" name="recordedAt" type="datetime-local" defaultValue={localDateTime(log.recordedAt)} required/><Input label="Evento" name="eventType" defaultValue={log.eventType} required/><Input label="Temperatura °C" name="temperatureC" type="number" step="0.1" defaultValue={log.temperatureC}/><Input label="Umidità %" name="humidityPct" type="number" min="0" max="100" step="0.1" defaultValue={log.humidityPct}/><TextArea label="Note" name="notes" defaultValue={log.notes}/><Action variant="primary">Salva controllo</Action></form></details><Action variant="danger" onClick={() => deleteIncubationLog(log)}>Elimina</Action></article>)}</div>}
      </section>}

      <section className="panel">
        <SectionTitle eyebrow="NASCITA E CRESCITA" title="Piccoli e lotti di nascita"/>
        <div className="embedded-form"><form className="form-grid" onSubmit={createBatch}>
          <h3 className="form-full">Registra un lotto di piccoli</h3>
          <Input label="Data di nascita / schiusa" name="bornOn" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required/>
          <Input label="Numero di piccoli" name="count" type="number" min="0" max="10000" defaultValue="1" required/>
          <Choice label="Covata di origine (facoltativa)" name="clutchId" options={[["", "Non collegata"], ...clutches.map(c => [c.id, prettyDate(c.laidOn) + " · " + c.eggCount + " uova"])]}/>
          <div className="form-full"><TextArea label="Note" name="notes"/></div>
          <div className="form-actions form-full"><Action variant="primary">Registra lotto</Action></div>
        </form></div>
        {cycleBatches.length === 0 ? <p className="muted">Nessun lotto di piccoli registrato per questo ciclo.</p> : <div className="log-list">{cycleBatches.map(batch => <article className="log-row" key={batch.id}><div><strong>{prettyDate(batch.bornOn)} · {batch.count} piccoli</strong><p>{batch.notes || "Nessuna nota"}</p><small>Covata: {clutches.find(c => c.id === batch.clutchId) ? prettyDate(clutches.find(c => c.id === batch.clutchId).laidOn) : "non collegata"}</small></div><details><summary>Modifica</summary><form className="form-stack" onSubmit={e => editBatch(e, batch)}><Input label="Data di nascita" name="bornOn" type="date" defaultValue={dateValue(batch.bornOn)} required/><Input label="Numero di piccoli" name="count" type="number" min="0" max="10000" defaultValue={batch.count} required/><Choice label="Covata" name="clutchId" defaultValue={batch.clutchId || ""} options={[["", "Non collegata"], ...clutches.map(c => [c.id, prettyDate(c.laidOn)])]}/><TextArea label="Note" name="notes" defaultValue={batch.notes}/><Action variant="primary">Salva lotto</Action></form></details><Action onClick={() => createAnimalCards(batch)}>Crea schede animali</Action><Action variant="danger" onClick={() => deleteBatch(batch)}>Elimina lotto</Action></article>)}</div>}
      </section>
    </>}
  </div>;
}