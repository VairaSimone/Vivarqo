import { useState, type FormEvent } from "react";
import type { ClutchDto, OffspringBatchDto, ReproductiveEventDto, ReproductionCycleDto } from "@vivarqo/contracts/reproduction";
import { eventTypes } from "./types";
import { OffspringConversionModal } from "./OffspringConversionModal";
import { ReproductiveEventEditor } from "./ReproductiveEventEditor";
import { ClutchEditor } from "./ClutchEditor";
import { OffspringManagement } from "./OffspringManagement";
type CycleDetailEditTarget = ReproductiveEventDto | ClutchDto | OffspringBatchDto;
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
  const [conversionBatch, setConversionBatch] = useState<OffspringBatchDto | null>(null);
  const [conversionBusy, setConversionBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<CycleDetailEditTarget | null>(null);
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
    {conversionBatch && <OffspringConversionModal key={getString(conversionBatch, "id")} batch={conversionBatch} locale={locale} busy={conversionBusy} onClose={() => setConversionBatch(null)} onSubmit={convertBatchAnimals} />}
    {modal === "event" && <ReproductiveEventEditor locale={locale} isEditing={Boolean(editing)} form={eventForm} onChange={setEventForm} error={error} busy={busy} onClose={() => setModal(null)} onSubmit={saveEvent} />}
    {modal === "clutch" && <ClutchEditor locale={locale} isEditing={Boolean(editing)} form={clutchForm} onChange={setClutchForm} error={error} busy={busy} onClose={() => { setEditing(null); setModal(null); }} onSubmit={saveClutch} />}
    {tab === "offspring" && <OffspringManagement locale={locale} batches={offspring} clutches={clutches} editorOpen={modal === "offspring"} isEditing={Boolean(editing)} form={batchForm} error={error} busy={busy} onAdd={() => openBatch()} onConvert={setConversionBatch} onEdit={openBatch} onDelete={deleteBatch} onChange={setBatchForm} onClose={() => { setEditing(null); setModal(null); }} onSubmit={saveBatch} />}
    {toast}
  </div>;
}