import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { AnyRecord, CommonHubProps } from "./types";
import { Input, TextArea, Choice, Action, SectionTitle } from "./ui/FormControls";
import { readFormValues } from "./types";
import { apiRequest, type ApiRequestOptions } from "./api/api";
import { Dialog } from "./ui/Dialog";
import { Icon } from "./ui/Icon";
import { useConfirmDialog } from "./ui/ConfirmDialog";

const arrayOf = (value: unknown): AnyRecord[] => Array.isArray(value) ? value as AnyRecord[] : value && typeof value === "object" ? Object.values(value as AnyRecord).find(Array.isArray) as AnyRecord[] || [] : [];
const dateValue = (value?: string | Date | null) => value ? new Date(value).toISOString().slice(0, 10) : "";
const localDateTime = (value?: string | null) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + "T" + pad(date.getHours()) + ":" + pad(date.getMinutes());
};
const prettyDate = (value?: string | Date | null) => value ? new Intl.DateTimeFormat("it-IT", { dateStyle: "medium" }).format(new Date(value)) : "—";
const val = (obj: AnyRecord | null | undefined, key: string, fallback = "—") => obj?.[key] === null || obj?.[key] === undefined || obj?.[key] === "" ? fallback : obj[key];
const readForm = (e: React.FormEvent<HTMLFormElement>) => readFormValues(e.currentTarget);
const isoDateTime = (value?: string | Date | null) => value ? new Date(value).toISOString() : null;
const nullable = (value: unknown) => value === "" || value === undefined ? null : value;

const cycleStatuses = [["planned", "Pianificato"], ["active", "In corso"], ["completed", "Completato"], ["cancelled", "Annullato"]];
const eventTypes = [["pairing", "Accoppiamento"], ["observation", "Osservazione"], ["ovulation", "Ovulazione"], ["gravid", "Gravidanza"], ["laying", "Deposizione"], ["live_birth", "Parto"], ["incubation_start", "Avvio incubazione"], ["hatch", "Schiusa"], ["loss", "Perdita"], ["other", "Altro"]];
const eggStatuses = [["unknown", "Da valutare"], ["incubating", "In incubazione"], ["fertile", "Fertile"], ["infertile", "Non fertile"], ["hatched", "Schiuso"], ["lost", "Perso"], ["retained", "Trattenuto"]];

export function ReproductionHub({ onNotice = () => {}, owner }: CommonHubProps) {
  const confirmAction = useConfirmDialog();
  const [animalCardsForm, setAnimalCardsForm] = useState<AnyRecord | null>(null);
  const [creatingAnimalCards, setCreatingAnimalCards] = useState(false);
  const [cycles, setCycles] = useState<AnyRecord[]>([]);
  const [cyclesPage, setCyclesPage] = useState(1);
  const [cyclesPagination, setCyclesPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
  const [animals, setAnimals] = useState<AnyRecord[]>([]);
  const [animalsPage, setAnimalsPage] = useState(1);
  const [animalsPagination, setAnimalsPagination] = useState({ page: 1, pageSize: 100, total: 0, totalPages: 1 });
  const [cycleId, setCycleId] = useState("");
  const [detailTab, setDetailTab] = useState("events");
  const [cycle, setCycle] = useState<AnyRecord | null>(null);
  const [clutches, setClutches] = useState<AnyRecord[]>([]);
  const [events, setEvents] = useState<AnyRecord[]>([]);
  const [eventsPage, setEventsPage] = useState(1);
  const [eventsPagination, setEventsPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
  const [clutchesPage, setClutchesPage] = useState(1);
  const [clutchesPagination, setClutchesPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
  const [batchesPage, setBatchesPage] = useState(1);
  const [batchesPagination, setBatchesPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
  const [batches, setBatches] = useState<AnyRecord[]>([]);
  const [clutchId, setClutchId] = useState("");
  const [clutch, setClutch] = useState<AnyRecord | null>(null);
  const [eggs, setEggs] = useState<AnyRecord[]>([]);
  const [eggsPage, setEggsPage] = useState(1);
  const [eggsPagination, setEggsPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
  const [logs, setLogs] = useState<AnyRecord[]>([]);
  const [logsPage, setLogsPage] = useState(1);
  const [logsPagination, setLogsPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
  const [editCycle, setEditCycle] = useState<AnyRecord | null>(null);
  const [editClutch, setEditClutch] = useState<AnyRecord | null>(null);
  const [editEvent, setEditEvent] = useState<AnyRecord | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [listsLoaded, setListsLoaded] = useState(false);

  const api = useCallback(async (path: string, options: ApiRequestOptions = {}, _actionLabel?: string) => {
    const result = await apiRequest(path, options);
    onNotice("Modifiche salvate.");
    return result;
  }, [onNotice]);

  const selectCycle = id => {
    setCycleId(id);
    setDetailTab("events");
    setEventsPage(1); setClutchesPage(1); setBatchesPage(1);
    setClutchId(""); setEggsPage(1); setLogsPage(1);
  };

  const loadLists = useCallback(async () => {
    const batchQuery = new URLSearchParams({ page: String(batchesPage), pageSize: "50" });
    if (cycleId) batchQuery.set("cycleId", cycleId);
    const [cycleResult, animalResult, batchResult] = await Promise.all([
      apiRequest("reproduction-cycles?page=" + cyclesPage + "&pageSize=50"),
      apiRequest("animals?page=" + animalsPage + "&pageSize=100"),
      apiRequest("offspring-batches?" + batchQuery.toString())
    ]);
    const nextCycles = arrayOf(cycleResult.cycles ?? cycleResult);
    const nextBatches = arrayOf(batchResult.offspringBatches ?? batchResult);
    setCycles(previous => Array.from(new Map([...previous, ...nextCycles].map(cycle => [cycle.id, cycle])).values()));
    setCyclesPagination(cycleResult.pagination || { page: cyclesPage, pageSize: 50, total: nextCycles.length, totalPages: 1 });
    const nextAnimals = arrayOf(animalResult.animals ?? animalResult);
    setAnimals(previous => Array.from(new Map([...previous, ...nextAnimals].map(animal => [animal.id, animal])).values()));
    setAnimalsPagination(animalResult.pagination || { page: animalsPage, pageSize: 100, total: nextAnimals.length, totalPages: 1 });
    setBatches(nextBatches);
    setBatchesPagination(batchResult.pagination || { page: batchesPage, pageSize: 50, total: nextBatches.length, totalPages: 1 });
    if (!cycleId && nextCycles.length) setCycleId(nextCycles[0].id);
  }, [cycleId, cyclesPage, batchesPage, animalsPage]);

  const loadCycle = useCallback(async (id = cycleId) => {
    if (!id) {
      setCycle(null); setClutches([]); setEvents([]); setClutchId(""); setBatches([]);
      setEventsPagination({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
      setClutchesPagination({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
      return;
    }
    const [detail, eventResponse, clutchResponse] = await Promise.all([
      apiRequest("reproduction-cycles/" + id),
      apiRequest("reproduction-cycles/" + id + "/events?page=" + eventsPage + "&pageSize=50"),
      apiRequest("reproduction-cycles/" + id + "/clutches?page=" + clutchesPage + "&pageSize=50")
    ]);
    const value = detail.cycle;
    const nextEvents = arrayOf(eventResponse.events ?? eventResponse);
    const nextClutches = arrayOf(clutchResponse.clutches ?? clutchResponse);
    setCycle(value);
    setClutches(nextClutches);
    setEvents(nextEvents);
    setEventsPagination(eventResponse.pagination || { page: eventsPage, pageSize: 50, total: nextEvents.length, totalPages: 1 });
    setClutchesPagination(clutchResponse.pagination || { page: clutchesPage, pageSize: 50, total: nextClutches.length, totalPages: 1 });
    if (!clutchId && nextClutches.length) setClutchId(nextClutches[0].id);
  }, [cycleId, clutchId, eventsPage, clutchesPage]);

  const loadClutch = useCallback(async (id = clutchId) => {
    if (!id) {
      setClutch(null); setEggs([]); setLogs([]);
      setEggsPagination({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
      setLogsPagination({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
      return;
    }
    const [detail, eggResult, logResult] = await Promise.all([
      apiRequest("clutches/" + id),
      apiRequest("clutches/" + id + "/eggs?page=" + eggsPage + "&pageSize=50"),
      apiRequest("clutches/" + id + "/incubation-logs?page=" + logsPage + "&pageSize=50")
    ]);
    const nextEggs = arrayOf(eggResult.eggs ?? eggResult);
    const nextLogs = arrayOf(logResult.logs ?? logResult);
    setClutch(detail.clutch);
    setEggs(nextEggs); setLogs(nextLogs);
    setEggsPagination(eggResult.pagination || { page: eggsPage, pageSize: 50, total: nextEggs.length, totalPages: 1 });
    setLogsPagination(logResult.pagination || { page: logsPage, pageSize: 50, total: nextLogs.length, totalPages: 1 });
  }, [clutchId, eggsPage, logsPage]);

  const refresh = useCallback(async () => {
    setError(""); setBusy(true);
    try { await loadLists(); if (cycleId) await loadCycle(cycleId); }
    catch (e) { setError(e.message || "Impossibile caricare i dati riproduttivi."); }
    finally { setBusy(false); }
  }, [cycleId, loadLists, loadCycle]);

  useEffect(() => { let live = true; void loadLists().catch(e => setError(e.message)).finally(() => { if (live) setListsLoaded(true); }); return () => { live = false; }; }, [loadLists]);
  useEffect(() => { void loadCycle(cycleId).catch(e => setError(e.message)); }, [loadCycle]);
  useEffect(() => { void loadClutch(clutchId).catch(e => setError(e.message)); }, [loadClutch]);

  const submitCycle = async e => {
    e.preventDefault(); const v = readForm(e);
    const body = {
      name: nullable(v.name), startedOn: v.startedOn, endedOn: nullable(v.endedOn),
      status: v.status, parentAAnimalId: nullable(v.parentAAnimalId), parentBAnimalId: nullable(v.parentBAnimalId), notes: nullable(v.notes)
    };
    try {
      const editingCycle = Boolean(editCycle?.id);
      const response = await api(editingCycle ? "reproduction-cycles/" + editCycle.id : "reproduction-cycles", {
        method: editingCycle ? "PATCH" : "POST", body
      }, "Ciclo riproduttivo");
      
      setEditCycle(null);
      await loadLists();
      const created = response.cycle;
      if (created?.id) { setCyclesPage(1); selectCycle(created.id); }
      await loadCycle(created?.id || cycleId);
    } catch (err) { onNotice(err.message, "error"); }
  };
  const deleteCycle = async item => {
    if (!(await confirmAction({ title: "Eliminare il ciclo riproduttivo?", message: "“" + (item.name || prettyDate(item.startedOn)) + "” potrebbe avere registri figli da rimuovere prima. Il server controllerà i collegamenti.", confirmLabel: "Elimina ciclo", danger: true }))) return;
    try {
      const result = await api("reproduction-cycles/" + item.id, { method: "DELETE", body: {} }, "Elimina ciclo");
      
      setCycles(previous => previous.filter(cycle => cycle.id !== item.id));
      if (cycleId === item.id) {
        setCycleId(""); setClutchId(""); setCyclesPage(1);
        setEventsPage(1); setClutchesPage(1); setBatchesPage(1); setEggsPage(1); setLogsPage(1);
        // The selected cycle was deleted; the changed cycleId triggers the list refresh
        // without sending the now-invalid id as an offspring-batch filter.
      } else {
        await loadLists();
      }
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
      const editingEvent = Boolean(editEvent?.id);
      const response = await api(editingEvent ? "reproductive-events/" + editEvent.id : "reproduction-cycles/" + cycleId + "/events", {
        method: editingEvent ? "PATCH" : "POST", body
      }, "Evento riproduttivo");
      setEditEvent(null); await loadCycle();
    } catch (err) { onNotice(err.message, "error"); }
  };
  const deleteEvent = async item => {
    if (!(await confirmAction({ title: "Eliminare l’evento?", message: "L’evento riproduttivo verrà eliminato definitivamente.", confirmLabel: "Elimina evento", danger: true }))) return;
    try { const r = await api("reproductive-events/" + item.id, { method: "DELETE", body: {} }, "Elimina evento"); await loadCycle(); }
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
      const editingClutch = Boolean(editClutch?.id);
      const response = await api(editingClutch ? "clutches/" + editClutch.id : "clutches", {
        method: editingClutch ? "PATCH" : "POST",
        body: editingClutch ? body : { ...body, cycleId }
      }, "Covata");
      
      setEditClutch(null);
      if (response.clutch?.id) { setClutchId(response.clutch.id); setEggsPage(1); setLogsPage(1); }
      await loadCycle();
    } catch (err) { onNotice(err.message, "error"); }
  };
  const deleteClutch = async item => {
    if (!(await confirmAction({ title: "Eliminare la covata?", message: "Saranno interessate anche le uova e le registrazioni di incubazione. Le covate collegate a piccoli registrati non possono essere eliminate.", confirmLabel: "Elimina covata", danger: true }))) return;
    try {
      const r = await api("clutches/" + item.id, { method: "DELETE", body: {} }, "Elimina covata");
      
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
      await loadClutch(); await loadCycle();
    } catch (err) { onNotice(err.message, "error"); }
  };
  const saveEggRow = async (egg, row) => {
    if (!row) return;
    const body = {
      code: nullable(row.querySelector('[data-egg-field="code"]')?.value?.trim()),
      status: row.querySelector('[data-egg-field="status"]')?.value || "unknown",
      notes: nullable(row.querySelector('[data-egg-field="notes"]')?.value?.trim())
    };
    try {
      const result = await api("eggs/" + egg.id, { method: "PATCH", body }, "Modifica uovo");
      await loadClutch();
    } catch (err) { onNotice(err.message, "error"); }
  };
  const deleteEgg = async egg => {
    if (!(await confirmAction({ title: "Eliminare l’uovo?", message: "L’uovo “" + (egg.code || "senza codice") + "” verrà eliminato definitivamente.", confirmLabel: "Elimina uovo", danger: true }))) return;
    try { const r = await api("eggs/" + egg.id, { method: "DELETE", body: {} }, "Elimina uovo"); await loadClutch(); await loadCycle(); }
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
    try { const r = await api("clutches/" + clutchId + "/incubation-logs", { method: "POST", body }, "Registro incubazione"); await loadClutch(); }
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
    try { const r = await api("incubation-logs/" + log.id, { method: "PATCH", body }, "Modifica registro incubazione"); await loadClutch(); }
    catch (err) { onNotice(err.message, "error"); }
  };
  const deleteIncubationLog = async log => {
    if (!(await confirmAction({ title: "Eliminare il registro di incubazione?", message: "La registrazione verrà eliminata definitivamente.", confirmLabel: "Elimina registro", danger: true }))) return;
    try { const r = await api("incubation-logs/" + log.id, { method: "DELETE", body: {} }, "Elimina registro incubazione"); await loadClutch(); }
    catch (err) { onNotice(err.message, "error"); }
  };
  const createBatch = async e => {
    e.preventDefault(); const v = readForm(e);
    const body = { cycleId, clutchId: nullable(v.clutchId), bornOn: v.bornOn, count: Number(v.count), notes: nullable(v.notes) };
    try { const r = await api("offspring-batches", { method: "POST", body }, "Registro piccoli"); await loadCycle(); await loadLists(); }
    catch (err) { onNotice(err.message, "error"); }
  };
  const editBatch = async (e, batch) => {
    e.preventDefault(); const v = readForm(e);
    const body = { bornOn: v.bornOn, count: Number(v.count), notes: nullable(v.notes), clutchId: nullable(v.clutchId) };
    try { const r = await api("offspring-batches/" + batch.id, { method: "PATCH", body }, "Modifica registro piccoli"); await loadCycle(); await loadLists(); }
    catch (err) { onNotice(err.message, "error"); }
  };
  const deleteBatch = async batch => {
    if (!(await confirmAction({ title: "Eliminare il registro dei piccoli?", message: "Non sarà possibile procedere se sono già state create schede animali dal lotto.", confirmLabel: "Elimina registro", danger: true }))) return;
    try { const r = await api("offspring-batches/" + batch.id, { method: "DELETE", body: {} }, "Elimina registro piccoli"); await loadCycle(); await loadLists(); }
    catch (err) { onNotice(err.message, "error"); }
  };
  const createAnimalCards = batch => {
    setAnimalCardsForm({ batch, prefix: "Piccolo", species: val(cycle?.parentA, "species", ""), count: String(batch.count || 1) });
  };
  const submitAnimalCards = async event => {
    event.preventDefault();
    if (!animalCardsForm) return;
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const prefix = String(values.prefix || "").trim();
    const species = String(values.species || "").trim();
    const count = Number(values.count);
    if (!prefix || !species || !Number.isInteger(count) || count < 1 || count > 500) {
      onNotice("Inserisci prefisso e specie e scegli un numero di schede fra 1 e 500.", "error");
      return;
    }
    const bornOn = dateValue(animalCardsForm.batch.bornOn);
    const animalsPayload = Array.from({ length: count }, (_, index) => ({
      name: prefix + " " + String(index + 1).padStart(2, "0"),
      species, sex: "unknown", identifier: null, birthDate: bornOn || null
    }));
    setCreatingAnimalCards(true);
    try {
      const response = await api("offspring-batches/" + animalCardsForm.batch.id + "/animals", { method: "POST", body: { animals: animalsPayload } }, "Crea schede dei piccoli");
      setAnimalCardsForm(null);
      onNotice("Create " + (response.createdCount ?? count) + " schede animale.", "success");
      await loadCycle();
      await loadLists();
    } catch (err) { onNotice(err.message, "error"); }
    finally { setCreatingAnimalCards(false); }
  };

  const cycleForForm = editCycle || {};
  const clutchForForm = editClutch || {};
  const cycleBatches = useMemo(() => batches.filter(b => !cycleId || b.cycleId === cycleId), [batches, cycleId]);

  return <div className="advanced-stack">
    <section className="panel">
      <SectionTitle eyebrow="GESTIONE RIPRODUTTIVA" title="Cicli riproduttivi">
        <Action onClick={() => setEditCycle({})}>＋ Nuovo ciclo</Action><Action onClick={() => refresh()} disabled={busy}>↻ Aggiorna</Action>
      </SectionTitle>
      {animalsPagination.totalPages > 1 && <div className="pagination-bar"><span className="muted">Animali caricati · pagina {animalsPagination.page}/{animalsPagination.totalPages} ({animalsPagination.total} totali)</span><div className="inline-actions"><Action disabled={animalsPage <= 1 || busy} onClick={() => setAnimalsPage(p => p - 1)}>← Animali precedenti</Action><Action disabled={animalsPage >= animalsPagination.totalPages || busy} onClick={() => setAnimalsPage(p => p + 1)}>Altri animali →</Action></div></div>}
      {error && <p className="form-message" role="alert">{error}</p>}
      {busy && <p className="muted">Caricamento dati riproduttivi…</p>}
      {!listsLoaded && cycles.length === 0 ? <p className="loading" role="status">Caricamento cicli riproduttivi…</p> : cycles.length === 0 ? <div className="empty-state"><h3>Nessun ciclo registrato</h3><p>Crea un ciclo per collegare genitori, eventi, covate e piccoli.</p></div> :
        <div className="cycle-grid">{cycles.map(item => <article className={"cycle-card " + (item.id === cycleId ? "selected" : "")} key={item.id}>
          <button className="cycle-select" onClick={() => selectCycle(item.id)}><strong>{item.name || "Ciclo senza nome"}</strong><span>{prettyDate(item.startedOn)} · {val(item, "status")}</span><small>{item.parentA?.name || animals.find(a => a.id === item.parentAAnimalId)?.name || "Genitore A non assegnato"} × {item.parentB?.name || animals.find(a => a.id === item.parentBAnimalId)?.name || "Genitore B non assegnato"}</small><small>{item._count?.clutches ?? 0} covate · {item._count?.events ?? 0} eventi · {item._count?.offspringBatches ?? 0} registri piccoli</small></button>
          <div className="inline-actions"><Action onClick={() => setEditCycle(item)}>Modifica</Action><Action variant="danger" onClick={() => deleteCycle(item)}>Elimina</Action></div>
        </article>)}</div>}
      {cyclesPagination.totalPages > 1 && <div className="pagination-bar"><span className="muted">Pagina {cyclesPagination.page || cyclesPage} di {cyclesPagination.totalPages} · {cyclesPagination.total} cicli</span><div className="inline-actions"><Action disabled={cyclesPage <= 1} onClick={() => setCyclesPage(p => p - 1)}>← Precedente</Action><Action disabled={cyclesPage >= cyclesPagination.totalPages} onClick={() => setCyclesPage(p => p + 1)}>Successiva →</Action></div></div>}
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
      <div className="reproduction-detail-tabs" role="tablist" aria-label="Sezioni del ciclo riproduttivo">
        {[["events","Eventi e osservazioni"],["clutches","Covate, uova e incubazione"],["offspring","Piccoli e nascite"]].map(([id,label])=><button key={id} type="button" role="tab" aria-selected={detailTab===id} className={"tab-button "+(detailTab===id?"active":"")} onClick={()=>setDetailTab(id)}>{label}</button>)}
      </div>
      <section className={"panel reproduction-detail-section "+(detailTab==="events"?"":"is-hidden")}>
        <SectionTitle eyebrow="EVENTI DEL CICLO" title={cycle.name || "Dettaglio ciclo"}>
          <Action onClick={() => setEditEvent({})}>＋ Evento</Action>
        </SectionTitle>
        <p className="muted">Genitori: {cycle.parentA?.name || "—"} e {cycle.parentB?.name || "—"} · Periodo: {prettyDate(cycle.startedOn)} – {prettyDate(cycle.endedOn)}</p>
        {editEvent && <div className="embedded-form"><form className="form-grid" onSubmit={submitEvent}>
          <h3 className="form-full">{editEvent.id ? "Modifica evento" : "Registra evento"}</h3>
          <Choice label="Tipo evento" name="eventType" defaultValue={editEvent.eventType || "observation"} options={eventTypes} required/>
          <Input label="Data e ora" name="occurredAt" type="datetime-local" defaultValue={localDateTime(editEvent.occurredAt)} required/>
          <Choice label="Animale coinvolto (facoltativo)" name="animalId" defaultValue={editEvent.animalId || ""} options={[["", "Nessuno"], ...animals.map(a => [a.id, a.name])]} />
          <Input label="Temperatura °C" name="temperatureC" type="number" step={0.1} defaultValue={editEvent.temperatureC}/>
          <Input label="Umidità %" name="humidityPct" type="number" min={0} max={100} step={0.1} defaultValue={editEvent.humidityPct}/>
          <div className="form-full"><TextArea label="Dettagli" name="details" defaultValue={editEvent.details}/></div>
          <div className="form-actions form-full"><Action type="button" onClick={() => setEditEvent(null)}>Annulla</Action><Action variant="primary">Salva evento</Action></div>
        </form></div>}
        {events.length === 0 ? <p className="muted">Nessun evento registrato per questo ciclo.</p> : <div className="table-wrap"><table><thead><tr><th>Quando</th><th>Evento</th><th>Animale</th><th>Dettagli</th><th>Azioni</th></tr></thead><tbody>{events.map(item => <tr key={item.id}><td>{prettyDate(item.occurredAt)}</td><td>{eventTypes.find(o => o[0] === item.eventType)?.[1] || item.eventType}</td><td>{item.animal?.name || "—"}</td><td>{item.details || "—"}</td><td><div className="inline-actions"><Action onClick={() => setEditEvent(item)}>Modifica</Action><Action variant="danger" onClick={() => deleteEvent(item)}>Elimina</Action></div></td></tr>)}</tbody></table></div>}
      {eventsPagination.totalPages > 1 && <div className="pagination-bar"><span className="muted">Pagina {eventsPagination.page || eventsPage} di {eventsPagination.totalPages} · {eventsPagination.total} eventi</span><div className="inline-actions"><Action disabled={eventsPage <= 1} onClick={() => setEventsPage(p => p - 1)}>← Precedente</Action><Action disabled={eventsPage >= eventsPagination.totalPages} onClick={() => setEventsPage(p => p + 1)}>Successiva →</Action></div></div>}
      </section>

      <section className={"panel reproduction-detail-section "+(detailTab==="clutches"?"":"is-hidden")}>
        <SectionTitle eyebrow="DEPOSIZIONI" title="Covate">
          <Action onClick={() => setEditClutch({})}>＋ Nuova covata</Action>
        </SectionTitle>
        {editClutch && <div className="embedded-form"><form className="form-grid" onSubmit={submitClutch}>
          <h3 className="form-full">{editClutch.id ? "Modifica covata" : "Registra covata"}</h3>
          <Input label="Data deposizione" name="laidOn" type="date" defaultValue={dateValue(clutchForForm.laidOn)} required/>
          <Input label="Numero uova" name="eggCount" type="number" min={0} max={10000} defaultValue={clutchForForm.eggCount ?? 1} required/>
          <Choice label="Stato" name="status" defaultValue={clutchForForm.status || "active"} options={[["active","Attiva"],["incubating","In incubazione"],["completed","Completata"],["lost","Persa"],["archived","Archiviata"]]} required/>
          <Input label="Incubatrice / posizione" name="incubatorLabel" defaultValue={clutchForForm.incubatorLabel}/>
          <Input label="Inizio incubazione" name="incubationStartedAt" type="datetime-local" defaultValue={localDateTime(clutchForForm.incubationStartedAt)}/>
          <div className="form-full"><TextArea label="Note covata" name="notes" defaultValue={clutchForForm.notes}/></div>
          <div className="form-actions form-full"><Action type="button" onClick={() => setEditClutch(null)}>Annulla</Action><Action variant="primary">Salva covata</Action></div>
        </form></div>}
        {clutches.length === 0 ? <p className="muted">Nessuna covata collegata a questo ciclo.</p> : <div className="clutch-grid">{clutches.map(item => <article key={item.id} className={"clutch-card " + (item.id === clutchId ? "selected" : "")}>
          <button className="cycle-select" onClick={() => { setClutchId(item.id); setEggsPage(1); setLogsPage(1); }}><strong>{prettyDate(item.laidOn)} · {item.eggCount} uova</strong><span>{item.status} · {item.incubatorLabel || "Incubatrice non indicata"}</span><small>{item._count?.eggs ?? 0} uova registrate · {item._count?.incubationLogs ?? 0} controlli</small></button>
          <div className="inline-actions"><Action onClick={() => setEditClutch(item)}>Modifica</Action><Action variant="danger" onClick={() => deleteClutch(item)}>Elimina</Action></div>
        </article>)}</div>}
      {clutchesPagination.totalPages > 1 && <div className="pagination-bar"><span className="muted">Pagina {clutchesPagination.page || clutchesPage} di {clutchesPagination.totalPages} · {clutchesPagination.total} covate</span><div className="inline-actions"><Action disabled={clutchesPage <= 1} onClick={() => setClutchesPage(p => p - 1)}>← Precedente</Action><Action disabled={clutchesPage >= clutchesPagination.totalPages} onClick={() => setClutchesPage(p => p + 1)}>Successiva →</Action></div></div>}
      </section>

      {clutch && <section className={"panel reproduction-detail-section " + (detailTab === "clutches" ? "" : "is-hidden")}>
        <SectionTitle eyebrow="SCHEDA COVATA" title={"Uova · " + prettyDate(clutch.laidOn)}>
          <span className="muted">{eggs.length} visibili</span>
        </SectionTitle>
        <div className="embedded-form"><form className="form-grid" onSubmit={addEggs}>
          <h3 className="form-full">Aggiungi uova in blocco</h3>
          <Input label="Quante uova" name="count" type="number" min={1} max={1000} defaultValue="1" required/>
          <Input label="Prefisso codice (facoltativo)" name="prefix" placeholder="Es. COVATA-A"/>
          <Choice label="Stato iniziale" name="status" defaultValue="unknown" options={eggStatuses}/>
          <Input label="Nota iniziale (facoltativa)" name="notes"/>
          <div className="form-actions form-full"><Action variant="primary">Aggiungi uova</Action></div>
        </form></div>
        {eggs.length === 0 ? <p className="muted">Nessun uovo tracciato singolarmente. Il conteggio della covata rimane separato dalle schede individuali.</p> : <div className="table-wrap"><table><thead><tr><th>Codice</th><th>Stato</th><th>Note</th><th>Azioni</th></tr></thead><tbody>{eggs.map(egg => <tr key={egg.id}>
          <td><input className="compact-input" data-egg-field="code" aria-label={"Codice uovo " + (egg.code || egg.id)} defaultValue={egg.code || ""} placeholder="Codice" onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void saveEggRow(egg, event.currentTarget.closest("tr")); } }}/></td>
          <td><select className="compact-input" data-egg-field="status" aria-label={"Stato uovo " + (egg.code || egg.id)} defaultValue={egg.status} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void saveEggRow(egg, event.currentTarget.closest("tr")); } }}>{eggStatuses.map(o => <option key={o[0]} value={o[0]}>{o[1]}</option>)}</select></td>
          <td><input className="compact-input" data-egg-field="notes" aria-label={"Note uovo " + (egg.code || egg.id)} defaultValue={egg.notes || ""} placeholder="Note" onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void saveEggRow(egg, event.currentTarget.closest("tr")); } }}/></td>
          <td><div className="inline-actions"><Action type="button" onClick={event => void saveEggRow(egg, event.currentTarget.closest("tr"))}>Salva</Action><Action type="button" variant="danger" onClick={() => deleteEgg(egg)}>Elimina</Action></div></td>
        </tr>)}</tbody></table></div>}

        {eggsPagination.totalPages > 1 && <div className="pagination-bar"><span className="muted">Pagina {eggsPagination.page || eggsPage} di {eggsPagination.totalPages} · {eggsPagination.total} uova</span><div className="inline-actions"><Action disabled={eggsPage <= 1} onClick={() => setEggsPage(p => p - 1)}>← Precedente</Action><Action disabled={eggsPage >= eggsPagination.totalPages} onClick={() => setEggsPage(p => p + 1)}>Successiva →</Action></div></div>}
        <SectionTitle eyebrow="CONTROLLI AMBIENTALI" title="Registro incubazione"/>
        <div className="embedded-form"><form className="form-grid" onSubmit={addIncubationLog}>
          <Input label="Data e ora" name="recordedAt" type="datetime-local" defaultValue={localDateTime()} required/>
          <Input label="Evento" name="eventType" defaultValue="controllo" required/>
          <Input label="Temperatura °C" name="temperatureC" type="number" step={0.1}/>
          <Input label="Umidità %" name="humidityPct" type="number" min={0} max={100} step={0.1}/>
          <div className="form-full"><TextArea label="Note" name="notes"/></div>
          <div className="form-actions form-full"><Action variant="primary">Registra controllo</Action></div>
        </form></div>
        {logs.length > 0 && <div className="log-list">{logs.map(log => <article className="log-row" key={log.id}><div><strong>{prettyDate(log.recordedAt)} · {log.eventType}</strong><p>{log.temperatureC ?? "—"} °C · {log.humidityPct ?? "—"}% umidità</p><small>{log.notes || "Nessuna nota"}</small></div><details><summary>Modifica</summary><form className="form-stack" onSubmit={e => editIncubationLog(e, log)}><Input label="Data e ora" name="recordedAt" type="datetime-local" defaultValue={localDateTime(log.recordedAt)} required/><Input label="Evento" name="eventType" defaultValue={log.eventType} required/><Input label="Temperatura °C" name="temperatureC" type="number" step={0.1} defaultValue={log.temperatureC}/><Input label="Umidità %" name="humidityPct" type="number" min={0} max={100} step={0.1} defaultValue={log.humidityPct}/><TextArea label="Note" name="notes" defaultValue={log.notes}/><Action variant="primary">Salva controllo</Action></form></details><Action variant="danger" onClick={() => deleteIncubationLog(log)}>Elimina</Action></article>)}</div>}
        {logsPagination.totalPages > 1 && <div className="pagination-bar"><span className="muted">Pagina {logsPagination.page || logsPage} di {logsPagination.totalPages} · {logsPagination.total} controlli</span><div className="inline-actions"><Action disabled={logsPage <= 1} onClick={() => setLogsPage(p => p - 1)}>← Precedente</Action><Action disabled={logsPage >= logsPagination.totalPages} onClick={() => setLogsPage(p => p + 1)}>Successiva →</Action></div></div>}
      </section>}

      <section className={"panel reproduction-detail-section "+(detailTab==="offspring"?"":"is-hidden")}>
        <SectionTitle eyebrow="NASCITA E CRESCITA" title="Piccoli e lotti di nascita"/>
        <div className="embedded-form"><form className="form-grid" onSubmit={createBatch}>
          <h3 className="form-full">Registra un lotto di piccoli</h3>
          <Input label="Data di nascita / schiusa" name="bornOn" type="date" defaultValue={localDateTime().slice(0, 10)} required/>
          <Input label="Numero di piccoli" name="count" type="number" min={0} max={10000} defaultValue="1" required/>
          <Choice label="Covata di origine (facoltativa)" name="clutchId" options={[["", "Non collegata"], ...clutches.map(c => [c.id, prettyDate(c.laidOn) + " · " + c.eggCount + " uova"])]}/>
          <div className="form-full"><TextArea label="Note" name="notes"/></div>
          <div className="form-actions form-full"><Action variant="primary">Registra lotto</Action></div>
        </form></div>
        {cycleBatches.length === 0 ? <p className="muted">Nessun lotto di piccoli registrato per questo ciclo.</p> : <div className="log-list">{cycleBatches.map(batch => <article className="log-row" key={batch.id}><div><strong>{prettyDate(batch.bornOn)} · {batch.count} piccoli</strong><p>{batch.notes || "Nessuna nota"}</p><small>Covata: {clutches.find(c => c.id === batch.clutchId) ? prettyDate(clutches.find(c => c.id === batch.clutchId).laidOn) : "non collegata"}</small></div><details><summary>Modifica</summary><form className="form-stack" onSubmit={e => editBatch(e, batch)}><Input label="Data di nascita" name="bornOn" type="date" defaultValue={dateValue(batch.bornOn)} required/><Input label="Numero di piccoli" name="count" type="number" min={0} max={10000} defaultValue={batch.count} required/><Choice label="Covata" name="clutchId" defaultValue={batch.clutchId || ""} options={[["", "Non collegata"], ...clutches.map(c => [c.id, prettyDate(c.laidOn)])]}/><TextArea label="Note" name="notes" defaultValue={batch.notes}/><Action variant="primary">Salva lotto</Action></form></details><Action onClick={() => createAnimalCards(batch)}>Crea schede animali</Action><Action variant="danger" onClick={() => deleteBatch(batch)}>Elimina lotto</Action></article>)}</div>}
        {batchesPagination.totalPages > 1 && <div className="pagination-bar"><span className="muted">Pagina {batchesPagination.page || batchesPage} di {batchesPagination.totalPages} · {batchesPagination.total} lotti</span><div className="inline-actions"><Action disabled={batchesPage <= 1} onClick={() => setBatchesPage(p => p - 1)}>← Precedente</Action><Action disabled={batchesPage >= batchesPagination.totalPages} onClick={() => setBatchesPage(p => p + 1)}>Successiva →</Action></div></div>}
      </section>
    </>}
    {animalCardsForm && <Dialog title="Crea schede dei piccoli" description={"Genera schede animale dal lotto del " + prettyDate(animalCardsForm.batch.bornOn) + "."} onClose={() => setAnimalCardsForm(null)} onSubmit={submitAnimalCards} submitLabel="Crea schede" busy={creatingAnimalCards} size="wide">
      <label className="field"><span>Prefisso dei nomi</span><input name="prefix" defaultValue={animalCardsForm.prefix} required maxLength={100} placeholder="Es. Piccolo"/></label>
      <label className="field"><span>Specie</span><input name="species" defaultValue={animalCardsForm.species} required maxLength={160}/></label>
      <label className="field"><span>Numero di schede (1–500)</span><input name="count" type="number" defaultValue={animalCardsForm.count} min={1} max={500} step={1} required/></label>
      <p className="muted form-full">I nomi verranno numerati automaticamente. Le nuove schede useranno sesso “Non specificato” e la data di nascita del lotto.</p>
    </Dialog>}
  </div>;
}