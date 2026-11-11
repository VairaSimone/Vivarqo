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
  const [selectedSheet, setSelectedSheet] = useState("");
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [mappingDirty, setMappingDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const job = useResource<Item>(jobId ? "/imports/" + encodeURIComponent(jobId) + "?statusOnly=true" : null);
  const { toast, show } = useToast();

  const status = getString(job.data, "status", getString(preview, "status"));

  useEffect(() => {
    if (status !== "queued" && status !== "processing") return;
    const timer = window.setInterval(job.reload, 15_000);
    return () => window.clearInterval(timer);
  }, [status, job.reload]);

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

  const fieldLabels: Record<string, string> = locale === "it" ? {
    name: "Nome", identifier: "Identificativo", species: "Specie", sex: "Sesso", morph: "Morph",
    geneticsNotes: "Note genetiche", birthDate: "Data di nascita", birthDateEstimated: "Nascita stimata",
    acquiredDate: "Data acquisizione", originDescription: "Provenienza", previousBreeder: "Allevatore precedente",
    locationLabel: "Posizione", status: "Stato", notes: "Note", animalId: "ID animale",
    animalIdentifier: "Identificativo animale", measuredAt: "Data pesata", weightG: "Peso animale",
    occurredAt: "Data evento", outcome: "Esito", category: "Categoria", body: "Testo",
    title: "Titolo", performedAt: "Data alimentazione", foodType: "Tipo alimento", foodSize: "Dimensione",
    foodWeightG: "Peso alimento", entryType: "Tipo movimento", occurredOn: "Data operazione",
    amountCents: "Importo in centesimi", amountEUR: "Importo in euro", currency: "Valuta",
    description: "Descrizione", unit: "Unità", quantityOnHand: "Giacenza", minimumQuantity: "Scorta minima",
    isActive: "Attivo", startedOn: "Data inizio", endedOn: "Data fine", parentAAnimalId: "ID genitore A",
    parentAAnimalIdentifier: "Identificativo genitore A", parentBAnimalId: "ID genitore B",
    parentBAnimalIdentifier: "Identificativo genitore B", cycleId: "ID ciclo", eventType: "Tipo evento",
    details: "Dettagli", temperatureC: "Temperatura °C", humidityPct: "Umidità %",
    laidOn: "Data deposizione", eggCount: "Numero uova", incubatorLabel: "Incubatrice",
    incubationStartedAt: "Inizio incubazione", clutchId: "ID covata", code: "Codice",
    recordedAt: "Data registrazione", bornOn: "Data nascita", count: "Numero piccoli",
    documentId: "ID documento", unitCostCents: "Costo unitario in centesimi", reference: "Riferimento"
  } : {
    name: "Name", identifier: "Identifier", species: "Species", sex: "Sex", morph: "Morph",
    geneticsNotes: "Genetic notes", birthDate: "Birth date", birthDateEstimated: "Estimated birth date",
    acquiredDate: "Acquired date", originDescription: "Origin", previousBreeder: "Previous breeder",
    locationLabel: "Location", status: "Status", notes: "Notes", animalId: "Animal ID",
    animalIdentifier: "Animal identifier", measuredAt: "Weigh-in date", weightG: "Animal weight",
    occurredAt: "Event date", outcome: "Outcome", category: "Category", body: "Text",
    title: "Title", performedAt: "Feeding date", foodType: "Food type", foodSize: "Food size",
    foodWeightG: "Food weight", entryType: "Entry type", occurredOn: "Operation date",
    amountCents: "Amount in cents", amountEUR: "Amount in EUR", currency: "Currency",
    description: "Description", unit: "Unit", quantityOnHand: "Quantity on hand", minimumQuantity: "Minimum stock",
    isActive: "Active", startedOn: "Start date", endedOn: "End date", parentAAnimalId: "Parent A ID",
    parentAAnimalIdentifier: "Parent A identifier", parentBAnimalId: "Parent B ID",
    parentBAnimalIdentifier: "Parent B identifier", cycleId: "Cycle ID", eventType: "Event type",
    details: "Details", temperatureC: "Temperature °C", humidityPct: "Humidity %",
    laidOn: "Laying date", eggCount: "Egg count", incubatorLabel: "Incubator",
    incubationStartedAt: "Incubation start", clutchId: "Clutch ID", code: "Code",
    recordedAt: "Recorded at", bornOn: "Birth date", count: "Offspring count",
    documentId: "Document ID", unitCostCents: "Unit cost in cents", reference: "Reference"
  };

  function mapFromResponse(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([field, header]) => [header, field]));
  }

  function fieldLabel(field: string) {
    return fieldLabels[field] || field.replace(/([a-z])([A-Z])/g, "$1 $2");
  }

  async function uploadPreview(event?: FormEvent) {
    event?.preventDefault();
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const selectedMapping = Object.fromEntries(Object.entries(assignments)
        .filter(([, field]) => Boolean(field))
        .map(([header, field]) => [field, header]));
      const params = new URLSearchParams({ entity });
      if (selectedSheet) params.set("sheet", selectedSheet);
      if (Object.keys(selectedMapping).length) params.set("mapping", JSON.stringify(selectedMapping));
      const result = await api.upload<Item>("/imports?" + params.toString(), file);
      setPreview(result);
      setJobId(getString(result, "importId"));
      setSelectedSheet(getString(result, "selectedSheet"));
      setAssignments(mapFromResponse(result.mappedHeaders));
      setMappingDirty(false);
      setAllowDuplicates(false);
      show(t("previewReady"));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t("operationFailed"));
    } finally {
      setBusy(false);
    }
  }

  function selectFile(nextFile: File | null) {
    setFile(nextFile);
    setPreview(null);
    setJobId("");
    setSelectedSheet("");
    setAssignments({});
    setMappingDirty(false);
    setError("");
  }

  function changeEntity(nextEntity: string) {
    setEntity(nextEntity);
    setPreview(null);
    setJobId("");
    setSelectedSheet("");
    setAssignments({});
    setMappingDirty(false);
    setError("");
  }

  function changeAssignment(header: string, field: string) {
    setAssignments((current) => ({ ...current, [header]: field }));
    setMappingDirty(true);
  }

  const headers = getArray<string>(preview, "headers");
  const sheets = getArray<string>(preview, "sheets");
  const availableFields = getArray<string>(preview, "availableFields");
  const requiredFields = getArray<string[]>(preview, "requiredFields");
  const missingFields = getArray<string[]>(preview, "missingFields");
  const unmappedHeaders = getArray<string>(preview, "unmappedHeaders");
  const errors = getArray<Item>(preview, "errors");
  const duplicates = getArray<Item>(preview, "possibleDuplicates");
  const previewRows = getArray<Item>(preview, "preview");
  const validRowCount = Number(preview?.validRows ?? 0);
  const invalidRowCount = Number(preview?.invalidRows ?? errors.length);
  const missingLabels = missingFields.map((group) => group.map(fieldLabel).join(" / "));
  const hasMultipleSheets = getString(preview, "fileType") === "xlsx" && sheets.length > 1;
  const canConfirm = Boolean(jobId) && !busy && !mappingDirty && missingFields.length === 0
    && validRowCount > 0 && !(entity === "animals" && duplicates.length > 0 && !allowDuplicates);

  async function confirmImport() {
    if (!canConfirm || !jobId) return;
    setBusy(true);
    setError("");
    try {
      await api.post("/imports/" + encodeURIComponent(jobId) + "/confirm",
        entity === "animals" ? { allowPossibleDuplicates: allowDuplicates } : {});
      job.reload();
      show(t("queued"));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t("operationFailed"));
    } finally {
      setBusy(false);
    }
  }

  return <div className="page-stack">
    <PageHeader eyebrow={t("navAdmin")} title={t("importTitle")}
      description={t("importGuidedDescription")} />
    <Panel>
      <form className="form-stack" onSubmit={uploadPreview}>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="form-grid">
          <Field label={t("entityType")}>
            <Select value={entity} onChange={(e) => changeEntity(e.target.value)} disabled={busy}>
              {importEntities.map((value) => <option value={value} key={value}>{labels[value]}</option>)}
            </Select>
          </Field>
          <Field label={t("chooseFile")}>
            <Input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              required onChange={(e) => selectFile(e.target.files?.[0] ?? null)} />
          </Field>
        </div>
        <Button type="submit" disabled={!file || busy}>
          <Icon name="upload" />{busy ? t("loading") : t(preview ? "regeneratePreview" : "preview")}
        </Button>
      </form>
    </Panel>
    {preview && <Panel>
      <PanelHeader title={t("preview")} description={getString(preview, "fileType").toUpperCase()} />
      {hasMultipleSheets && <Field label={t("selectWorksheet")} hint={t("worksheetHint")}>
        <Select value={selectedSheet} onChange={(e) => {
          setSelectedSheet(e.target.value);
          setAssignments({});
          setMappingDirty(true);
        }} disabled={busy}>
          {sheets.map((sheet) => <option key={sheet} value={sheet}>{sheet}</option>)}
        </Select>
      </Field>}
      <div className="metric-grid">
        <MiniMetric label={t("validRows")} value={validRowCount} />
        <MiniMetric label={t("invalidRows")} value={invalidRowCount} />
        <MiniMetric label={t("duplicates")} value={duplicates.length} />
      </div>
      <section className="import-mapping">
        <div className="subsection-heading">
          <h3>{t("columnMapping")}</h3>
          <span>{headers.length} {t("columns")}</span>
        </div>
        <p className="muted-note">{t("columnMappingHint")}</p>
        {requiredFields.length > 0 && <p className="muted-note"><strong>{t("requiredFields")}:</strong> {requiredFields.map((group) => group.map(fieldLabel).join(" / ")).join(" · ")}</p>}
        {missingLabels.length > 0 && <Alert tone="danger">
          {t("missingRequiredMapping")}: {missingLabels.join(" · ")}
        </Alert>}
        {unmappedHeaders.length > 0 && <Alert tone="warning">
          {t("unmappedColumns")}: {unmappedHeaders.join(" · ")}
        </Alert>}
        <div className="import-mapping-list">
          {headers.map((header) => {
            const assigned = assignments[header] || "";
            const targetAlreadyUsed = (field: string) => Object.entries(assignments)
              .some(([otherHeader, otherField]) => otherHeader !== header && otherField === field);
            return <div className={"import-mapping-row " + (assigned ? "is-mapped" : "is-unmapped")} key={header}>
              <div className="import-mapping-source">
                <strong>{header}</strong>
                <small>{assigned ? t("mappedColumn") : t("unmappedColumn")}</small>
              </div>
              <Field label={t("destinationField")}>
                <Select value={assigned} onChange={(e) => changeAssignment(header, e.target.value)} disabled={busy}>
                  <option value="">{t("ignoreColumn")}</option>
                  {availableFields.map((field) => <option key={field} value={field} disabled={targetAlreadyUsed(field)}>
                    {fieldLabel(field)}{requiredFields.some((group) => group.includes(field)) ? " *" : ""}
                  </option>)}
                </Select>
              </Field>
            </div>;
          })}
        </div>
        {mappingDirty && <Alert tone="warning">{t("mappingChangedHint")}</Alert>}
        <Button type="button" variant="secondary" onClick={() => void uploadPreview()} disabled={busy || !file || !selectedSheet && hasMultipleSheets}>
          <Icon name="refresh" size={15} />{busy ? t("loading") : t("applyMapping")}
        </Button>
      </section>
      {errors.length > 0 && <div className="import-errors">
        <h3>{t("invalidRows")}</h3>
        {errors.slice(0, 50).map((item, index) => <div key={index}>
          <strong>{t("row")} {String(item.row ?? "")}</strong>
          <span>{getString(item, "column")}</span>
          <small>{getString(item, "reason")}</small>
        </div>)}
      </div>}
      {duplicates.length > 0 && <>
        <Alert tone="warning">{t("duplicates")}: {duplicates.length}. {t("duplicateWarning")}</Alert>
        <label className="checkbox-field"><input type="checkbox" checked={allowDuplicates} onChange={(e) => setAllowDuplicates(e.target.checked)} />{t("allowDuplicatesConfirmation")}</label>
      </>}
      {previewRows.length > 0 && <div className="import-preview">
        <h3>{t("validRowsPreview")}</h3><pre>{JSON.stringify(previewRows.slice(0, 8), null, 2)}</pre>
      </div>}
      <div className="modal-actions">
        <Button onClick={() => void confirmImport()} disabled={!canConfirm}>{t("confirmImport")}</Button>
      </div>
    </Panel>}
    {jobId && <Panel>
      <PanelHeader title={t("importStatus")} action={<Button variant="ghost" size="sm" onClick={job.reload}><Icon name="refresh" />{t("refresh")}</Button>} />
      {job.loading && !job.data ? <LoadingState /> : job.error ? <ErrorState message={job.error.message} retry={job.reload} /> : <>
        <div className="status-row">
          <Badge tone={status === "completed" ? "success" : status === "failed" ? "danger" : "info"}>
            {t(status === "preview" ? "preview" : status || "queued")}
          </Badge>
          <span>{Number(job.data?.createdCount ?? 0)} {t("created")} · {Number(job.data?.errorCount ?? 0)} {t("errors")} · {Number(job.data?.skippedCount ?? 0)} {t("skipped")}</span>
        </div>
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
    // Keep polling just beyond the 12-second cache TTL, so pending exports
    // are re-fetched without aborting an in-flight request.
    const timer = window.setInterval(resource.reload, 15_000);
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
