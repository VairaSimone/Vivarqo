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
  const clutch = resource.data?.clutch;
  const eggs = clutch?.eggs ?? [];
  const logs = clutch?.incubationLogs ?? [];
  const cycle = clutch?.cycle;
  const { toast, show } = useToast();

  async function addEggs(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const codes = eggLines.split("\n").map((line) => line.trim()).filter(Boolean);
    try { await api.post(`/clutches/${id}/eggs`, { eggs: codes.map((code) => ({ code, status: "unknown" })) }); setMode(null); resource.reload(); show(t("saveSuccess")); }
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
      setMode(null); setEditingLog(null); resource.reload(); show(t("saveSuccess"));
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  async function deleteEgg(egg: EggDto) {
    if (!window.confirm(t("confirmDelete"))) return;
    try { await api.delete(`/eggs/${getString(egg, "id")}`); resource.reload(); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }
  async function deleteLog(log: IncubationLogDto) {
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
      <EggManagement locale={locale} eggs={eggs} onAdd={() => setMode("eggs")} onEdit={setEditingEgg} onDelete={deleteEgg} />
      <IncubationLogs locale={locale} logs={logs} onAdd={() => openLog()} onEdit={openLog} onDelete={deleteLog} />
    </div>
    {mode === "eggs" && <Modal title={t("addEggs")} onClose={() => setMode(null)}><form className="form-stack" onSubmit={addEggs}>{error && <Alert tone="danger">{error}</Alert>}<Field label={t("eggCode")} hint={locale === "it" ? "Un codice per riga; ogni riga crea un uovo." : "One code per line; each line creates one egg."}><Textarea rows={5} value={eggLines} onChange={(e) => setEggLines(e.target.value)} /></Field><div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setMode(null)}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("save")}</Button></div></form></Modal>}
    {mode === "log" && <Modal title={editingLog ? t("edit") : t("addIncubationLog")} onClose={() => { setEditingLog(null); setMode(null); }}><form className="form-stack" onSubmit={addLog}>{error && <Alert tone="danger">{error}</Alert>}
      <Field label={t("recordedAt")}><Input type="datetime-local" required value={logForm.recordedAt} onChange={(e) => setLogForm({ ...logForm, recordedAt: e.target.value })} /></Field>
      <div className="form-grid"><Field label={`${t("temperature").replace(/°C|°F/, temperatureUnitLabel())}`}><Input type="number" step="0.1" value={logForm.temperatureC} onChange={(e) => setLogForm({ ...logForm, temperatureC: e.target.value })} /></Field><Field label={t("humidity")}><Input type="number" min="0" max="100" step="0.1" value={logForm.humidityPct} onChange={(e) => setLogForm({ ...logForm, humidityPct: e.target.value })} /></Field></div>
      <Field label={t("eventType")}><Input value={logForm.eventType} onChange={(e) => setLogForm({ ...logForm, eventType: e.target.value })} /></Field><Field label={t("notes")}><Textarea rows={3} value={logForm.notes} onChange={(e) => setLogForm({ ...logForm, notes: e.target.value })} /></Field>
      <div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setMode(null)}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("save")}</Button></div>
    </form></Modal>}
    {editingEgg && <Modal title={t("edit")} onClose={() => setEditingEgg(null)}><form className="form-stack" onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { await api.patch(`/eggs/${getString(editingEgg, "id")}`, { code: getString(editingEgg, "code") || null, status: getString(editingEgg, "status"), notes: getString(editingEgg, "notes") || null }); setEditingEgg(null); resource.reload(); show(t("saveSuccess")); } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); } finally { setBusy(false); } }}><Field label={t("eggCode")}><Input value={getString(editingEgg, "code")} onChange={(e) => setEditingEgg({ ...editingEgg, code: e.target.value })} /></Field><Field label={t("eggStatus")}><Input value={getString(editingEgg, "status")} onChange={(e) => setEditingEgg({ ...editingEgg, status: e.target.value })} /></Field><Field label={t("notes")}><Textarea value={getString(editingEgg, "notes")} onChange={(e) => setEditingEgg({ ...editingEgg, notes: e.target.value })} /></Field><div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setEditingEgg(null)}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("save")}</Button></div></form></Modal>}
    {toast}
  </div>;
}