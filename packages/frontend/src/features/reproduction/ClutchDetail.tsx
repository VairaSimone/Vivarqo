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
  const [editingLog, setEditingLog] = useState<IncubationLogDto | null>(null);
  const [eggsPage, setEggsPage] = useState(1);
  const [logsPage, setLogsPage] = useState(1);
  const clutch = resource.data?.clutch;
  const eggsResource = useResource<{ eggs: EggDto[]; pagination: { page: number; totalPages: number; total: number } }>(clutch ? `/clutches/${encodeURIComponent(id)}/eggs?page=${eggsPage}&pageSize=25` : null);
  const logsResource = useResource<{ logs: IncubationLogDto[]; pagination: { page: number; totalPages: number; total: number } }>(clutch ? `/clutches/${encodeURIComponent(id)}/incubation-logs?page=${logsPage}&pageSize=25` : null);
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
  async function deleteLog(log: IncubationLogDto) {
    if (!window.confirm(t("confirmDelete"))) return;
    try { await api.delete(`/incubation-logs/${getString(log, "id")}`); resource.reload(); logsResource.reload(); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }

  if (resource.loading && !clutch) return <LoadingState />;
  if (resource.error || !clutch) return <ErrorState message={resource.error?.message ?? t("noRecords")} retry={resource.reload} />;
  return <div className="page-stack">
    <div className="back-row"><button className="text-link" onClick={() => navigate(`/reproduction-cycles/${getString(cycle, "id")}`)}>← {getString(cycle, "name") || t("cycles")}</button></div>
    <PageHeader eyebrow={t("clutches")} title={formatDate(getString(clutch, "laidOn"), locale)} description={`${getString(clutch, "eggCount")} ${t("eggs")} · ${getString(clutch, "incubatorLabel") || "—"}`} action={<Button onClick={() => openLog()}><Icon name="plus" />{t("addIncubationLog")}</Button>} />
    <div className="detail-grid">
      <div><EggManagement locale={locale} eggs={eggs} onAdd={() => setMode("eggs")} onEdit={setEditingEgg} onDelete={deleteEgg} />{eggsResource.data?.pagination && <Pagination page={eggsResource.data.pagination.page} totalPages={eggsResource.data.pagination.totalPages} onChange={setEggsPage} label={t("page")} />}</div>
      <div><IncubationLogs locale={locale} logs={logs} onAdd={() => openLog()} onEdit={openLog} onDelete={deleteLog} />{logsResource.data?.pagination && <Pagination page={logsResource.data.pagination.page} totalPages={logsResource.data.pagination.totalPages} onChange={setLogsPage} label={t("page")} />}</div>
    </div>
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
    {mode === "eggs" && <Modal title={t("addEggs")} onClose={() => setMode(null)}><form className="form-stack" onSubmit={addEggs}>{error && <Alert tone="danger">{error}</Alert>}<Field label={t("eggCode")} hint={locale === "it" ? "Un codice per riga; ogni riga crea un uovo." : "One code per line; each line creates one egg."}><Textarea rows={5} value={eggLines} onChange={(e) => setEggLines(e.target.value)} /></Field><div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setMode(null)}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("save")}</Button></div></form></Modal>}
    {mode === "log" && <Modal title={editingLog ? t("edit") : t("addIncubationLog")} onClose={() => { setEditingLog(null); setMode(null); }}><form className="form-stack" onSubmit={addLog}>{error && <Alert tone="danger">{error}</Alert>}
      <Field label={t("recordedAt")}><Input type="datetime-local" required value={logForm.recordedAt} onChange={(e) => setLogForm({ ...logForm, recordedAt: e.target.value })} /></Field>
      <div className="form-grid"><Field label={`${t("temperature").replace(/°C|°F/, temperatureUnitLabel())}`}><Input type="number" step="0.1" value={logForm.temperatureC} onChange={(e) => setLogForm({ ...logForm, temperatureC: e.target.value })} /></Field><Field label={t("humidity")}><Input type="number" min="0" max="100" step="0.1" value={logForm.humidityPct} onChange={(e) => setLogForm({ ...logForm, humidityPct: e.target.value })} /></Field></div>
      <Field label={t("eventType")}><Input value={logForm.eventType} onChange={(e) => setLogForm({ ...logForm, eventType: e.target.value })} /></Field><Field label={t("notes")}><Textarea rows={3} value={logForm.notes} onChange={(e) => setLogForm({ ...logForm, notes: e.target.value })} /></Field>
      <div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setMode(null)}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("save")}</Button></div>
    </form></Modal>}
    {editingEgg && <Modal title={t("edit")} onClose={() => setEditingEgg(null)}><form className="form-stack" onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { await api.patch(`/eggs/${getString(editingEgg, "id")}`, { code: getString(editingEgg, "code") || null, status: getString(editingEgg, "status"), hatchedAt: getString(editingEgg, "hatchedAt").slice(0,10) || null, offspringAnimalId: getString(editingEgg, "offspringAnimalId") || null, notes: getString(editingEgg, "notes") || null }); setEditingEgg(null); resource.reload(); eggsResource.reload(); show(t("saveSuccess")); } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); } finally { setBusy(false); } }}><Field label={t("eggCode")}><Input value={getString(editingEgg, "code")} onChange={(e) => setEditingEgg({ ...editingEgg, code: e.target.value })} /></Field><Field label={t("eggStatus")}><Select value={getString(editingEgg, "status", "unknown")} onChange={(e) => { const status = e.target.value as EggDto["status"]; setEditingEgg({ ...editingEgg, status, hatchedAt: status === "hatched" ? (getString(editingEgg, "hatchedAt").slice(0,10) || todayDate()) : null, offspringAnimalId: status === "hatched" ? getString(editingEgg, "offspringAnimalId") || null : null }); }}>
      <option value="unknown">{locale === "it" ? "Da valutare" : "Unassessed"}</option><option value="fertile">Fertile</option><option value="infertile">{locale === "it" ? "Non fertile" : "Infertile"}</option><option value="damaged">{locale === "it" ? "Danneggiato" : "Damaged"}</option><option value="lost">{locale === "it" ? "Perso" : "Lost"}</option><option value="incubating">{locale === "it" ? "In incubazione" : "Incubating"}</option><option value="hatched">{locale === "it" ? "Schiuso" : "Hatched"}</option>
    </Select></Field>
    <Field label={locale === "it" ? "Data di schiusa" : "Hatch date"}><Input type="date" value={getString(editingEgg, "hatchedAt").slice(0,10)} onChange={(e) => setEditingEgg({ ...editingEgg, hatchedAt: e.target.value || null })} /></Field>
    <RemoteSelect label={locale === "it" ? "Piccolo collegato" : "Linked hatchling"} value={getString(editingEgg, "offspringAnimalId")} onChange={(value) => setEditingEgg({ ...editingEgg, offspringAnimalId: value || null, status: value ? "hatched" : editingEgg.status })} endpoint="/animals" responseKey="animals" secondaryKey="species" filters={{ status: "all", sort: "name" }} detailEndpoint={(animalId) => `/animals/${encodeURIComponent(animalId)}`} detailKey="animal" locale={locale} />
    <Field label={t("notes")}><Textarea value={getString(editingEgg, "notes")} onChange={(e) => setEditingEgg({ ...editingEgg, notes: e.target.value })} /></Field><div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setEditingEgg(null)}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("save")}</Button></div></form></Modal>}
    {toast}
  </div>;
}