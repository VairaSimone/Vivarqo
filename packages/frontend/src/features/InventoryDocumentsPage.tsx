import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { formatDate, formatNumber, getString, localDateTimeValue, queryString } from "../lib/domain";
import type { Locale } from "../lib/domain";
import { translate } from "../lib/i18n";
import { useResource } from "../hooks/useResource";
import { RemoteSelect } from "../components/RemoteSelect";
import { Alert, Badge, Button, DataTable, EmptyState, ErrorState, Field, Icon, IconButton, Input, LoadingState, Modal, PageHeader, Pagination, Panel, PanelHeader, Select, Textarea, useToast } from "../components/ui";

type Item = Record<string, unknown>;
const inventoryCategories = ["food", "substrate", "material", "equipment", "other"];

export function InventoryDocumentsPage({ locale, path, navigate }: { locale: Locale; path: string; navigate: (path: string) => void }) {
  return path.startsWith("/documents")
    ? <DocumentsPage locale={locale} path={path} navigate={navigate} />
    : <InventoryPage locale={locale} />;
}

function InventoryPage({ locale }: { locale: Locale }) {
  const t = (key: string) => translate(locale, key);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [active, setActive] = useState("true");
  const [lowStock, setLowStock] = useState(false);
  const [category, setCategory] = useState("");
  const [itemModal, setItemModal] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [form, setForm] = useState({ name: "", category: "food", unit: "unit", quantityOnHand: "0", minimumQuantity: "", notes: "" });
  const [movementItem, setMovementItem] = useState<Item | null>(null);
  const [movementForm, setMovementForm] = useState({ movementType: "in", quantity: "", occurredAt: localDateTimeValue(), unitCost: "", reference: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { toast, show } = useToast();
  const url = "/inventory/items" + queryString({ page, pageSize: 25, active, q, category, lowStock: lowStock ? "true" : null });
  const resource = useResource<{ items: Item[]; pagination: { page: number; totalPages: number; total: number } }>(url);
  const movements = useResource<{ movements: Item[]; pagination: { total: number; totalPages: number } }>(movementItem ? `/inventory/items/${getString(movementItem, "id")}/movements?page=1&pageSize=100` : null);

  function openItem(item?: Item) {
    setEditing(item ?? null);
    setForm({
      name: getString(item, "name"), category: getString(item, "category", "food"), unit: getString(item, "unit", "unit"),
      quantityOnHand: getString(item, "quantityOnHand", "0"), minimumQuantity: getString(item, "minimumQuantity"),
      notes: getString(item, "notes")
    });
    setError(""); setItemModal(true);
  }
  async function saveItem(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const shared = {
        name: form.name, category: form.category, unit: form.unit,
        minimumQuantity: form.minimumQuantity === "" ? null : Number(form.minimumQuantity),
        notes: form.notes || null
      };
      if (editing) await api.patch("/inventory/items/" + getString(editing, "id"), shared);
      else await api.post("/inventory/items", { ...shared, quantityOnHand: Number(form.quantityOnHand) });
      setItemModal(false); resource.reload(); show(t("saveSuccess"));
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  function openMovement(item: Item) {
    setMovementItem(item);
    setMovementForm({ movementType: "in", quantity: "", occurredAt: localDateTimeValue(), unitCost: "", reference: "", notes: "" });
    setError("");
  }
  async function saveMovement(event: FormEvent) {
    event.preventDefault(); if (!movementItem) return; setBusy(true); setError("");
    try {
      const body = {
        movementType: movementForm.movementType, quantity: Number(movementForm.quantity),
        occurredAt: new Date(movementForm.occurredAt).toISOString(),
        unitCostCents: movementForm.unitCost ? Math.round(Number(movementForm.unitCost.replace(",", ".")) * 100) : null,
        reference: movementForm.reference || null, notes: movementForm.notes || null
      };
      await api.post(`/inventory/items/${getString(movementItem, "id")}/movements`, body);
      setMovementItem(null); resource.reload(); show(t("saveSuccess"));
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  async function archiveItem(item: Item) {
    if (!window.confirm(t("confirmArchive"))) return;
    try { await api.post(`/inventory/items/${getString(item, "id")}/archive`); resource.reload(); show(t("archive")); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }

  const rows = (resource.data?.items ?? []).map((item) => [
    <div className="item-name"><span className="item-symbol"><Icon name="box" size={17} /></span><span><strong>{getString(item, "name")}</strong><small>{t(`item_${getString(item, "category")}`)} · {getString(item, "unit")}</small></span></div>,
    <strong className="number-cell">{formatNumber(getString(item, "quantityOnHand"), locale, 3)} {getString(item, "unit")}</strong>,
    getString(item, "minimumQuantity") ? formatNumber(getString(item, "minimumQuantity"), locale, 3) : "—",
    Boolean(item.isActive) && item.minimumQuantity !== null && Number(item.quantityOnHand) <= Number(item.minimumQuantity) ? <Badge tone="warning">{t("lowStock")}</Badge> : <Badge tone={Boolean(item.isActive) ? "success" : "neutral"}>{Boolean(item.isActive) ? t("active") : t("archived")}</Badge>,
    <div className="row-actions"><IconButton label={t("movements")} onClick={() => openMovement(item)}><Icon name="clock" /></IconButton><IconButton label={t("edit")} onClick={() => openItem(item)}><Icon name="edit" /></IconButton>{Boolean(item.isActive) && <IconButton label={t("archive")} onClick={() => void archiveItem(item)}><Icon name="archive" /></IconButton>}</div>
  ]);

  return <div className="page-stack">
    <PageHeader eyebrow={t("navResources")} title={t("inventoryTitle")} description={t("inventorySubtitle")} action={<Button onClick={() => openItem()}><Icon name="plus" />{t("addItem")}</Button>} />
    <Panel className="filters-panel"><div className="filter-row">
      <label className="search-control"><Icon name="search" /><input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder={t("search")} /></label>
      <Select value={active} onChange={(e) => { setActive(e.target.value); setPage(1); }}><option value="true">{t("active")}</option><option value="all">{t("all")}</option><option value="false">{t("archived")}</option></Select>
      <Select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}><option value="">{t("category")} · {t("all")}</option>{inventoryCategories.map((value) => <option value={value} key={value}>{t(`item_${value}`)}</option>)}</Select>
      <label className="checkbox-field low-stock-filter"><input type="checkbox" checked={lowStock} onChange={(e) => { setLowStock(e.target.checked); setPage(1); }} />{t("lowStock")}</label>
    </div></Panel>
    <Panel><div className="list-meta"><span>{resource.data?.pagination.total ?? 0} {t("rows")}</span><Button size="sm" variant="ghost" onClick={resource.reload}><Icon name="refresh" />{t("refresh")}</Button></div>
      {resource.loading && !resource.data ? <LoadingState /> : resource.error ? <ErrorState message={resource.error.message} retry={resource.reload} /> : <DataTable headers={[t("itemName"), t("quantity"), t("minimumQuantity"), t("status"), t("actions")]} rows={rows} empty={t("noInventory")} />}
      {resource.data?.pagination && <Pagination page={page} totalPages={resource.data.pagination.totalPages} onChange={setPage} label={t("page")} />}
    </Panel>
    {itemModal && <Modal title={editing ? t("edit") : t("addItem")} onClose={() => setItemModal(false)}>
      <form className="form-stack" onSubmit={saveItem}>{error && <Alert tone="danger">{error}</Alert>}
        <Field label={t("itemName")}><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <div className="form-grid"><Field label={t("category")}><Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{inventoryCategories.map((value) => <option key={value} value={value}>{t(`item_${value}`)}</option>)}</Select></Field><Field label={t("unit")}><Input required maxLength={24} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></Field></div>
        {!editing && <Field label={t("quantity")}><Input type="number" min="0" max="999999999.999" step="0.001" value={form.quantityOnHand} onChange={(e) => setForm({ ...form, quantityOnHand: e.target.value })} /></Field>}
        <Field label={t("minimumQuantity")}><Input type="number" min="0" max="999999999.999" step="0.001" value={form.minimumQuantity} onChange={(e) => setForm({ ...form, minimumQuantity: e.target.value })} /></Field>
        <Field label={t("notes")}><Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        <div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setItemModal(false)}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("save")}</Button></div>
      </form>
    </Modal>}
    {movementItem && <Modal title={`${t("movements")} · ${getString(movementItem, "name")}`} onClose={() => setMovementItem(null)} wide>
      <div className="movement-summary"><div><span>{t("available")}</span><strong>{formatNumber(getString(movementItem, "quantityOnHand"), locale, 3)} {getString(movementItem, "unit")}</strong></div><div><span>{t("minimumQuantity")}</span><strong>{getString(movementItem, "minimumQuantity") || "—"}</strong></div></div>
      <form className="form-stack" onSubmit={saveMovement}>{error && <Alert tone="danger">{error}</Alert>}
        <div className="form-grid"><Field label={t("movementType")}><Select value={movementForm.movementType} onChange={(e) => setMovementForm({ ...movementForm, movementType: e.target.value })}><option value="in">{t("in")}</option><option value="out">{t("out")}</option><option value="adjustment">{t("adjustment")}</option></Select></Field><Field label={t("quantity")} hint={movementForm.movementType === "adjustment" ? t("adjustmentHint") : undefined}><Input required type="number" min={movementForm.movementType === "adjustment" ? "0" : "0.001"} step="0.001" value={movementForm.quantity} onChange={(e) => setMovementForm({ ...movementForm, quantity: e.target.value })} /></Field><Field label={t("date")}><Input required type="datetime-local" value={movementForm.occurredAt} onChange={(e) => setMovementForm({ ...movementForm, occurredAt: e.target.value })} /></Field><Field label={locale === "it" ? "Costo unitario (€)" : "Unit cost (€)"}><Input type="number" min="0" step="0.01" value={movementForm.unitCost} onChange={(e) => setMovementForm({ ...movementForm, unitCost: e.target.value })} /></Field></div>
        <Field label={t("reference")}><Input value={movementForm.reference} onChange={(e) => setMovementForm({ ...movementForm, reference: e.target.value })} /></Field>
        <Field label={t("notes")}><Textarea rows={2} value={movementForm.notes} onChange={(e) => setMovementForm({ ...movementForm, notes: e.target.value })} /></Field>
        <Button type="submit" disabled={busy}>{t("addMovement")}</Button>
      </form>
      <div className="panel-separator" /><PanelHeader title={t("movements")} />
      {movements.loading ? <LoadingState /> : movements.error ? <ErrorState message={movements.error.message} retry={movements.reload} /> : <DataTable headers={[t("date"), t("movementType"), t("quantity"), t("notes")]} rows={(movements.data?.movements ?? []).map((movement) => [formatDate(getString(movement, "occurredAt"), locale), t(getString(movement, "movementType")), formatNumber(getString(movement, "quantity"), locale, 3), getString(movement, "notes") || "—"])} empty={t("noRecords")} />}
    </Modal>}
    {toast}
  </div>;
}

function DocumentsPage({ locale, path, navigate }: { locale: Locale; path: string; navigate: (path: string) => void }) {
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
  const [editing, setEditing] = useState<Item | null>(null);
  const [editCategory, setEditCategory] = useState("");
  const [editNote, setEditNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { toast, show } = useToast();
  const resource = useResource<{ documents: Item[]; pagination: { page: number; totalPages: number; total: number } }>(
    "/documents" + queryString({ page, pageSize: 25, animalId, cycleId, q: search })
  );

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
  function openEdit(document: Item) { setEditing(document); setEditCategory(getString(document, "category")); setEditNote(getString(document, "note")); setError(""); }
  async function saveMetadata(event: FormEvent) {
    event.preventDefault(); if (!editing) return; setBusy(true); setError("");
    try { await api.patch(`/documents/${getString(editing, "id")}`, { category: editCategory, note: editNote || null }); setEditing(null); resource.reload(); show(t("saveSuccess")); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  async function remove(document: Item) {
    if (!window.confirm(t("confirmDelete"))) return;
    try { await api.delete(`/documents/${getString(document, "id")}`); resource.reload(); show(t("delete")); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }

  return <div className="page-stack">
    <PageHeader eyebrow={t("navResources")} title={t("documentsTitle")} description={t("documentsSubtitle")} action={<Button onClick={() => setUploadModal(true)}><Icon name="upload" />{t("uploadDocument")}</Button>} />
    <Panel className="filters-panel"><div className="form-grid">
      <RemoteSelect label={t("animalDetail")} value={animalId} onChange={(value) => { setAnimalId(value); setPage(1); setCycleId(""); }} endpoint="/animals" responseKey="animals" filters={{ status: "all", sort: "name" }} detailEndpoint={(id) => `/animals/${encodeURIComponent(id)}`} detailKey="animal" locale={locale} emptyLabel={t("all")} />
      <RemoteSelect label={t("cycles")} value={cycleId} onChange={(value) => { setCycleId(value); setPage(1); setAnimalId(""); }} endpoint="/reproduction-cycles" responseKey="cycles" filters={{ status: "all" }} detailEndpoint={(id) => `/reproduction-cycles/${encodeURIComponent(id)}`} detailKey="cycle" locale={locale} emptyLabel={t("all")} />
      <label className="search-control"><Icon name="search" size={14} /><Input type="search" aria-label={locale === "it" ? "Cerca documenti" : "Search documents"} placeholder={t("search")} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
    </div></Panel>
    <Panel><div className="list-meta"><span>{resource.data?.pagination.total ?? 0} {t("rows")}</span><span className="muted-note">{t("privateStorage")}</span></div>
      {resource.loading && !resource.data ? <LoadingState /> : resource.error ? <ErrorState message={resource.error.message} retry={resource.reload} /> : <DataTable headers={[t("file"), t("documentCategory"), t("date"), t("animalDetail"), t("actions")]} rows={(resource.data?.documents ?? []).map((document) => [
        <div className="document-name"><span className="item-symbol"><Icon name="file" /></span><span><strong>{getString(document, "originalFilename")}</strong><small>{formatNumber(getString(document, "sizeBytes"), locale, 0)} bytes</small></span></div>,
        getString(document, "category"), formatDate(getString(document, "createdAt"), locale),
        getString(document.animal, "name") || getString(document.cycle, "name") || (getString(document, "animalId") ? t("navAnimals") : t("cycles")),
        <div className="row-actions"><IconButton label={t("download")} onClick={() => void api.download(`/documents/${getString(document, "id")}/download`, getString(document, "originalFilename", "document"))}><Icon name="download" /></IconButton><IconButton label={t("edit")} onClick={() => openEdit(document)}><Icon name="edit" /></IconButton><IconButton label={t("delete")} onClick={() => void remove(document)}><Icon name="trash" /></IconButton></div>
      ])} empty={t("noDocuments")} />}
      {resource.data?.pagination && <Pagination page={page} totalPages={resource.data.pagination.totalPages} onChange={setPage} label={t("page")} />}
    </Panel>
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