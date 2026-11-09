import { useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { celsiusToTemperature, formatDate, formatDateTime, formatTemperature, getArray, getString, localDateTimeValue, queryString, temperatureToCelsius, temperatureUnitLabel, todayDate } from "../lib/domain";
import type { Locale } from "../lib/domain";
import { translate } from "../lib/i18n";
import { useResource } from "../hooks/useResource";
import { RemoteSelect } from "../components/RemoteSelect";
import { Alert, Badge, Button, DataTable, EmptyState, ErrorState, Field, Icon, IconButton, Input, LoadingState, Modal, PageHeader, Pagination, Panel, PanelHeader, Select, Textarea, useToast } from "../components/ui";
export function CycleDetail({ id, locale, navigate }: { id: string; locale: Locale; navigate: (path: string) => void }) {
  const t = (key: string) => translate(locale, key);
  const resource = useResource<{ cycle: ReproductionCycleDto }>(`/reproduction-cycles/${encodeURIComponent(id)}`);
  const [tab, setTab] = useState("events");
  const [modal, setModal] = useState<"event" | "clutch" | "offspring" | null>(null);
  const [conversionBatch, setConversionBatch] = useState<CycleDetailEditTarget | null>(null);
  const [conversionBusy, setConversionBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Item | null>(null);
  const [eventForm, setEventForm] = useState({ eventType: "pairing", occurredAt: localDateTimeValue(), animalId: "", details: "", temperatureC: "", humidityPct: "" });
  const [clutchForm, setClutchForm] = useState({ laidOn: todayDate(), eggCount: "1", status: "active", incubatorLabel: "", incubationStartedAt: "", notes: "" });
  const [batchForm, setBatchForm] = useState({ clutchId: "", bornOn: todayDate(), count: "1", notes: "" });
  const { toast, show } = useToast();
  const cycle = resource.data?.cycle;
  const events = cycle?.events ?? [];
  const clutches = cycle?.clutches ?? [];
  const offspring = cycle?.offspringBatches ?? [];

  function openEvent(event?: ReproductiveEventDto) {
    setEditing(event ?? null);
    setEventForm({
      eventType: getString(event, "eventType", "pairing"),
      occurredAt: event ? localDateTimeValue(new Date(getString(event, "occurredAt"))) : localDateTimeValue(),
      animalId: getString(event, "animalId"), details: getString(event, "details"),
      temperatureC: getString(event, "temperatureC") === "" ? "" : String(celsiusToTemperature(getString(event, "temperatureC"))), humidityPct: getString(event, "humidityPct")
    });
    setError(""); setModal("event");
  }
  async function saveEvent(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const body = { eventType: eventForm.eventType, occurredAt: new Date(eventForm.occurredAt).toISOString(), animalId: eventForm.animalId || null, details: eventForm.details || null, temperatureC: eventForm.temperatureC === "" ? null : temperatureToCelsius(eventForm.temperatureC), humidityPct: eventForm.humidityPct === "" ? null : Number(eventForm.humidityPct) };
    try {
      if (editing) await api.patch(`/reproductive-events/${getString(editing, "id")}`, body);
      else await api.post(`/reproduction-cycles/${id}/events`, body);
      setModal(null); resource.reload(); show(t("saveSuccess"));
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  async function deleteEvent(event: ReproductiveEventDto) {
    if (!window.confirm(t("confirmDelete"))) return;
    try { await api.delete(`/reproductive-events/${getString(event, "id")}`); resource.reload(); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }
  function openClutch(clutch?: ClutchDto) {
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
  async function deleteClutch(clutch: ClutchDto) {
    if (!window.confirm(t("confirmDelete"))) return;
    try { await api.delete("/clutches/" + getString(clutch, "id")); resource.reload(); show(t("delete")); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }
  function openBatch(batch?: OffspringBatchDto) {
    setEditing(batch ?? null);
    setBatchForm({ clutchId: getString(batch, "clutchId"), bornOn: getString(batch, "bornOn") || todayDate(), count: getString(batch, "count", "1"), notes: getString(batch, "notes") });
    setError(""); setModal("offspring");
  }
  async function convertBatchAnimals(names: string[], species: string) {
    if (!conversionBatch) return;
    setConversionBusy(true);
    try {
      await api.post(`/offspring-batches/${getString(conversionBatch, "id")}/animals`, { animals: names.map((name) => ({ name, species, sex: "unknown" })) });
      setConversionBatch(null); resource.reload(); show(t("saveSuccess"));
    } catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setConversionBusy(false); }
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
  async function deleteBatch(batch: OffspringBatchDto) {
    if (!window.confirm(t("confirmDelete"))) return;
    try { await api.delete("/offspring-batches/" + getString(batch, "id")); resource.reload(); show(t("delete")); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }

  if (resource.loading && !cycle) return <LoadingState />;
  if (resource.error || !cycle) return <ErrorState message={resource.error?.message ?? t("noRecords")} retry={resource.reload} />;
  const parentA = cycle.parentA; const parentB = cycle.parentB;
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
      {offspring.length ? <div className="record-list">{offspring.map((batch) => <div className="record-row" key={getString(batch, "id")}><div><strong>{getString(batch, "count")} {t("offspring")}</strong><small>{formatDate(getString(batch, "bornOn"), locale)}</small><p>{getString(batch, "notes")}</p></div><div className="row-actions"><IconButton label={t("convertToAnimals")} onClick={() => setConversionBatch(batch)}><Icon name="plus" /></IconButton><IconButton label={t("edit")} onClick={() => openBatch(batch)}><Icon name="edit" /></IconButton><IconButton label={t("delete")} onClick={() => void deleteBatch(batch)}><Icon name="trash" /></IconButton></div></div>)}</div> : <EmptyState title={t("noRecords")} />}
    </Panel>}
    {conversionBatch && <OffspringConversionModal key={getString(conversionBatch, "id")} batch={conversionBatch} locale={locale} busy={conversionBusy} onClose={() => setConversionBatch(null)} onSubmit={convertBatchAnimals} />}
    {modal === "event" && <Modal title={editing ? t("edit") : t("addEvent")} onClose={() => setModal(null)}>
      <form className="form-stack" onSubmit={saveEvent}>{error && <Alert tone="danger">{error}</Alert>}
        <Field label={t("eventType")}><Select value={eventForm.eventType} onChange={(e) => setEventForm({ ...eventForm, eventType: e.target.value })}>{eventTypes.map((value) => <option key={value} value={value}>{t(`event_${value}`)}</option>)}</Select></Field>
        <Field label={t("occurredAt")}><Input required type="datetime-local" value={eventForm.occurredAt} onChange={(e) => setEventForm({ ...eventForm, occurredAt: e.target.value })} /></Field>
      <RemoteSelect label={t("animalDetail")} value={eventForm.animalId} onChange={(animalId) => setEventForm({ ...eventForm, animalId })} endpoint="/animals" responseKey="animals" filters={{ status: "active", sort: "name" }} detailEndpoint={(animalId) => `/animals/${encodeURIComponent(animalId)}`} detailKey="animal" locale={locale} />
        <div className="form-grid"><Field label={`${t("temperature").replace(/°C|°F/, temperatureUnitLabel())}`}><Input type="number" step="0.1" value={eventForm.temperatureC} onChange={(e) => setEventForm({ ...eventForm, temperatureC: e.target.value })} /></Field><Field label={t("humidity")}><Input type="number" min="0" max="100" step="0.1" value={eventForm.humidityPct} onChange={(e) => setEventForm({ ...eventForm, humidityPct: e.target.value })} /></Field></div>
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