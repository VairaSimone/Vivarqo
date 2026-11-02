import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { formatDateTime, getArray, getString } from "../lib/domain";
import type { Locale } from "../lib/domain";
import { translate } from "../lib/i18n";
import { useResource } from "../hooks/useResource";
import { Alert, Badge, Button, EmptyState, ErrorState, Field, Icon, Input, LoadingState, PageHeader, Panel, PanelHeader, Select, Textarea, useToast } from "../components/ui";

type Item = Record<string, unknown>;

const importEntities = [
  "animals", "weights", "sheds", "notes", "feedings", "finance", "inventory",
  "reproductionCycles", "reproductiveEvents", "clutches", "eggs", "incubationLogs", "offspringBatches"
];

export function DataTransferPage({ locale, mode }: { locale: Locale; mode: "import" | "export" }) {
  return mode === "import" ? <ImportPage locale={locale} /> : <ExportPage locale={locale} />;
}

function ImportPage({ locale }: { locale: Locale }) {
  const t = (key: string) => translate(locale, key);
  const [entity, setEntity] = useState("animals");
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState("");
  const [preview, setPreview] = useState<Item | null>(null);
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const job = useResource<Item>(jobId ? `/imports/${encodeURIComponent(jobId)}?statusOnly=true` : null);
  const { toast, show } = useToast();

  const status = getString(job.data, "status", getString(preview, "status"));

  useEffect(() => {
    if (status !== "queued" && status !== "processing") return;
    // Keep polling even when the cache returns the same pending object.
    // The resource cache expires entries after a short TTL; a stable interval
    // ensures we make a fresh request as soon as that cached response expires.
    const timer = window.setInterval(job.reload, 2000);
    return () => window.clearInterval(timer);
  }, [status, job.reload]);

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true); setError(""); setPreview(null); setJobId("");
    try {
      const result = await api.upload<Item>(`/imports?entity=${encodeURIComponent(entity)}`, file);
      setPreview(result);
      setJobId(getString(result, "importId"));
      setAllowDuplicates(false);
      show(t("preview"));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t("operationFailed"));
    } finally { setBusy(false); }
  }

  async function confirmImport() {
    if (!jobId) return;
    setBusy(true); setError("");
    try {
      await api.post(`/imports/${encodeURIComponent(jobId)}/confirm`, entity === "animals" ? { allowPossibleDuplicates: allowDuplicates } : {});
      job.reload(); show(t("queued"));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t("operationFailed"));
    } finally { setBusy(false); }
  }

  const errors = getArray<Item>(preview, "errors");
  const duplicates = getArray<Item>(preview, "possibleDuplicates");
  const previewRows = getArray<Item>(preview, "preview");
  const labels: Record<string, string> = locale === "it" ? {
    animals: "Animali", weights: "Pesate", sheds: "Mute", notes: "Note", feedings: "Alimentazioni",
    finance: "Registro economico", inventory: "Inventario", reproductionCycles: "Cicli riproduttivi",
    reproductiveEvents: "Eventi riproduttivi", clutches: "Covate", eggs: "Uova",
    incubationLogs: "Registri incubazione", offspringBatches: "Gruppi di nascita"
  } : {
    animals: "Animals", weights: "Weights", sheds: "Sheds", notes: "Notes", feedings: "Feedings",
    finance: "Financial entries", inventory: "Inventory", reproductionCycles: "Reproduction cycles",
    reproductiveEvents: "Reproductive events", clutches: "Clutches", eggs: "Eggs",
    incubationLogs: "Incubation logs", offspringBatches: "Offspring batches"
  };

  return <div className="page-stack">
    <PageHeader eyebrow={t("navAdmin")} title={t("importTitle")} description={locale === "it" ? "Carica un CSV o XLSX, verifica l'anteprima e conferma soltanto dopo aver controllato le righe." : "Upload a CSV or XLSX file, review the preview and confirm only after checking the rows."} />
    <Panel>
      <form className="form-stack" onSubmit={upload}>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="form-grid">
          <Field label={t("entityType")}><Select value={entity} onChange={(e) => { setEntity(e.target.value); setPreview(null); setJobId(""); }} disabled={busy}>{importEntities.map((value) => <option value={value} key={value}>{labels[value]}</option>)}</Select></Field>
          <Field label={t("chooseFile")}><Input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        </div>
        <Button type="submit" disabled={!file || busy}><Icon name="upload" />{busy ? t("loading") : t("preview")}</Button>
      </form>
    </Panel>
    {preview && <Panel>
      <PanelHeader title={t("preview")} description={getString(preview, "fileType")} />
      <div className="metric-grid">
        <MiniMetric label={t("validRows")} value={Number(preview.validRows ?? 0)} />
        <MiniMetric label={t("invalidRows")} value={Number(preview.invalidRows ?? errors.length)} />
        <MiniMetric label={t("duplicates")} value={duplicates.length} />
      </div>
      {getArray<string>(preview, "headers").length > 0 && <p className="muted-note">{(preview.headers as string[]).join(" · ")}</p>}
      {errors.length > 0 && <div className="import-errors"><h3>{t("invalidRows")}</h3>{errors.slice(0, 30).map((item, index) => <div key={index}><strong>{t("row")} {String(item.row ?? "")}</strong><span>{getString(item, "column")}</span><small>{getString(item, "reason")}</small></div>)}</div>}
      {duplicates.length > 0 && <><Alert tone="warning">{t("duplicates")}: {duplicates.length}. {locale === "it" ? "Puoi decidere esplicitamente se includerli." : "You can explicitly decide whether to include them."}</Alert><label className="checkbox-field"><input type="checkbox" checked={allowDuplicates} onChange={(e) => setAllowDuplicates(e.target.checked)} />{locale === "it" ? "Confermo di voler importare anche i possibili duplicati." : "I confirm that possible duplicates should also be imported."}</label></>}
      {previewRows.length > 0 && <div className="import-preview"><h3>{locale === "it" ? "Prime righe valide" : "First valid rows"}</h3><pre>{JSON.stringify(previewRows.slice(0, 8), null, 2)}</pre></div>}
      <div className="modal-actions"><Button onClick={() => void confirmImport()} disabled={busy || !jobId || (entity === "animals" && duplicates.length > 0 && !allowDuplicates)}>{t("confirmImport")}</Button></div>
    </Panel>}
    {jobId && <Panel>
      <PanelHeader title={locale === "it" ? "Stato importazione" : "Import status"} action={<Button variant="ghost" size="sm" onClick={job.reload}><Icon name="refresh" />{t("refresh")}</Button>} />
      {job.loading && !job.data ? <LoadingState /> : job.error ? <ErrorState message={job.error.message} retry={job.reload} /> : <>
        <div className="status-row"><Badge tone={status === "completed" ? "success" : status === "failed" ? "danger" : "info"}>{t(status === "preview" ? "preview" : status || "queued")}</Badge><span>{Number(job.data?.createdCount ?? 0)} {locale === "it" ? "creati" : "created"} · {Number(job.data?.errorCount ?? 0)} {locale === "it" ? "errori" : "errors"} · {Number(job.data?.skippedCount ?? 0)} {locale === "it" ? "ignorati" : "skipped"}</span></div>
        {getString(job.data, "lastErrorCode") && <Alert tone="danger">{getString(job.data, "lastErrorCode")}</Alert>}
      </>}
    </Panel>}
    {toast}
  </div>;
}

function ExportPage({ locale }: { locale: Locale }) {
  const t = (key: string) => translate(locale, key);
  const [includeDocuments, setIncludeDocuments] = useState(false);
  const [exportId, setExportId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const resource = useResource<{ export: Item; ready: boolean }>(exportId ? `/exports/${encodeURIComponent(exportId)}` : null);
  const job = resource.data?.export;
  const status = getString(job, "status");
  const { toast, show } = useToast();

  useEffect(() => {
    if (status !== "pending" && status !== "processing") return;
    // Do not stop after a cache hit: otherwise a pending export is polled only
    // once and the UI never observes completion after the cache entry expires.
    const timer = window.setInterval(resource.reload, 2000);
    return () => window.clearInterval(timer);
  }, [status, resource.reload]);

  async function start() {
    setBusy(true); setError("");
    try {
      const result = await api.post<{ export: Item }>("/exports", { includeDocuments });
      setExportId(getString(result.export, "id"));
      show(t("queued"));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t("operationFailed"));
    } finally { setBusy(false); }
  }

  return <div className="page-stack">
    <PageHeader eyebrow={t("navAdmin")} title={t("exportTitle")} description={locale === "it" ? "L'archivio viene preparato in background. Puoi continuare a usare Vivarqo." : "The archive is generated in the background, so you can keep using Vivarqo."} />
    <Panel>
      <div className="export-intro"><span className="export-symbol"><Icon name="download" size={25} /></span><div><h2>{t("exportTitle")}</h2><p>{locale === "it" ? "Richiedi una copia dei dati associati al tuo account." : "Request a copy of the data associated with your account."}</p></div></div>
      <label className="checkbox-field"><input type="checkbox" checked={includeDocuments} onChange={(e) => setIncludeDocuments(e.target.checked)} />{t("includeDocuments")}</label>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button onClick={() => void start()} disabled={busy}><Icon name="download" />{busy ? t("loading") : t("startExport")}</Button>
    </Panel>
    {exportId && <Panel>
      <PanelHeader title={t("exportTitle")} action={<Button variant="ghost" size="sm" onClick={resource.reload}><Icon name="refresh" />{t("refresh")}</Button>} />
      {resource.loading && !resource.data ? <LoadingState /> : resource.error ? <ErrorState message={resource.error.message} retry={resource.reload} /> : <>
        <div className="status-row"><Badge tone={resource.data?.ready ? "success" : status === "failed" ? "danger" : "info"}>{resource.data?.ready ? t("exportReady") : t(status || "queued")}</Badge><small>{formatDateTime(getString(job, "createdAt"), locale)}</small></div>
        {status === "failed" && <Alert tone="danger">{getString(job, "lastErrorCode") || t("operationFailed")}</Alert>}
        {resource.data?.ready && <Button onClick={() => void api.download(`/exports/${exportId}/download`, `vivarqo-export-${exportId}.zip`)}><Icon name="download" />{t("download")}</Button>}
      </>}
    </Panel>}
    {toast}
  </div>;
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return <div className="metric-card"><div><span className="metric-label">{label}</span><strong>{value}</strong></div></div>;
}
