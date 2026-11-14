import { useEffect, useState, type FormEvent } from "react";
import type { DocumentDto, DocumentDeletionJobDto } from "@vivarqo/contracts/inventory";
import { api, ApiError } from "../../lib/api";
import { formatDate, formatNumber, getString, localDateTimeValue, queryString } from "../../lib/domain";
import type { Locale } from "../../lib/domain";
import { translate } from "../../lib/i18n";
import { useResource } from "../../hooks/useResource";
import { RemoteSelect } from "../../components/RemoteSelect";
import { Alert, Badge, Button, DataTable, EmptyState, ErrorState, Field, Icon, IconButton, Input, ListToolbar, LoadingState, Modal, PageHeader, Pagination, Panel, PanelHeader, Select, Textarea, useToast } from "../../components/ui";
export function DocumentsPage({ locale, path, navigate }: { locale: Locale; path: string; navigate: (path: string) => void }) {
  const t = (key: string) => translate(locale, key);
  const params = new URLSearchParams(path.includes("?") ? path.slice(path.indexOf("?")) : "");
  const [page, setPage] = useState(1);
  const [animalId, setAnimalId] = useState(params.get("animalId") ?? "");
  const [cycleId, setCycleId] = useState(params.get("cycleId") ?? "");
  const [search, setSearch] = useState(params.get("q") ?? "");
  useEffect(() => {
    const currentParams = new URLSearchParams(path.includes("?") ? path.slice(path.indexOf("?")) : "");
    setSearch(currentParams.get("q") ?? "");
    setAnimalId(currentParams.get("animalId") ?? "");
    setCycleId(currentParams.get("cycleId") ?? "");
    setPage(1);
  }, [path]);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState("other");
  const [note, setNote] = useState("");
  const [uploadModal, setUploadModal] = useState(Boolean(params.get("animalId") || params.get("cycleId")));
  const [editing, setEditing] = useState<DocumentDto | null>(null);
  const [editCategory, setEditCategory] = useState("");
  const [editNote, setEditNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { toast, show } = useToast();
  const resource = useResource<{ documents: DocumentDto[]; pagination: { page: number; totalPages: number; total: number } }>(
    "/documents" + queryString({ page, pageSize: 25, animalId, cycleId, q: search })
  );
  const deletionResource = useResource<{ deletions: DocumentDeletionJobDto[] }>("/document-deletions");

  async function upload(event: FormEvent) {
    event.preventDefault(); if (!file) { setError(t("chooseFile")); return; }
    if (!animalId && !cycleId) { setError(locale === "it" ? "Collega il documento a un animale o a un ciclo." : "Link the document to an animal or a breeding cycle."); return; }
    setBusy(true); setError("");
    try {
      const headers: Record<string, string> = { "X-Document-Category": category, "X-Document-Name": file.name };
      if (animalId) headers["X-Animal-Id"] = animalId;
      if (cycleId) headers["X-Cycle-Id"] = cycleId;
      if (note) headers["X-Document-Note"] = note;
      await api.upload("/documents", file, headers);
      setUploadModal(false); setFile(null); resource.reload(); show(t("uploaded"));
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  function openEdit(document: DocumentDto) { setEditing(document); setEditCategory(getString(document, "category")); setEditNote(getString(document, "note")); setError(""); }
  async function saveMetadata(event: FormEvent) {
    event.preventDefault(); if (!editing) return; setBusy(true); setError("");
    try { await api.patch(`/documents/${getString(editing, "id")}`, { category: editCategory, note: editNote || null }); setEditing(null); resource.reload(); show(t("saveSuccess")); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  async function remove(document: DocumentDto) {
    if (!window.confirm(t("confirmDelete"))) return;
    try {
      await api.delete(`/documents/${getString(document, "id")}`);
      resource.reload();
      deletionResource.reload();
      show(t("documentDeletionQueued"));
    } catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }
  async function retryDocumentDeletion(job: DocumentDeletionJobDto) {
    try {
      await api.post(`/document-deletions/${getString(job, "id")}/retry`, {});
      deletionResource.reload();
      show(t("documentDeletionQueued"));
    } catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }

  return <div className="page-stack">
    <PageHeader eyebrow={t("navResources")} title={t("documentsTitle")} description={t("documentsSubtitle")} action={<Button onClick={() => setUploadModal(true)}><Icon name="upload" />{t("uploadDocument")}</Button>} />
    <Panel>
      <ListToolbar searchValue={search} onSearchChange={(value) => { setSearch(value); setPage(1); }} searchPlaceholder={t("search")}
        filters={<><RemoteSelect label={t("animalDetail")} value={animalId} onChange={(value) => { setAnimalId(value); setPage(1); setCycleId(""); }} endpoint="/animals" responseKey="animals" filters={{ status: "all", sort: "name" }} detailEndpoint={(id) => "/animals/" + encodeURIComponent(id)} detailKey="animal" locale={locale} emptyLabel={t("all")} />
        <RemoteSelect label={t("cycles")} value={cycleId} onChange={(value) => { setCycleId(value); setPage(1); setAnimalId(""); }} endpoint="/reproduction-cycles" responseKey="cycles" filters={{ status: "all" }} detailEndpoint={(id) => "/reproduction-cycles/" + encodeURIComponent(id)} detailKey="cycle" locale={locale} emptyLabel={t("all")} /></>}
        activeFilterCount={[search, animalId, cycleId].filter(Boolean).length}
        onClearFilters={() => { setSearch(""); setAnimalId(""); setCycleId(""); setPage(1); }}
        resultCount={resource.data?.pagination.total} onRefresh={resource.reload} loading={resource.loading} />
      <div className="list-meta"><span className="muted-note">{t("privateStorage")}</span></div>
      {resource.loading && !resource.data ? <LoadingState /> : resource.error ? <ErrorState message={resource.error.message} retry={resource.reload} /> : (resource.data?.documents.length ?? 0) === 0 ? <EmptyState title={locale === "it" ? "Non hai ancora caricato documenti" : "No documents uploaded yet"} description={locale === "it" ? "Carica schede, certificati, referti o altri file e collegali a un animale o a un ciclo riproduttivo." : "Upload records, certificates, reports or other files and link them to an animal or breeding cycle."} action={<Button onClick={() => setUploadModal(true)}><Icon name="upload" size={15} />{t("uploadDocument")}</Button>} /> : <DataTable headers={[t("file"), t("documentCategory"), t("date"), t("animalDetail"), t("actions")]} rows={(resource.data?.documents ?? []).map((document) => [
        <div className="document-name"><span className="item-symbol"><Icon name="file" /></span><span><strong>{getString(document, "originalFilename")}</strong><small>{formatNumber(getString(document, "sizeBytes"), locale, 0)} bytes</small></span></div>,
        getString(document, "category"), formatDate(getString(document, "createdAt"), locale),
        getString(document.animal, "name") || getString(document.cycle, "name") || (getString(document, "animalId") ? t("navAnimals") : t("cycles")),
        <div className="row-actions"><IconButton label={t("download")} onClick={() => void api.download(`/documents/${getString(document, "id")}/download`, getString(document, "originalFilename", "document"))}><Icon name="download" /></IconButton><IconButton label={t("edit")} onClick={() => openEdit(document)}><Icon name="edit" /></IconButton><IconButton label={t("delete")} onClick={() => void remove(document)}><Icon name="trash" /></IconButton></div>
      ])} empty={t("noDocuments")} />}
      {resource.data?.pagination && <Pagination page={page} totalPages={resource.data.pagination.totalPages} onChange={setPage} label={t("page")} />}
    </Panel>
    {deletionResource.data?.deletions.length ? <Panel>
      <div className="list-meta">
        <strong>{t("documentDeletionStatus")}</strong>
        <Button size="sm" variant="ghost" onClick={deletionResource.reload}><Icon name="refresh" />{t("refresh")}</Button>
      </div>
      <div className="record-list">
        {deletionResource.data.deletions.map((job) => {
          const status = getString(job, "status");
          return <div className="record-row" key={getString(job, "id")}>
            <div>
              <strong>{getString(job.document, "originalFilename") || getString(job, "documentId")}</strong>
              <small>{t("documentDeletionStatus_" + status)} · {getString(job, "attempts")} {t("attempts")}</small>
            </div>
            {status === "failed" ? <Button size="sm" variant="secondary" onClick={() => void retryDocumentDeletion(job)}>{t("retry")}</Button> : null}
          </div>;
        })}
      </div>
    </Panel> : null}
    {uploadModal && <Modal title={t("uploadDocument")} onClose={() => setUploadModal(false)}>
      <form className="form-stack" onSubmit={upload}>{error && <Alert tone="danger">{error}</Alert>}
        <Field label={t("file")}><Input required type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        <Field label={t("documentCategory")}><Input required maxLength={40} value={category} onChange={(e) => setCategory(e.target.value)} /></Field>
        <RemoteSelect label={t("animalDetail")} value={animalId} onChange={(value) => { setAnimalId(value); if (value) setCycleId(""); }} endpoint="/animals" responseKey="animals" filters={{ status: "all", sort: "name" }} detailEndpoint={(id) => `/animals/${encodeURIComponent(id)}`} detailKey="animal" locale={locale} />
        <RemoteSelect label={t("cycles")} value={cycleId} onChange={(value) => { setCycleId(value); if (value) setAnimalId(""); }} endpoint="/reproduction-cycles" responseKey="cycles" filters={{ status: "all" }} detailEndpoint={(id) => `/reproduction-cycles/${encodeURIComponent(id)}`} detailKey="cycle" locale={locale} />
        <Field label={t("notes")}><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <p className="muted-note">{locale === "it" ? "Formati ammessi: PDF, JPG, PNG e WEBP. Dimensione massima: 10 MB." : "Allowed formats: PDF, JPG, PNG and WEBP. Maximum size: 10 MB."}</p>
        <div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setUploadModal(false)}>{t("cancel")}</Button><Button type="submit" disabled={busy || !file}>{busy ? t("loading") : t("uploadDocument")}</Button></div>
      </form>
    </Modal>}
    {editing && <Modal title={t("edit")} onClose={() => setEditing(null)}><form className="form-stack" onSubmit={saveMetadata}>{error && <Alert tone="danger">{error}</Alert>}<Field label={t("documentCategory")}><Input value={editCategory} onChange={(e) => setEditCategory(e.target.value)} /></Field><Field label={t("notes")}><Textarea rows={3} value={editNote} onChange={(e) => setEditNote(e.target.value)} /></Field><div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setEditing(null)}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("save")}</Button></div></form></Modal>}
    {toast}
  </div>;
}