import { useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { formatDate, formatDateTime, getArray, getString, localDateTimeValue, queryString, todayDate } from "../lib/domain";
import type { Locale } from "../lib/domain";
import { translate } from "../lib/i18n";
import { useResource } from "../hooks/useResource";
import { Alert, Badge, Button, DataTable, EmptyState, ErrorState, Field, Icon, IconButton, Input, LoadingState, Modal, PageHeader, Pagination, Panel, PanelHeader, Select, Textarea, useToast } from "../components/ui";

type Item = Record<string, unknown>;
const cycleStatuses = ["planned", "active", "completed", "cancelled"];
const eventTypes = ["pairing", "observation", "ovulation", "gravid", "laying", "live_birth", "incubation_start", "hatch", "loss", "other"];

export function ReproductionPage({ locale, path, navigate }: { locale: Locale; path: string; navigate: (path: string) => void }) {
  const cycleId = path.match(/^\/reproduction-cycles\/([^/?]+)/)?.[1];
  const clutchId = path.match(/^\/clutches\/([^/?]+)/)?.[1];
  if (cycleId) return <CycleDetail id={cycleId} locale={locale} navigate={navigate} />;
  if (clutchId) return <ClutchDetail id={clutchId} locale={locale} navigate={navigate} />;
  return <ReproductionHome locale={locale} path={path} navigate={navigate} />;
}

function ReproductionHome({ locale, path, navigate }: { locale: Locale; path: string; navigate: (path: string) => void }) {
  const t = (key: string) => translate(locale, key);
  const params = new URLSearchParams(path.includes("?") ? path.slice(path.indexOf("?")) : "");
  const tab = params.get("tab") === "offspring" ? "offspring" : "cycles";
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("all");
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cycleForm, setCycleForm] = useState({ name: "", startedOn: todayDate(), endedOn: "", status: "planned", parentAAnimalId: "", parentBAnimalId: "", notes: "" });
  const [offspringModal, setOffspringModal] = useState(false);
  const [offspringForm, setOffspringForm] = useState({ cycleId: "", clutchId: "", bornOn: todayDate(), count: "1", notes: "" });
  const cycles = useResource<{ cycles: Item[]; pagination: { page: number; totalPages: number; total: number } }>(
    tab === "cycles" ? `/reproduction-cycles${queryString({ page, pageSize: 25, status })}` : null
  );
  const batches = useResource<{ offspringBatches: Item[]; pagination: { page: number; totalPages: number; total: number } }>(
    tab === "offspring" ? "/offspring-batches?page=1&pageSize=100" : null
  );
  const animals = useResource<{ animals: Item[] }>("/animals?page=1&pageSize=100&status=active&sort=name");
  const { toast, show } = useToast();

  function openCycle(cycle?: Item) {
    setEditing(cycle ?? null);
    setCycleForm({
      name: getString(cycle, "name"), startedOn: getString(cycle, "startedOn") || todayDate(),
      endedOn: getString(cycle, "endedOn"), status: getString(cycle, "status", "planned"),
      parentAAnimalId: getString(cycle, "parentAAnimalId"), parentBAnimalId: getString(cycle, "parentBAnimalId"),
      notes: getString(cycle, "notes")
    });
    setError(""); setModal(true);
  }
  async function saveCycle(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const body = { name: cycleForm.name || null, startedOn: cycleForm.startedOn, endedOn: cycleForm.endedOn || null, status: cycleForm.status, parentAAnimalId: cycleForm.parentAAnimalId || null, parentBAnimalId: cycleForm.parentBAnimalId || null, notes: cycleForm.notes || null };
    try {
      if (editing) await api.patch(`/reproduction-cycles/${getString(editing, "id")}`, body);
      else await api.post("/reproduction-cycles", body);
      setModal(false); cycles.reload(); show(t("saveSuccess"));
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  async function deleteCycle(cycle: Item) {
    if (!window.confirm(t("confirmDelete"))) return;
    try { await api.delete(`/reproduction-cycles/${getString(cycle, "id")}`); cycles.reload(); show(t("delete")); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }
  async function saveOffspring(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await api.post("/offspring-batches", { cycleId: offspringForm.cycleId, clutchId: offspringForm.clutchId || null, bornOn: offspringForm.bornOn, count: Number(offspringForm.count), notes: offspringForm.notes || null });
      setOffspringModal(false); batches.reload(); show(t("saveSuccess"));
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }

  return <div className="page-stack">
    <PageHeader eyebrow={t("navBreeding")} title={t("breedingTitle")} description={t("breedingSubtitle")} action={<Button onClick={() => tab === "cycles" ? openCycle() : (setOffspringForm({ cycleId: "", clutchId: "", bornOn: todayDate(), count: "1", notes: "" }), setOffspringModal(true))}><Icon name="plus" />{tab === "cycles" ? t("newCycle") : t("addOffspring")}</Button>} />
    <div className="tabs-line"><button className={tab === "cycles" ? "selected" : ""} onClick={() => navigate("/reproduction")}>{t("cycles")}</button><button className={tab === "offspring" ? "selected" : ""} onClick={() => navigate("/reproduction?tab=offspring")}>{t("offspring")}</button></div>
    {tab === "cycles" ? <>
      <Panel className="filters-panel"><div className="filter-row"><Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="all">{t("allStatuses")}</option>{cycleStatuses.map((value) => <option value={value} key={value}>{t(`cycleStatus_${value}`)}</option>)}</Select><span className="muted-note">{cycles.data?.pagination.total ?? 0} {t("cycles")}</span></div></Panel>
      {cycles.loading && !cycles.data ? <LoadingState /> : cycles.error ? <ErrorState message={cycles.error.message} retry={cycles.reload} /> :
        cycles.data?.cycles.length ? <div className="cycle-grid">{cycles.data.cycles.map((cycle) => {
          const parentA = cycle.parentA as Item | null; const parentB = cycle.parentB as Item | null; const count = cycle._count as Item | undefined;
          return <article className="cycle-card" key={getString(cycle, "id")}>
            <div className="cycle-card-top"><span className="cycle-symbol"><Icon name="leaf" size={21} /></span><Badge tone={getString(cycle, "status") === "active" ? "success" : "neutral"}>{t(`cycleStatus_${getString(cycle, "status")}`)}</Badge></div>
            <button className="cycle-title" onClick={() => navigate(`/reproduction-cycles/${getString(cycle, "id")}`)}><strong>{getString(cycle, "name") || t("cycles")}</strong><span>{formatDate(getString(cycle, "startedOn"), locale)}{getString(cycle, "endedOn") ? ` – ${formatDate(getString(cycle, "endedOn"), locale)}` : ""}</span></button>
            <div className="cycle-parents"><span>{t("parentA")}: <b>{getString(parentA, "name") || "—"}</b></span><span>{t("parentB")}: <b>{getString(parentB, "name") || "—"}</b></span></div>
            <div className="cycle-card-bottom"><span>{Number(count?.events ?? 0)} {t("events")} · {Number(count?.clutches ?? 0)} {t("clutches")} · {Number(count?.offspringBatches ?? 0)} {t("offspring")}</span><div className="row-actions"><IconButton label={t("edit")} onClick={() => openCycle(cycle)}><Icon name="edit" /></IconButton><IconButton label={t("delete")} onClick={() => void deleteCycle(cycle)}><Icon name="trash" /></IconButton><IconButton label={t("details")} onClick={() => navigate(`/reproduction-cycles/${getString(cycle, "id")}`)}><Icon name="chevron" /></IconButton></div></div>
          </article>;
        })}</div> : <EmptyState title={t("noRecords")} description={t("emptyHint")} action={<Button onClick={() => openCycle()}>{t("newCycle")}</Button>} />}
      {cycles.data?.pagination && <Pagination page={page} totalPages={cycles.data.pagination.totalPages} onChange={setPage} label={t("page")} />}
    </> : <Panel><PanelHeader title={t("offspring")} action={<Button onClick={() => setOffspringModal(true)}><Icon name="plus" />{t("addOffspring")}</Button>} />
      {batches.loading && !batches.data ? <LoadingState /> : batches.error ? <ErrorState message={batches.error.message} retry={batches.reload} /> :
        batches.data?.offspringBatches.length ? <div className="record-list">{batches.data.offspringBatches.map((batch) => <div className="record-row" key={getString(batch, "id")}><div><strong>{getString(batch, "count")} {t("offspring")}</strong><small>{formatDate(getString(batch, "bornOn"), locale)} · {getString(batch, "cycle") ? getString(batch.cycle, "name") : ""}</small><p>{getString(batch, "notes")}</p></div><div className="row-actions"><IconButton label={t("convertToAnimals")} onClick={() => {
          const names = window.prompt(locale === "it" ? "Inserisci i nomi dei piccoli, uno per riga." : "Enter offspring names, one per line."); if (!names) return;
          const cycle = batch.cycle as Item | undefined; const count = names.split("\n").map((value) => value.trim()).filter(Boolean);
          const species = window.prompt(t("species"), "") ?? "";
          if (!species) return;
          void api.post(`/offspring-batches/${getString(batch, "id")}/animals`, { animals: count.map((name) => ({ name, species, sex: "unknown" })) }).then(() => show(t("saveSuccess"))).catch((reason) => show(reason instanceof ApiError ? reason.message : t("operationFailed")));
        }}><Icon name="plus" /></IconButton><IconButton label={t("details")} onClick={() => navigate(`/reproduction-cycles/${getString(batch, "cycleId")}`)}><Icon name="chevron" /></IconButton><IconButton label={t("delete")} onClick={() => { if (window.confirm(t("confirmDelete"))) void api.delete(`/offspring-batches/${getString(batch, "id")}`).then(() => batches.reload()).catch((reason) => show(reason instanceof ApiError ? reason.message : t("operationFailed"))); }}><Icon name="trash" /></IconButton></div></div>)}</div> : <EmptyState title={t("noRecords")} />}
    </Panel>}

    {modal && <Modal title={editing ? t("edit") : t("newCycle")} onClose={() => setModal(false)} wide>
      <form className="form-stack" onSubmit={saveCycle}>{error && <Alert tone="danger">{error}</Alert>}
        <Field label={t("cycleName")}><Input value={cycleForm.name} onChange={(e) => setCycleForm({ ...cycleForm, name: e.target.value })} /></Field>
        <div className="form-grid"><Field label={t("startedOn")}><Input required type="date" value={cycleForm.startedOn} onChange={(e) => setCycleForm({ ...cycleForm, startedOn: e.target.value })} /></Field><Field label={t("endedOn")}><Input type="date" value={cycleForm.endedOn} onChange={(e) => setCycleForm({ ...cycleForm, endedOn: e.target.value })} /></Field>
        <Field label={t("status")}><Select value={cycleForm.status} onChange={(e) => setCycleForm({ ...cycleForm, status: e.target.value })}>{cycleStatuses.map((value) => <option value={value} key={value}>{t(`cycleStatus_${value}`)}</option>)}</Select></Field></div>
        <div className="form-grid"><Field label={t("parentA")}><Select value={cycleForm.parentAAnimalId} onChange={(e) => setCycleForm({ ...cycleForm, parentAAnimalId: e.target.value })}><option value="">—</option>{(animals.data?.animals ?? []).map((animal) => <option key={getString(animal, "id")} value={getString(animal, "id")}>{getString(animal, "name")}</option>)}</Select></Field><Field label={t("parentB")}><Select value={cycleForm.parentBAnimalId} onChange={(e) => setCycleForm({ ...cycleForm, parentBAnimalId: e.target.value })}><option value="">—</option>{(animals.data?.animals ?? []).map((animal) => <option key={getString(animal, "id")} value={getString(animal, "id")}>{getString(animal, "name")}</option>)}</Select></Field></div>
        <Field label={t("notes")}><Textarea rows={3} value={cycleForm.notes} onChange={(e) => setCycleForm({ ...cycleForm, notes: e.target.value })} /></Field>
        <div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setModal(false)}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("save")}</Button></div>
      </form>
    </Modal>}
    {offspringModal && <Modal title={t("addOffspring")} onClose={() => setOffspringModal(false)}>
      <form className="form-stack" onSubmit={saveOffspring}>{error && <Alert tone="danger">{error}</Alert>}
        <Field label={t("cycles")}><Select required value={offspringForm.cycleId} onChange={(e) => setOffspringForm({ ...offspringForm, cycleId: e.target.value })}><option value="">—</option>{(cycles.data?.cycles ?? []).map((cycle) => <option key={getString(cycle, "id")} value={getString(cycle, "id")}>{getString(cycle, "name") || formatDate(getString(cycle, "startedOn"), locale)}</option>)}</Select></Field>
        <div className="form-grid"><Field label={t("bornOn")}><Input required type="date" value={offspringForm.bornOn} onChange={(e) => setOffspringForm({ ...offspringForm, bornOn: e.target.value })} /></Field><Field label={t("count")}><Input required type="number" min="0" max="10000" value={offspringForm.count} onChange={(e) => setOffspringForm({ ...offspringForm, count: e.target.value })} /></Field></div>
        <Field label={t("notes")}><Textarea rows={2} value={offspringForm.notes} onChange={(e) => setOffspringForm({ ...offspringForm, notes: e.target.value })} /></Field>
        <div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setOffspringModal(false)}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("save")}</Button></div>
      </form>
    </Modal>}
    {toast}
  </div>;
}

function CycleDetail({ id, locale, navigate }: { id: string; locale: Locale; navigate: (path: string) => void }) {
  const t = (key: string) => translate(locale, key);
  const resource = useResource<{ cycle: Item }>(`/reproduction-cycles/${encodeURIComponent(id)}`);
  const [tab, setTab] = useState("events");
  const [modal, setModal] = useState<"event" | "clutch" | "offspring" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Item | null>(null);
  const [eventForm, setEventForm] = useState({ eventType: "pairing", occurredAt: localDateTimeValue(), animalId: "", details: "", temperatureC: "", humidityPct: "" });
  const [clutchForm, setClutchForm] = useState({ laidOn: todayDate(), eggCount: "1", status: "active", incubatorLabel: "", incubationStartedAt: "", notes: "" });
  const [batchForm, setBatchForm] = useState({ clutchId: "", bornOn: todayDate(), count: "1", notes: "" });
  const animals = useResource<{ animals: Item[] }>("/animals?page=1&pageSize=100&status=active&sort=name");
  const { toast, show } = useToast();
  const cycle = resource.data?.cycle;
  const events = getArray<Item>(cycle, "events");
  const clutches = getArray<Item>(cycle, "clutches");
  const offspring = getArray<Item>(cycle, "offspringBatches");

  function openEvent(event?: Item) {
    setEditing(event ?? null);
    setEventForm({
      eventType: getString(event, "eventType", "pairing"),
      occurredAt: event ? localDateTimeValue(new Date(getString(event, "occurredAt"))) : localDateTimeValue(),
      animalId: getString(event, "animalId"), details: getString(event, "details"),
      temperatureC: getString(event, "temperatureC"), humidityPct: getString(event, "humidityPct")
    });
    setError(""); setModal("event");
  }
  async function saveEvent(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const body = { eventType: eventForm.eventType, occurredAt: new Date(eventForm.occurredAt).toISOString(), animalId: eventForm.animalId || null, details: eventForm.details || null, temperatureC: eventForm.temperatureC === "" ? null : Number(eventForm.temperatureC), humidityPct: eventForm.humidityPct === "" ? null : Number(eventForm.humidityPct) };
    try {
      if (editing) await api.patch(`/reproductive-events/${getString(editing, "id")}`, body);
      else await api.post(`/reproduction-cycles/${id}/events`, body);
      setModal(null); resource.reload(); show(t("saveSuccess"));
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  async function deleteEvent(event: Item) {
    if (!window.confirm(t("confirmDelete"))) return;
    try { await api.delete(`/reproductive-events/${getString(event, "id")}`); resource.reload(); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }
  function openClutch(clutch?: Item) {
    setEditing(clutch ?? null);
    setClutchForm({
      laidOn: getString(clutch, "laidOn") || todayDate(),
      eggCount: getString(clutch, "eggCount", "1"),
      status: getString(clutch, "status", "active"),
      incubatorLabel: getString(clutch, "incubatorLabel"),
      incubationStartedAt: getString(clutch, "incubationStartedAt") ? localDateTimeValue(new Date(getString(clutch, "incubationStartedAt"))) : "",
      notes: getString(clutch, "notes")
    });
    setError(""); setModal("clutch");
  }
  async function saveClutch(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const body = { laidOn: clutchForm.laidOn, eggCount: Number(clutchForm.eggCount), status: clutchForm.status, incubatorLabel: clutchForm.incubatorLabel || null, incubationStartedAt: clutchForm.incubationStartedAt ? new Date(clutchForm.incubationStartedAt).toISOString() : null, notes: clutchForm.notes || null };
      if (editing) await api.patch("/clutches/" + getString(editing, "id"), body);
      else await api.post("/clutches", { cycleId: id, ...body });
      setEditing(null); setModal(null); resource.reload(); show(t("saveSuccess"));
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  async function deleteClutch(clutch: Item) {
    if (!window.confirm(t("confirmDelete"))) return;
    try { await api.delete("/clutches/" + getString(clutch, "id")); resource.reload(); show(t("delete")); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }
  function openBatch(batch?: Item) {
    setEditing(batch ?? null);
    setBatchForm({ clutchId: getString(batch, "clutchId"), bornOn: getString(batch, "bornOn") || todayDate(), count: getString(batch, "count", "1"), notes: getString(batch, "notes") });
    setError(""); setModal("offspring");
  }
  async function saveBatch(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const body = { clutchId: batchForm.clutchId || null, bornOn: batchForm.bornOn, count: Number(batchForm.count), notes: batchForm.notes || null };
      if (editing) await api.patch("/offspring-batches/" + getString(editing, "id"), body);
      else await api.post("/offspring-batches", { cycleId: id, ...body });
      setEditing(null); setModal(null); resource.reload(); show(t("saveSuccess"));
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  async function deleteBatch(batch: Item) {
    if (!window.confirm(t("confirmDelete"))) return;
    try { await api.delete("/offspring-batches/" + getString(batch, "id")); resource.reload(); show(t("delete")); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }

  if (resource.loading && !cycle) return <LoadingState />;
  if (resource.error || !cycle) return <ErrorState message={resource.error?.message ?? t("noRecords")} retry={resource.reload} />;
  const parentA = cycle.parentA as Item | undefined; const parentB = cycle.parentB as Item | undefined;
  return <div className="page-stack">
    <div className="back-row"><button className="text-link" onClick={() => navigate("/reproduction")}>← {t("breedingTitle")}</button></div>
    <PageHeader eyebrow={t("cycles")} title={getString(cycle, "name") || t("cycles")} description={`${formatDate(getString(cycle, "startedOn"), locale)} · ${t(`cycleStatus_${getString(cycle, "status")}`)}`} action={<Button onClick={() => { setModal("event"); openEvent(); }}><Icon name="plus" />{t("addEvent")}</Button>} />
    <Panel className="cycle-summary"><div className="cycle-parent"><span>{t("parentA")}</span><strong>{getString(parentA, "name") || "—"}</strong><small>{getString(parentA, "species")}</small></div><div className="cycle-vs">×</div><div className="cycle-parent"><span>{t("parentB")}</span><strong>{getString(parentB, "name") || "—"}</strong><small>{getString(parentB, "species")}</small></div><div className="cycle-stats"><span>{events.length} {t("events")}</span><span>{clutches.length} {t("clutches")}</span><span>{offspring.length} {t("offspring")}</span></div></Panel>
    <div className="tabs-line"><button className={tab === "events" ? "selected" : ""} onClick={() => setTab("events")}>{t("events")}</button><button className={tab === "clutches" ? "selected" : ""} onClick={() => setTab("clutches")}>{t("clutches")}</button><button className={tab === "offspring" ? "selected" : ""} onClick={() => setTab("offspring")}>{t("offspring")}</button></div>
    {tab === "events" && <Panel><PanelHeader title={t("events")} action={<Button size="sm" onClick={() => openEvent()}><Icon name="plus" />{t("addEvent")}</Button>} />
      {events.length ? <div className="timeline">{events.map((event) => <div className="timeline-item" key={getString(event, "id")}><span className="timeline-dot" /><div className="timeline-copy"><span>{formatDateTime(getString(event, "occurredAt"), locale)}</span><strong>{t(`event_${getString(event, "eventType")}`)}</strong><p>{getString(event, "details")}</p><small>{getString(event, "animal") ? getString(event.animal, "name") : ""}</small></div><div className="row-actions"><IconButton label={t("edit")} onClick={() => openEvent(event)}><Icon name="edit" /></IconButton><IconButton label={t("delete")} onClick={() => void deleteEvent(event)}><Icon name="trash" /></IconButton></div></div>)}</div> : <EmptyState title={t("noRecords")} />}
    </Panel>}
    {tab === "clutches" && <Panel><PanelHeader title={t("clutches")} action={<Button size="sm" onClick={() => openClutch()}><Icon name="plus" />{t("addClutch")}</Button>} />
      {clutches.length ? <div className="clutch-grid">{clutches.map((clutch) => <article className="clutch-card" key={getString(clutch, "id")}><button className="clutch-card-open" onClick={() => navigate("/clutches/" + getString(clutch, "id"))}><span className="clutch-symbol"><Icon name="egg" size={20} /></span><strong>{t("clutches")} · {formatDate(getString(clutch, "laidOn"), locale)}</strong><small>{getString(clutch, "eggCount")} {t("eggs")} · {getString(clutch, "incubatorLabel") || "—"}</small><Badge>{getString(clutch, "status")}</Badge></button><div className="row-actions"><IconButton label={t("edit")} onClick={() => openClutch(clutch)}><Icon name="edit" /></IconButton><IconButton label={t("delete")} onClick={() => void deleteClutch(clutch)}><Icon name="trash" /></IconButton></div></article>)}</div> : <EmptyState title={t("noRecords")} />}
    </Panel>}
    {tab === "offspring" && <Panel><PanelHeader title={t("offspring")} action={<Button size="sm" onClick={() => openBatch()}><Icon name="plus" />{t("addOffspring")}</Button>} />
      {offspring.length ? <div className="record-list">{offspring.map((batch) => <div className="record-row" key={getString(batch, "id")}><div><strong>{getString(batch, "count")} {t("offspring")}</strong><small>{formatDate(getString(batch, "bornOn"), locale)}</small><p>{getString(batch, "notes")}</p></div><div className="row-actions"><IconButton label={t("convertToAnimals")} onClick={() => {
        const input = window.prompt(locale === "it" ? "Nomi dei piccoli, uno per riga." : "Offspring names, one per line."); if (!input) return;
        const names = input.split("\n").map((item) => item.trim()).filter(Boolean);
        const species = window.prompt(t("species")); if (!species) return;
        void api.post(`/offspring-batches/${getString(batch, "id")}/animals`, { animals: names.map((name) => ({ name, species, sex: "unknown" })) }).then(() => { resource.reload(); show(t("saveSuccess")); }).catch((reason) => show(reason instanceof ApiError ? reason.message : t("operationFailed")));
      }}><Icon name="plus" /></IconButton><IconButton label={t("edit")} onClick={() => openBatch(batch)}><Icon name="edit" /></IconButton><IconButton label={t("delete")} onClick={() => void deleteBatch(batch)}><Icon name="trash" /></IconButton></div></div>)}</div> : <EmptyState title={t("noRecords")} />}
    </Panel>}
    {modal === "event" && <Modal title={editing ? t("edit") : t("addEvent")} onClose={() => setModal(null)}>
      <form className="form-stack" onSubmit={saveEvent}>{error && <Alert tone="danger">{error}</Alert>}
        <Field label={t("eventType")}><Select value={eventForm.eventType} onChange={(e) => setEventForm({ ...eventForm, eventType: e.target.value })}>{eventTypes.map((value) => <option key={value} value={value}>{t(`event_${value}`)}</option>)}</Select></Field>
        <Field label={t("occurredAt")}><Input required type="datetime-local" value={eventForm.occurredAt} onChange={(e) => setEventForm({ ...eventForm, occurredAt: e.target.value })} /></Field>
        <Field label={t("animalDetail")}><Select value={eventForm.animalId} onChange={(e) => setEventForm({ ...eventForm, animalId: e.target.value })}><option value="">—</option>{(animals.data?.animals ?? []).map((animal) => <option key={getString(animal, "id")} value={getString(animal, "id")}>{getString(animal, "name")}</option>)}</Select></Field>
        <div className="form-grid"><Field label={t("temperature")}><Input type="number" step="0.1" value={eventForm.temperatureC} onChange={(e) => setEventForm({ ...eventForm, temperatureC: e.target.value })} /></Field><Field label={t("humidity")}><Input type="number" min="0" max="100" step="0.1" value={eventForm.humidityPct} onChange={(e) => setEventForm({ ...eventForm, humidityPct: e.target.value })} /></Field></div>
        <Field label={t("notes")}><Textarea rows={3} value={eventForm.details} onChange={(e) => setEventForm({ ...eventForm, details: e.target.value })} /></Field>
        <div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setModal(null)}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("save")}</Button></div>
      </form>
    </Modal>}
    {modal === "clutch" && <Modal title={editing ? t("edit") : t("addClutch")} onClose={() => { setEditing(null); setModal(null); }}>
      <form className="form-stack" onSubmit={saveClutch}>{error && <Alert tone="danger">{error}</Alert>}
        <div className="form-grid"><Field label={t("laidOn")}><Input required type="date" value={clutchForm.laidOn} onChange={(e) => setClutchForm({ ...clutchForm, laidOn: e.target.value })} /></Field><Field label={t("eggCount")}><Input required type="number" min="0" value={clutchForm.eggCount} onChange={(e) => setClutchForm({ ...clutchForm, eggCount: e.target.value })} /></Field></div>
        <Field label={t("status")}><Input value={clutchForm.status} onChange={(e) => setClutchForm({ ...clutchForm, status: e.target.value })} /></Field>
        <Field label={t("incubator")}><Input value={clutchForm.incubatorLabel} onChange={(e) => setClutchForm({ ...clutchForm, incubatorLabel: e.target.value })} /></Field>
        <Field label={t("notes")}><Textarea rows={3} value={clutchForm.notes} onChange={(e) => setClutchForm({ ...clutchForm, notes: e.target.value })} /></Field>
        <div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setModal(null)}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("save")}</Button></div>
      </form>
    </Modal>}
    {modal === "offspring" && <Modal title={editing ? t("edit") : t("addOffspring")} onClose={() => { setEditing(null); setModal(null); }}>
      <form className="form-stack" onSubmit={saveBatch}>{error && <Alert tone="danger">{error}</Alert>}
        <Field label={t("bornOn")}><Input required type="date" value={batchForm.bornOn} onChange={(e) => setBatchForm({ ...batchForm, bornOn: e.target.value })} /></Field>
        <Field label={t("clutches")}><Select value={batchForm.clutchId} onChange={(e) => setBatchForm({ ...batchForm, clutchId: e.target.value })}><option value="">—</option>{clutches.map((clutch) => <option key={getString(clutch, "id")} value={getString(clutch, "id")}>{formatDate(getString(clutch, "laidOn"), locale)}</option>)}</Select></Field>
        <Field label={t("count")}><Input required type="number" min="0" max="10000" value={batchForm.count} onChange={(e) => setBatchForm({ ...batchForm, count: e.target.value })} /></Field>
        <Field label={t("notes")}><Textarea rows={3} value={batchForm.notes} onChange={(e) => setBatchForm({ ...batchForm, notes: e.target.value })} /></Field>
        <div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setModal(null)}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("save")}</Button></div>
      </form>
    </Modal>}
    {toast}
  </div>;
}

function ClutchDetail({ id, locale, navigate }: { id: string; locale: Locale; navigate: (path: string) => void }) {
  const t = (key: string) => translate(locale, key);
  const resource = useResource<{ clutch: Item }>(`/clutches/${encodeURIComponent(id)}`);
  const [mode, setMode] = useState<"eggs" | "log" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [eggLines, setEggLines] = useState("1\n2");
  const [logForm, setLogForm] = useState({ recordedAt: localDateTimeValue(), temperatureC: "", humidityPct: "", eventType: "measurement", notes: "" });
  const [editingEgg, setEditingEgg] = useState<Item | null>(null);
  const [editingLog, setEditingLog] = useState<Item | null>(null);
  const clutch = resource.data?.clutch;
  const eggs = getArray<Item>(clutch, "eggs");
  const logs = getArray<Item>(clutch, "incubationLogs");
  const cycle = clutch?.cycle as Item | undefined;
  const { toast, show } = useToast();

  async function addEggs(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const codes = eggLines.split("\n").map((line) => line.trim()).filter(Boolean);
    try { await api.post(`/clutches/${id}/eggs`, { eggs: codes.map((code) => ({ code, status: "unknown" })) }); setMode(null); resource.reload(); show(t("saveSuccess")); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  function openLog(log?: Item) {
    setEditingLog(log ?? null);
    setLogForm({
      recordedAt: log ? localDateTimeValue(new Date(getString(log, "recordedAt"))) : localDateTimeValue(),
      temperatureC: getString(log, "temperatureC"),
      humidityPct: getString(log, "humidityPct"),
      eventType: getString(log, "eventType", "measurement"),
      notes: getString(log, "notes")
    });
    setError(""); setMode("log");
  }
  async function addLog(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const body = {
        recordedAt: new Date(logForm.recordedAt).toISOString(),
        temperatureC: logForm.temperatureC === "" ? null : Number(logForm.temperatureC),
        humidityPct: logForm.humidityPct === "" ? null : Number(logForm.humidityPct),
        eventType: logForm.eventType, notes: logForm.notes || null
      };
      if (editingLog) await api.patch("/incubation-logs/" + getString(editingLog, "id"), body);
      else await api.post("/clutches/" + id + "/incubation-logs", body);
      setMode(null); setEditingLog(null); resource.reload(); show(t("saveSuccess"));
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  async function deleteEgg(egg: Item) {
    if (!window.confirm(t("confirmDelete"))) return;
    try { await api.delete(`/eggs/${getString(egg, "id")}`); resource.reload(); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }
  async function deleteLog(log: Item) {
    if (!window.confirm(t("confirmDelete"))) return;
    try { await api.delete(`/incubation-logs/${getString(log, "id")}`); resource.reload(); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }

  if (resource.loading && !clutch) return <LoadingState />;
  if (resource.error || !clutch) return <ErrorState message={resource.error?.message ?? t("noRecords")} retry={resource.reload} />;
  return <div className="page-stack">
    <div className="back-row"><button className="text-link" onClick={() => navigate(`/reproduction-cycles/${getString(cycle, "id")}`)}>← {getString(cycle, "name") || t("cycles")}</button></div>
    <PageHeader eyebrow={t("clutches")} title={formatDate(getString(clutch, "laidOn"), locale)} description={`${getString(clutch, "eggCount")} ${t("eggs")} · ${getString(clutch, "incubatorLabel") || "—"}`} action={<Button onClick={() => openLog()}><Icon name="plus" />{t("addIncubationLog")}</Button>} />
    <div className="detail-grid">
      <Panel><PanelHeader title={t("eggs")} action={<Button size="sm" onClick={() => setMode("eggs")}><Icon name="plus" />{t("addEggs")}</Button>} />
        {eggs.length ? <div className="egg-grid">{eggs.map((egg) => <div className="egg-card" key={getString(egg, "id")}><span><Icon name="egg" size={18} /></span><strong>{getString(egg, "code") || "—"}</strong><Badge>{getString(egg, "status")}</Badge><div className="row-actions"><IconButton label={t("edit")} onClick={() => setEditingEgg(egg)}><Icon name="edit" /></IconButton><IconButton label={t("delete")} onClick={() => void deleteEgg(egg)}><Icon name="trash" /></IconButton></div></div>)}</div> : <EmptyState title={t("noRecords")} />}
      </Panel>
      <Panel><PanelHeader title={t("incubation")} action={<Button size="sm" onClick={() => setMode("log")}><Icon name="plus" />{t("addIncubationLog")}</Button>} />
        {logs.length ? <div className="record-list">{logs.map((log) => <div className="record-row" key={getString(log, "id")}><div><strong>{getString(log, "eventType")}</strong><small>{formatDateTime(getString(log, "recordedAt"), locale)}</small><p>{getString(log, "temperatureC") ? `${getString(log, "temperatureC")} °C` : "—"} · {getString(log, "humidityPct") ? `${getString(log, "humidityPct")} %` : "—"}</p><small>{getString(log, "notes")}</small></div><div className="row-actions"><IconButton label={t("edit")} onClick={() => openLog(log)}><Icon name="edit" /></IconButton><IconButton label={t("delete")} onClick={() => void deleteLog(log)}><Icon name="trash" /></IconButton></div></div>)}</div> : <EmptyState title={t("noRecords")} />}
      </Panel>
    </div>
    {mode === "eggs" && <Modal title={t("addEggs")} onClose={() => setMode(null)}><form className="form-stack" onSubmit={addEggs}>{error && <Alert tone="danger">{error}</Alert>}<Field label={t("eggCode")} hint={locale === "it" ? "Un codice per riga; ogni riga crea un uovo." : "One code per line; each line creates one egg."}><Textarea rows={5} value={eggLines} onChange={(e) => setEggLines(e.target.value)} /></Field><div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setMode(null)}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("save")}</Button></div></form></Modal>}
    {mode === "log" && <Modal title={editingLog ? t("edit") : t("addIncubationLog")} onClose={() => { setEditingLog(null); setMode(null); }}><form className="form-stack" onSubmit={addLog}>{error && <Alert tone="danger">{error}</Alert>}
      <Field label={t("recordedAt")}><Input type="datetime-local" required value={logForm.recordedAt} onChange={(e) => setLogForm({ ...logForm, recordedAt: e.target.value })} /></Field>
      <div className="form-grid"><Field label={t("temperature")}><Input type="number" step="0.1" value={logForm.temperatureC} onChange={(e) => setLogForm({ ...logForm, temperatureC: e.target.value })} /></Field><Field label={t("humidity")}><Input type="number" min="0" max="100" step="0.1" value={logForm.humidityPct} onChange={(e) => setLogForm({ ...logForm, humidityPct: e.target.value })} /></Field></div>
      <Field label={t("eventType")}><Input value={logForm.eventType} onChange={(e) => setLogForm({ ...logForm, eventType: e.target.value })} /></Field><Field label={t("notes")}><Textarea rows={3} value={logForm.notes} onChange={(e) => setLogForm({ ...logForm, notes: e.target.value })} /></Field>
      <div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setMode(null)}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("save")}</Button></div>
    </form></Modal>}
    {editingEgg && <Modal title={t("edit")} onClose={() => setEditingEgg(null)}><form className="form-stack" onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { await api.patch(`/eggs/${getString(editingEgg, "id")}`, { code: getString(editingEgg, "code") || null, status: getString(editingEgg, "status"), notes: getString(editingEgg, "notes") || null }); setEditingEgg(null); resource.reload(); show(t("saveSuccess")); } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); } finally { setBusy(false); } }}><Field label={t("eggCode")}><Input value={getString(editingEgg, "code")} onChange={(e) => setEditingEgg({ ...editingEgg, code: e.target.value })} /></Field><Field label={t("eggStatus")}><Input value={getString(editingEgg, "status")} onChange={(e) => setEditingEgg({ ...editingEgg, status: e.target.value })} /></Field><Field label={t("notes")}><Textarea value={getString(editingEgg, "notes")} onChange={(e) => setEditingEgg({ ...editingEgg, notes: e.target.value })} /></Field><div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setEditingEgg(null)}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("save")}</Button></div></form></Modal>}
    {toast}
  </div>;
}