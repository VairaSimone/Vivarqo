import { useState, type FormEvent } from "react";
import type { ClutchDetailDto, EggDto, IncubationLogDto } from "@vivarqo/contracts/reproduction";
import { EggManagement } from "./EggManagement";
import { IncubationLogs } from "./IncubationLogs";
import { api, ApiError } from "../../lib/api";
import { celsiusToTemperature, formatDate, formatDateTime, formatTemperature, getArray, getString, localDateTimeValue, queryString, temperatureToCelsius, temperatureUnitLabel, todayDate } from "../../lib/domain";
import type { Locale } from "../../lib/domain";
import { translate } from "../../lib/i18n";
import { useResource } from "../../hooks/useResource";
import { RemoteSelect } from "../../components/RemoteSelect";
import { Alert, Badge, Button, DataTable, EmptyState, ErrorState, Field, Icon, IconButton, Input, LoadingState, Modal, PageHeader, Pagination, Panel, PanelHeader, Select, Textarea, useToast } from "../../components/ui";
export function ClutchDetail({ id, locale, navigate }: { id: string; locale: Locale; navigate: (path: string) => void }) {
  const t = (key: string) => translate(locale, key);
  const resource = useResource<{ clutch: ClutchDetailDto }>(`/clutches/${encodeURIComponent(id)}`);
  const [mode, setMode] = useState<"eggs" | "log" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [eggLines, setEggLines] = useState("1\n2");
  const [logForm, setLogForm] = useState({ recordedAt: localDateTimeValue(), temperatureC: "", humidityPct: "", eventType: "measurement", notes: "" });
  const [editingEgg, setEditingEgg] = useState<EggDto | null>(null);
  const [eggPhotoBusy, setEggPhotoBusy] = useState(false);
  const [editingLog, setEditingLog] = useState<IncubationLogDto | null>(null);
  const [measuringEgg, setMeasuringEgg] = useState<EggDto | null>(null);
  const [editingMeasurement, setEditingMeasurement] = useState<{ id: string; measuredAt: string; weightG: number; notes: string | null } | null>(null);
  const [eggMeasurements, setEggMeasurements] = useState<Array<{ id: string; measuredAt: string; weightG: number; notes: string | null }>>([]);
  const [measurementForm, setMeasurementForm] = useState({ measuredAt: localDateTimeValue(), weightG: "", notes: "" });
  const [eggsPage, setEggsPage] = useState(1);
  const [logsPage, setLogsPage] = useState(1);
  const clutch = resource.data?.clutch;
  const eggsResource = useResource<{ eggs: EggDto[]; pagination: { page: number; totalPages: number; total: number } }>(clutch ? `/clutches/${encodeURIComponent(id)}/eggs?page=${eggsPage}&pageSize=25` : null);
  const incubatorsResource = useResource<{ incubators: Array<{ id: string; name: string; identifier: string | null }> }>("/incubators");
  const transfersResource = useResource<{ transfers: Array<{ id: string; transferredAt: string; fromPosition: string | null; toPosition: string | null; fromIncubator: { name: string } | null; toIncubator: { name: string } | null; notes: string | null }> }>(editingEgg ? `/eggs/${encodeURIComponent(editingEgg.id)}/incubator-transfers` : null);
  const maintenanceResource = useResource<{ maintenance: Array<{ id: string; occurredAt: string; eventType: string; notes: string | null }> }>(clutch?.incubatorId ? `/incubators/${encodeURIComponent(clutch.incubatorId)}/maintenance` : null);
  const logsResource = useResource<{ logs: IncubationLogDto[]; pagination: { page: number; totalPages: number; total: number } }>(clutch ? `/clutches/${encodeURIComponent(id)}/incubation-logs?page=${logsPage}&pageSize=100` : null);
  const eggs = eggsResource.data?.eggs ?? clutch?.eggs ?? [];
  const logs = logsResource.data?.logs ?? clutch?.incubationLogs ?? [];
  const cycle = clutch?.cycle;
  const { toast, show } = useToast();

  async function addEggs(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const codes = eggLines.split("\n").map((line) => line.trim()).filter(Boolean);
    try { await api.post(`/clutches/${id}/eggs`, { eggs: codes.map((code) => ({ code, status: "incubating" })) }); setMode(null); resource.reload(); eggsResource.reload(); show(t("saveSuccess")); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  function openLog(log?: IncubationLogDto) {
    setEditingLog(log ?? null);
    setLogForm({
      recordedAt: log ? localDateTimeValue(new Date(getString(log, "recordedAt"))) : localDateTimeValue(),
      temperatureC: getString(log, "temperatureC") === "" ? "" : String(celsiusToTemperature(getString(log, "temperatureC"))),
      humidityPct: getString(log, "humidityPct"),
      eventType: getString(log, "eventType", "measurement"),
      notes: getString(log, "notes")
    });
    setError(""); setMode("log");
  }
  async function openEggMeasurements(egg: EggDto) {
    setMeasuringEgg(egg);
    setEditingMeasurement(null);
    setMeasurementForm({ measuredAt: localDateTimeValue(), weightG: "", notes: "" });
    try {
      const response = await api.get<{ measurements: Array<{ id: string; measuredAt: string; weightG: number; notes: string | null }> }>(`/eggs/${encodeURIComponent(egg.id)}/measurements`);
      setEggMeasurements(response.measurements);
    } catch (reason) {
      setEggMeasurements([]);
      show(reason instanceof ApiError ? reason.message : t("operationFailed"));
    }
  }
  async function saveEggMeasurement(event: FormEvent) {
    event.preventDefault();
    if (!measuringEgg) return;
    setBusy(true);
    try {
      const body = {
        measuredAt: new Date(measurementForm.measuredAt).toISOString(),
        weightG: Number(measurementForm.weightG),
        notes: measurementForm.notes || null,
      };
      if (editingMeasurement) {
        await api.patch(`/eggs/${encodeURIComponent(measuringEgg.id)}/measurements/${encodeURIComponent(editingMeasurement.id)}`, body);
      } else {
        await api.post(`/eggs/${encodeURIComponent(measuringEgg.id)}/measurements`, body);
      }
      const response = await api.get<{ measurements: Array<{ id: string; measuredAt: string; weightG: number; notes: string | null }> }>(`/eggs/${encodeURIComponent(measuringEgg.id)}/measurements`);
      setEggMeasurements(response.measurements);
      eggsResource.reload();
      show(t("saveSuccess"));
      setEditingMeasurement(null);
      setMeasurementForm({ measuredAt: localDateTimeValue(), weightG: "", notes: "" });
    } catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }

  function editEggMeasurement(measurement: { id: string; measuredAt: string; weightG: number; notes: string | null }) {
    setEditingMeasurement(measurement);
    setMeasurementForm({
      measuredAt: localDateTimeValue(new Date(measurement.measuredAt)),
      weightG: String(measurement.weightG),
      notes: measurement.notes ?? "",
    });
  }

  async function deleteEggMeasurement(measurement: { id: string }) {
    if (!measuringEgg || !window.confirm(t("confirmDelete"))) return;
    try {
      await api.delete(`/eggs/${encodeURIComponent(measuringEgg.id)}/measurements/${encodeURIComponent(measurement.id)}`);
      const response = await api.get<{ measurements: Array<{ id: string; measuredAt: string; weightG: number; notes: string | null }> }>(`/eggs/${encodeURIComponent(measuringEgg.id)}/measurements`);
      setEggMeasurements(response.measurements);
      if (editingMeasurement?.id === measurement.id) {
        setEditingMeasurement(null);
        setMeasurementForm({ measuredAt: localDateTimeValue(), weightG: "", notes: "" });
      }
      show(t("delete"));
    } catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }

  async function addIncubatorMaintenance() {
    if (!clutch?.incubatorId) return;
    const eventType = window.prompt(locale === "it" ? "Tipo: cleaning, calibration, repair, inspection, other" : "Type: cleaning, calibration, repair, inspection, other", "inspection");
    if (!eventType) return;
    if (!["cleaning", "calibration", "repair", "inspection", "other"].includes(eventType)) { show(locale === "it" ? "Tipo intervento non valido." : "Invalid maintenance type."); return; }
    const notes = window.prompt(locale === "it" ? "Note manutenzione (facoltative)" : "Maintenance notes (optional)") ?? "";
    try {
      await api.post(`/incubators/${encodeURIComponent(clutch.incubatorId)}/maintenance`, { occurredAt: new Date().toISOString(), eventType, notes: notes || null });
      maintenanceResource.reload();
      show(t("saveSuccess"));
    } catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }

  async function addLog(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const body = {
        recordedAt: new Date(logForm.recordedAt).toISOString(),
        temperatureC: logForm.temperatureC === "" ? null : temperatureToCelsius(logForm.temperatureC),
        humidityPct: logForm.humidityPct === "" ? null : Number(logForm.humidityPct),
        eventType: logForm.eventType, notes: logForm.notes || null
      };
      if (editingLog) await api.patch("/incubation-logs/" + getString(editingLog, "id"), body);
      else await api.post("/clutches/" + id + "/incubation-logs", body);
      setMode(null); setEditingLog(null); resource.reload(); logsResource.reload(); show(t("saveSuccess"));
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  async function deleteEgg(egg: EggDto) {
    if (!window.confirm(t("confirmDelete"))) return;
    try { await api.delete(`/eggs/${getString(egg, "id")}`); resource.reload(); eggsResource.reload(); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }
  async function uploadEggPhoto(file: File) {
    if (!editingEgg) return;
    setEggPhotoBusy(true);
    try {
      const result = await api.upload<{ photoUrl: string }>(`/eggs/${encodeURIComponent(editingEgg.id)}/photo`, file);
      setEditingEgg({ ...editingEgg, photoUrl: result.photoUrl });
      eggsResource.reload(); resource.reload();
      show(t("saveSuccess"));
    } catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setEggPhotoBusy(false); }
  }
  async function deleteEggPhoto() {
    if (!editingEgg?.photoUrl) return;
    setEggPhotoBusy(true);
    try {
      await api.delete(`/eggs/${encodeURIComponent(editingEgg.id)}/photo`);
      setEditingEgg({ ...editingEgg, photoUrl: null });
      eggsResource.reload(); resource.reload();
    } catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setEggPhotoBusy(false); }
  }

  async function deleteLog(log: IncubationLogDto) {
    if (!window.confirm(t("confirmDelete"))) return;
    try { await api.delete(`/incubation-logs/${getString(log, "id")}`); resource.reload(); logsResource.reload(); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }

  if (resource.loading && !clutch) return <LoadingState />;
  if (resource.error || !clutch) return <ErrorState message={resource.error?.message ?? t("noRecords")} retry={resource.reload} />;
  return <div className="page-stack">
    <div className="back-row"><button className="text-link" onClick={() => navigate(`/reproduction-cycles/${getString(cycle, "id")}`)}>← {getString(cycle, "name") || t("cycles")}</button></div>
    <PageHeader eyebrow={t("clutches")} title={formatDate(getString(clutch, "laidOn"), locale)} description={`${locale === "it" ? "Uova registrate" : "Eggs registered"}: ${eggsResource.data?.pagination.total ?? clutch._count?.eggs ?? eggs.length} / ${getString(clutch, "eggCount")} · ${getString(clutch, "incubatorLabel") || "—"}`} action={<Button onClick={() => openLog()}><Icon name="plus" />{t("addIncubationLog")}</Button>} />
    {clutch.eggSummary && <Panel>
      <PanelHeader title={locale === "it" ? "Riepilogo covata" : "Clutch summary"} />
      <div className="cycle-stats">
        <span>{clutch.eggSummary.registered}/{clutch.eggSummary.declared} {locale === "it" ? "uova registrate" : "eggs registered"}</span>
        <span>{locale === "it" ? "Fertili" : "Fertile"}: {clutch.eggSummary.byStatus.fertile ?? 0}</span>
        <span>{locale === "it" ? "Non fertili" : "Infertile"}: {clutch.eggSummary.byStatus.infertile ?? 0}</span>
        <span>{locale === "it" ? "Schiuse" : "Hatched"}: {clutch.eggSummary.byStatus.hatched ?? 0}</span>
        <span>{locale === "it" ? "Perse" : "Lost"}: {clutch.eggSummary.byStatus.lost ?? 0}</span>
      </div>
      <div className="form-grid">
        <div><small>{locale === "it" ? "Percentuale di schiusa (uova registrate)" : "Hatch rate (registered eggs)"}</small><p>{clutch.eggSummary.hatchRatePct == null ? "—" : `${clutch.eggSummary.hatchRatePct.toFixed(1)}%`}</p></div>
        <div><small>{locale === "it" ? "Durata media effettiva" : "Average actual incubation"}</small><p>{clutch.eggSummary.averageIncubationDays == null ? "—" : `${clutch.eggSummary.averageIncubationDays} ${locale === "it" ? "giorni" : "days"}`}</p></div>
      </div>
      {clutch.eggSummary.unregisteredDeclared > 0 && <Alert tone="warning">{locale === "it" ? `Mancano ${clutch.eggSummary.unregisteredDeclared} uova da identificare singolarmente.` : `${clutch.eggSummary.unregisteredDeclared} declared eggs have not been registered individually.`}</Alert>}
    </Panel>}
    <div className="detail-grid">
      <div><EggManagement locale={locale} eggs={eggs} onAdd={() => setMode("eggs")} onEdit={setEditingEgg} onDelete={deleteEgg} onMeasure={(egg) => void openEggMeasurements(egg)} />{eggsResource.data?.pagination && <Pagination page={eggsResource.data.pagination.page} totalPages={eggsResource.data.pagination.totalPages} onChange={setEggsPage} label={t("page")} />}</div>
      <div><IncubationLogs locale={locale} logs={logs} onAdd={() => openLog()} onEdit={openLog} onDelete={deleteLog} />{logsResource.data?.pagination && <Pagination page={logsResource.data.pagination.page} totalPages={logsResource.data.pagination.totalPages} onChange={setLogsPage} label={t("page")} />}</div>
    </div>
    {clutch.incubatorId && <Panel>
      <PanelHeader title={locale === "it" ? "Manutenzione incubatrice" : "Incubator maintenance"} action={<Button size="sm" onClick={() => void addIncubatorMaintenance()}><Icon name="plus" />{locale === "it" ? "Registra intervento" : "Log maintenance"}</Button>} />
      {maintenanceResource.data?.maintenance.length ? <div className="record-list">{maintenanceResource.data.maintenance.map((item) => <div className="record-row" key={item.id}><div><strong>{({ cleaning: locale === "it" ? "Pulizia" : "Cleaning", calibration: locale === "it" ? "Calibrazione" : "Calibration", repair: locale === "it" ? "Riparazione" : "Repair", inspection: locale === "it" ? "Ispezione" : "Inspection", other: locale === "it" ? "Altro" : "Other" } as Record<string,string>)[item.eventType] ?? item.eventType}</strong><small>{formatDateTime(item.occurredAt, locale)}</small>{item.notes && <p>{item.notes}</p>}</div></div>)}</div> : <EmptyState title={locale === "it" ? "Nessuna manutenzione registrata" : "No maintenance recorded"} />}
    </Panel>}
    {clutch.history?.length ? <Panel>
      <PanelHeader title={locale === "it" ? "Storico operazioni covata" : "Clutch activity history"} />
      <div className="timeline">{clutch.history.slice(0, 30).map((item) => <div className="timeline-item" key={item.id}><span className="timeline-dot" /><div className="timeline-copy"><span>{formatDateTime(item.occurredAt, locale)}</span><strong>{item.action}</strong>{item.notes && <p>{item.notes}</p>}</div></div>)}</div>
    </Panel> : null}
    {clutch.monitoring && <Panel>
      <PanelHeader title={locale === "it" ? "Monitoraggio incubazione" : "Incubation monitoring"} />
      <div className="detail-grid">
        <div className="record-row"><div><strong>{locale === "it" ? "Temperatura media" : "Average temperature"}</strong><p>{clutch.monitoring.averageTemperatureC == null ? "—" : formatTemperature(clutch.monitoring.averageTemperatureC, locale)}</p></div><Badge tone={clutch.monitoring.temperatureOutOfRange > 0 ? "danger" : "success"}>{clutch.monitoring.temperatureOutOfRange} {locale === "it" ? "fuori intervallo" : "out of range"}</Badge></div>
        <div className="record-row"><div><strong>{locale === "it" ? "Umidità media" : "Average humidity"}</strong><p>{clutch.monitoring.averageHumidityPct == null ? "—" : `${clutch.monitoring.averageHumidityPct.toFixed(1)} %`}</p></div><Badge tone={clutch.monitoring.humidityOutOfRange > 0 ? "danger" : "success"}>{clutch.monitoring.humidityOutOfRange} {locale === "it" ? "fuori intervallo" : "out of range"}</Badge></div>
      </div>
      <div className="form-grid">
        <div><small>{locale === "it" ? "Ultimo controllo" : "Last check"}</small><p>{clutch.monitoring.lastCheckAt ? formatDateTime(clutch.monitoring.lastCheckAt, locale) : "—"}</p></div>
        <div><small>{locale === "it" ? "Prossimo controllo previsto" : "Next check due"}</small><p>{clutch.monitoring.nextCheckDueAt ? formatDateTime(clutch.monitoring.nextCheckDueAt, locale) : (locale === "it" ? "Configura l'intervallo nei parametri della covata" : "Configure the clutch check interval")}</p></div>
      </div>
      {clutch.monitoring.nextCheckDueAt && new Date(clutch.monitoring.nextCheckDueAt).getTime() < Date.now() && <Alert tone="warning">{locale === "it" ? "Controllo incubazione in ritardo." : "Incubation check is overdue."}</Alert>}
      <div className="detail-grid">
        <div><strong>{locale === "it" ? "Storico temperatura" : "Temperature history"}</strong><div className="incubation-chart">{logs.slice().reverse().filter((log) => log.temperatureC !== null).map((log) => <span key={log.id} title={formatDateTime(log.recordedAt, locale)} style={{ height: `${Math.max(4, Math.min(100, (Number(log.temperatureC) + 10) / 50 * 100))}%` }} />)}</div></div>
        <div><strong>{locale === "it" ? "Storico umidità" : "Humidity history"}</strong><div className="incubation-chart">{logs.slice().reverse().filter((log) => log.humidityPct !== null).map((log) => <span key={log.id} title={formatDateTime(log.recordedAt, locale)} style={{ height: `${Math.max(4, Math.min(100, Number(log.humidityPct)))}%` }} />)}</div></div>
      </div>
      <p className="muted-note">{locale === "it" ? "Le colonne mostrano i controlli registrati in ordine cronologico; i valori fuori intervallo sono conteggiati rispetto ai target configurati." : "Bars show recorded checks chronologically; out-of-range values are counted against the configured targets."}</p>
    </Panel>}
    {measuringEgg && <Modal title={(locale === "it" ? "Misurazioni uovo · " : "Egg measurements · ") + (measuringEgg.code || "—")} onClose={() => setMeasuringEgg(null)}>
      <div className="form-stack">
        {eggMeasurements.length > 0 && <div className="record-list">{eggMeasurements.map((measurement) => <div className="record-row" key={measurement.id}><div><strong>{measurement.weightG} g</strong><small>{formatDateTime(measurement.measuredAt, locale)}</small>{measurement.notes && <p>{measurement.notes}</p>}</div><div className="row-actions"><IconButton label={t("edit")} onClick={() => editEggMeasurement(measurement)}><Icon name="edit" size={15} /></IconButton><IconButton label={t("delete")} onClick={() => void deleteEggMeasurement(measurement)}><Icon name="trash" size={15} /></IconButton></div></div>)}</div>}
        <form className="form-stack" onSubmit={saveEggMeasurement}>
          <Field label={locale === "it" ? "Data e ora" : "Date and time"}><Input required type="datetime-local" value={measurementForm.measuredAt} onChange={(e) => setMeasurementForm({ ...measurementForm, measuredAt: e.target.value })} /></Field>
          <Field label={locale === "it" ? "Peso (g)" : "Weight (g)"}><Input required type="number" min="0.01" step="0.01" value={measurementForm.weightG} onChange={(e) => setMeasurementForm({ ...measurementForm, weightG: e.target.value })} /></Field>
          <Field label={t("notes")}><Textarea rows={2} value={measurementForm.notes} onChange={(e) => setMeasurementForm({ ...measurementForm, notes: e.target.value })} /></Field>
          <div className="modal-actions"><Button variant="secondary" type="button" onClick={() => { setEditingMeasurement(null); setMeasurementForm({ measuredAt: localDateTimeValue(), weightG: "", notes: "" }); }}>{locale === "it" ? "Nuova misurazione" : "New measurement"}</Button><Button type="submit" disabled={busy || !measurementForm.weightG}>{editingMeasurement ? t("edit") : t("save")}</Button><Button variant="secondary" type="button" onClick={() => setMeasuringEgg(null)}>{t("close")}</Button></div>
        </form>
      </div>
    </Modal>}
    {mode === "eggs" && <Modal title={t("addEggs")} onClose={() => setMode(null)}><form className="form-stack" onSubmit={addEggs}>{error && <Alert tone="danger">{error}</Alert>}<Field label={t("eggCode")} hint={locale === "it" ? "Un codice per riga; ogni riga crea un uovo." : "One code per line; each line creates one egg."}><Textarea rows={5} value={eggLines} onChange={(e) => setEggLines(e.target.value)} /></Field><div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setMode(null)}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("save")}</Button></div></form></Modal>}
    {mode === "log" && <Modal title={editingLog ? t("edit") : t("addIncubationLog")} onClose={() => { setEditingLog(null); setMode(null); }}><form className="form-stack" onSubmit={addLog}>{error && <Alert tone="danger">{error}</Alert>}
      <Field label={t("recordedAt")}><Input type="datetime-local" required value={logForm.recordedAt} onChange={(e) => setLogForm({ ...logForm, recordedAt: e.target.value })} /></Field>
      <div className="form-grid"><Field label={`${t("temperature").replace(/°C|°F/, temperatureUnitLabel())}`}><Input type="number" step="0.1" value={logForm.temperatureC} onChange={(e) => setLogForm({ ...logForm, temperatureC: e.target.value })} /></Field><Field label={t("humidity")}><Input type="number" min="0" max="100" step="0.1" value={logForm.humidityPct} onChange={(e) => setLogForm({ ...logForm, humidityPct: e.target.value })} /></Field></div>
      <Field label={t("eventType")}><Input value={logForm.eventType} onChange={(e) => setLogForm({ ...logForm, eventType: e.target.value })} /></Field><Field label={t("notes")}><Textarea rows={3} value={logForm.notes} onChange={(e) => setLogForm({ ...logForm, notes: e.target.value })} /></Field>
      <div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setMode(null)}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("save")}</Button></div>
    </form></Modal>}
    {editingEgg && <Modal title={t("edit")} onClose={() => setEditingEgg(null)}>
      <form className="form-stack" onSubmit={async (event) => {
        event.preventDefault(); setBusy(true);
        try {
          await api.patch(`/eggs/${getString(editingEgg, "id")}`, {
            code: getString(editingEgg, "code") || null,
            status: getString(editingEgg, "status"),
            laidAt: getString(editingEgg, "laidAt") || null,
            expectedHatchAt: getString(editingEgg, "expectedHatchAt").slice(0,10) || null,
            hatchedAt: getString(editingEgg, "hatchedAt").slice(0,10) || null,
            offspringAnimalId: getString(editingEgg, "offspringAnimalId") || null,
            notes: getString(editingEgg, "notes") || null,
            incubatorId: getString(editingEgg, "incubatorId") || null,
            incubatorPosition: getString(editingEgg, "incubatorPosition") || null
          });
          setEditingEgg(null); resource.reload(); eggsResource.reload(); show(t("saveSuccess"));
        } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
        finally { setBusy(false); }
      }}>
        <Field label={locale === "it" ? "Fotografia dell'uovo" : "Egg photo"}>
          {editingEgg.photoUrl && <img src={editingEgg.photoUrl} alt={locale === "it" ? "Fotografia dell'uovo" : "Egg photo"} style={{ width: "100%", maxHeight: 220, objectFit: "contain", borderRadius: 10 }} />}
          <Input type="file" accept="image/jpeg,image/png,image/webp" disabled={eggPhotoBusy} onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadEggPhoto(file); e.currentTarget.value = ""; }} />
          {editingEgg.photoUrl && <Button type="button" variant="secondary" size="sm" disabled={eggPhotoBusy} onClick={() => void deleteEggPhoto()}>{locale === "it" ? "Rimuovi foto" : "Remove photo"}</Button>}
          <small>{locale === "it" ? "JPEG, PNG o WebP; massimo 5 MB." : "JPEG, PNG or WebP; maximum 5 MB."}</small>
        </Field>
        <Field label={locale === "it" ? "Incubatrice" : "Incubator"}>
          <Select value={getString(editingEgg, "incubatorId")} onChange={(e) => setEditingEgg({ ...editingEgg, incubatorId: e.target.value || null, incubatorPosition: e.target.value && e.target.value === getString(editingEgg, "incubatorId") ? getString(editingEgg, "incubatorPosition") : null })}>
            <option value="">{locale === "it" ? "Non assegnata" : "Not assigned"}</option>
            {(incubatorsResource.data?.incubators ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}{item.identifier ? ` · ${item.identifier}` : ""}</option>)}
          </Select>
        </Field>
        <Field label={locale === "it" ? "Posizione interna (ripiano / contenitore)" : "Internal position (shelf / container)"}>
          <Input value={getString(editingEgg, "incubatorPosition")} disabled={!getString(editingEgg, "incubatorId")} onChange={(e) => setEditingEgg({ ...editingEgg, incubatorPosition: e.target.value })} placeholder={locale === "it" ? "Es. Ripiano 2 · box B" : "e.g. Shelf 2 · box B"} />
        </Field>
        {transfersResource.data?.transfers?.length ? <div className="record-list"><strong>{locale === "it" ? "Storico trasferimenti" : "Transfer history"}</strong>{transfersResource.data.transfers.map((transfer) => <div className="record-row" key={transfer.id}><div><strong>{transfer.fromIncubator?.name || (locale === "it" ? "Non assegnata" : "Unassigned")} → {transfer.toIncubator?.name || (locale === "it" ? "Non assegnata" : "Unassigned")}</strong><small>{formatDateTime(transfer.transferredAt, locale)} · {transfer.fromPosition || "—"} → {transfer.toPosition || "—"}</small></div></div>)}</div> : null}
        <Field label={t("eggCode")}><Input value={getString(editingEgg, "code")} onChange={(e) => setEditingEgg({ ...editingEgg, code: e.target.value })} /></Field>
        <Field label={t("eggStatus")}><Select value={getString(editingEgg, "status", "unknown")} onChange={(e) => { const status = e.target.value as EggDto["status"]; setEditingEgg({ ...editingEgg, status, hatchedAt: status === "hatched" ? (getString(editingEgg, "hatchedAt").slice(0,10) || todayDate()) : null, offspringAnimalId: status === "hatched" ? getString(editingEgg, "offspringAnimalId") || null : null }); }}>
          <option value="unknown">{locale === "it" ? "Da valutare" : "Unassessed"}</option><option value="fertile">Fertile</option><option value="infertile">{locale === "it" ? "Non fertile" : "Infertile"}</option><option value="damaged">{locale === "it" ? "Danneggiato" : "Damaged"}</option><option value="collapsed">{locale === "it" ? "Collassato" : "Collapsed"}</option><option value="lost">{locale === "it" ? "Perso" : "Lost"}</option><option value="incubating">{locale === "it" ? "In incubazione" : "Incubating"}</option><option value="hatched">{locale === "it" ? "Schiuso" : "Hatched"}</option>
        </Select></Field>
        <Field label={locale === "it" ? "Data deposizione" : "Deposition date"}><Input type="datetime-local" value={getString(editingEgg, "laidAt") ? localDateTimeValue(new Date(getString(editingEgg, "laidAt"))) : ""} onChange={(e) => setEditingEgg({ ...editingEgg, laidAt: e.target.value ? new Date(e.target.value).toISOString() : null })} /></Field>
        <Field label={locale === "it" ? "Schiusa prevista" : "Expected hatch"}><Input type="date" value={getString(editingEgg, "expectedHatchAt").slice(0,10)} onChange={(e) => setEditingEgg({ ...editingEgg, expectedHatchAt: e.target.value || null })} /></Field>
        <Field label={locale === "it" ? "Data di schiusa" : "Hatch date"}><Input type="date" value={getString(editingEgg, "hatchedAt").slice(0,10)} onChange={(e) => setEditingEgg({ ...editingEgg, hatchedAt: e.target.value || null })} /></Field>
        <RemoteSelect label={locale === "it" ? "Piccolo collegato" : "Linked hatchling"} value={getString(editingEgg, "offspringAnimalId")} onChange={(value) => setEditingEgg({ ...editingEgg, offspringAnimalId: value || null, status: value ? "hatched" : editingEgg.status })} endpoint="/animals" responseKey="animals" secondaryKey="species" filters={{ status: "all", sort: "name" }} detailEndpoint={(animalId) => `/animals/${encodeURIComponent(animalId)}`} detailKey="animal" locale={locale} />
        <Field label={t("notes")}><Textarea value={getString(editingEgg, "notes")} onChange={(e) => setEditingEgg({ ...editingEgg, notes: e.target.value })} /></Field>
        <div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setEditingEgg(null)}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("save")}</Button></div>
      </form>
    </Modal>}
    {toast}
  </div>;
}