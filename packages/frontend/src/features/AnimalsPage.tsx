import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { downloadQrSvg, qrMatrix } from "../lib/qr";
import { dateForInput, formatDate, formatDateTime, getArray, getString, queryString, todayDate } from "../lib/domain";
import type { Locale } from "../lib/domain";
import { translate } from "../lib/i18n";
import { useResource } from "../hooks/useResource";
import { RemoteSelect } from "../components/RemoteSelect";
import { Alert, Badge, Button, DataTable, EmptyState, ErrorState, Field, Icon, IconButton, Input, LoadingState, Modal, PageHeader, Pagination, Panel, PanelHeader, Select, Textarea, useToast } from "../components/ui";

type Animal = Record<string, unknown>;
type AnimalForm = {
  name: string; identifier: string; species: string; sex: string; morph: string; geneticsNotes: string;
  birthDate: string; birthDateEstimated: boolean; acquiredDate: string; originDescription: string;
  previousBreeder: string; locationLabel: string; status: string; notes: string;
};
const emptyAnimal: AnimalForm = {
  name: "", identifier: "", species: "", sex: "unknown", morph: "", geneticsNotes: "", birthDate: "",
  birthDateEstimated: false, acquiredDate: "", originDescription: "", previousBreeder: "", locationLabel: "", status: "active", notes: ""
};

export function AnimalsPage({ locale, navigate, path }: { locale: Locale; navigate: (path: string) => void; path: string }) {
  const t = (key: string, values?: Record<string, string | number>) => translate(locale, key, values);
  const query = new URLSearchParams(path.includes("?") ? path.slice(path.indexOf("?")) : "");
  const [q, setQ] = useState(query.get("q") ?? "");
  const [search, setSearch] = useState(q);
  const [species, setSpecies] = useState("");
  const [morph, setMorph] = useState("");
  const [location, setLocation] = useState("");
  const [sex, setSex] = useState("");
  const [status, setStatus] = useState("active");
  const [sort, setSort] = useState("updatedAt");
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(false);
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const [weightQuickModal, setWeightQuickModal] = useState(false);
  const [quickAnimalId, setQuickAnimalId] = useState("");
  const [quickWeight, setQuickWeight] = useState("");
  const [quickDate, setQuickDate] = useState(todayDate());
  const [quickNotes, setQuickNotes] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickError, setQuickError] = useState("");
  const [editing, setEditing] = useState<Animal | null>(null);
  const [form, setForm] = useState<AnimalForm>(emptyAnimal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { toast, show } = useToast();

  useEffect(() => {
    const timer = window.setTimeout(() => { setQ(search); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (query.get("create") === "1") openCreate();
    if (query.get("weigh") === "1") setWeightQuickModal(true);
  }, [path]);

  const url = "/animals" + queryString({ page, pageSize: 25, q, species, morph, location, sex, status: status || "all", sort });
  const resource = useResource<{ animals: Animal[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>(url);
  const animals = resource.data?.animals ?? [];
  const pager = resource.data?.pagination;

  function openCreate() { setEditing(null); setForm(emptyAnimal); setError(""); setModal(true); }
  function openEdit(animal: Animal) {
    setEditing(animal);
    setForm({
      name: getString(animal, "name"), identifier: getString(animal, "identifier"), species: getString(animal, "species"),
      sex: getString(animal, "sex", "unknown"), morph: getString(animal, "morph"), geneticsNotes: getString(animal, "geneticsNotes"),
      birthDate: dateForInput(getString(animal, "birthDate") || null), birthDateEstimated: Boolean(animal.birthDateEstimated),
      acquiredDate: dateForInput(getString(animal, "acquiredDate") || null), originDescription: getString(animal, "originDescription"),
      previousBreeder: getString(animal, "previousBreeder"), locationLabel: getString(animal, "locationLabel"),
      status: getString(animal, "status", "active"), notes: getString(animal, "notes")
    });
    setError(""); setModal(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const body = {
      ...form, identifier: form.identifier || null, morph: form.morph || null,
      geneticsNotes: form.geneticsNotes || null, birthDate: form.birthDate || null,
      acquiredDate: form.acquiredDate || null, originDescription: form.originDescription || null,
      previousBreeder: form.previousBreeder || null, locationLabel: form.locationLabel || null, notes: form.notes || null
    };
    try {
      if (editing) await api.patch(`/animals/${getString(editing, "id")}`, body);
      else {
        const { status: _status, ...createBody } = body;
        await api.post("/animals", createBody);
      }
      setModal(false); resource.reload(); show(editing ? t("animalUpdated") : t("animalCreated"));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t("operationFailed"));
    } finally { setBusy(false); }
  }

  async function updateStatus(animal: Animal, action: "archive" | "restore" | "delete") {
    const label = action === "archive" ? t("confirmArchive") : t("confirmDelete");
    if (!window.confirm(label)) return;
    try {
      if (action === "delete") await api.delete(`/animals/${getString(animal, "id")}`);
      else await api.post(`/animals/${getString(animal, "id")}/${action}`);
      resource.reload();
      show(action === "archive" ? t("animalArchived") : action === "restore" ? t("animalRestored") : t("animalDeleted"));
    } catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }

  const rows = animals.map((animal) => {
    const id = getString(animal, "id");
    return [
      <button className="animal-name-cell" onClick={() => navigate(`/animals/${id}`)}><span className="animal-avatar"><Icon name="snake" size={16} /></span><span><strong>{getString(animal, "name")}</strong><small>{getString(animal, "identifier") || getString(animal, "species")}</small></span></button>,
      <span>{getString(animal, "species")}</span>,
      <span>{getString(animal, "morph") || "—"}</span>,
      <span>{getString(animal, "sex") ? t(getString(animal, "sex")) : "—"}</span>,
      <span>{getString(animal, "locationLabel") || "—"}</span>,
      <Badge tone={getString(animal, "status") === "active" ? "success" : "neutral"}>{t(`animalStatus_${getString(animal, "status")}`)}</Badge>,
      <div className="row-actions"><IconButton label={t("edit")} onClick={() => openEdit(animal)}><Icon name="edit" size={16} /></IconButton>{getString(animal, "status") === "archived" ? <IconButton label={t("restore")} onClick={() => void updateStatus(animal, "restore")}><Icon name="restore" size={16} /></IconButton> : <IconButton label={t("archive")} onClick={() => void updateStatus(animal, "archive")}><Icon name="archive" size={16} /></IconButton>}<IconButton label={t("delete")} onClick={() => void updateStatus(animal, "delete")}><Icon name="trash" size={16} /></IconButton></div>
    ];
  });

  if (path.match(/^\/animals\/[^/?]+/)) {
    const id = path.split("?")[0].split("/")[2] ?? "";
    return <AnimalDetailPage id={id} locale={locale} navigate={navigate} />;
  }

  return <div className="page-stack">
    <PageHeader eyebrow={t("navAnimals")} title={t("animalsTitle")} description={t("animalsSubtitle")} action={<div className="inline-actions"><Button variant="secondary" onClick={() => { setBulkError(""); setBulkModal(true); }}><Icon name="plus" size={16} />{t("bulkCreateAnimals")}</Button><Button onClick={openCreate}><Icon name="plus" size={16} />{t("animalNew")}</Button></div>} />
    <Panel className="filters-panel">
      <div className="filter-row">
        <label className="search-control"><Icon name="search" size={17} /><input placeholder={t("search")} value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <Select aria-label={t("status")} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="active">{t("active")}</option><option value="all">{t("allStatuses")}</option><option value="sold">{t("animalStatus_sold")}</option><option value="transferred">{t("animalStatus_transferred")}</option><option value="deceased">{t("animalStatus_deceased")}</option><option value="archived">{t("archived")}</option></Select>
        <Select aria-label={t("sex")} value={sex} onChange={(e) => { setSex(e.target.value); setPage(1); }}><option value="">{t("allSexes")}</option><option value="male">{t("male")}</option><option value="female">{t("female")}</option><option value="unknown">{t("unknown")}</option></Select>
        <Input placeholder={t("species")} value={species} onChange={(e) => { setSpecies(e.target.value); setPage(1); }} />
        <Input placeholder={t("morph")} value={morph} onChange={(e) => { setMorph(e.target.value); setPage(1); }} />
        <Input placeholder={t("location")} value={location} onChange={(e) => { setLocation(e.target.value); setPage(1); }} />
        <Select aria-label={t("sort")} value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}><option value="updatedAt">{t("recentlyUpdated")}</option><option value="createdAt">{t("recentlyCreated")}</option><option value="name">{t("name")}</option></Select>
      </div>
    </Panel>
    <Panel>
      <div className="list-meta"><span>{pager?.total ?? 0} {t("rows")}</span><Button variant="ghost" size="sm" onClick={resource.reload}><Icon name="refresh" size={15} />{t("refresh")}</Button></div>
      {resource.loading && !resource.data ? <LoadingState /> : resource.error ? <ErrorState message={resource.error.message} retry={resource.reload} /> :
        <DataTable headers={[t("name"), t("species"), t("morph"), t("sex"), t("location"), t("status"), t("actions")]} rows={rows} empty={t("noAnimals")} />}
      {pager && <Pagination page={pager.page} totalPages={pager.totalPages} onChange={setPage} label={t("page")} />}
    </Panel>
    {bulkModal && <Modal title={t("bulkCreateAnimals")} onClose={() => setBulkModal(false)} wide>
      <form className="form-stack" onSubmit={async (event) => {
        event.preventDefault(); setBulkBusy(true); setBulkError("");
        const parsed = bulkText.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => line.split("|").map((value) => value.trim()));
        if (parsed.some((parts) => parts.length < 2 || !parts[0] || !parts[1])) {
          setBulkError(t("bulkFormatError")); setBulkBusy(false); return;
        }
        const payload = parsed.map(([name, animalSpecies, animalSex, animalMorph, identifier]) => ({
          name, species: animalSpecies, sex: animalSex || "unknown",
          morph: animalMorph || null, identifier: identifier || null
        }));
        try {
          await api.post("/animals/bulk", { animals: payload });
          setBulkModal(false); setBulkText(""); resource.reload(); show(t("bulkAnimalsCreated", { count: payload.length }));
        } catch (reason) { setBulkError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
        finally { setBulkBusy(false); }
      }}>
        {bulkError && <Alert tone="danger">{bulkError}</Alert>}
        <Field label={t("bulkAnimalRows")} hint={t("bulkInputHint")}><Textarea required rows={8} value={bulkText} onChange={(e) => setBulkText(e.target.value)} placeholder="Nala | Python regius | female | Pastel | A-001" /></Field>
        <div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setBulkModal(false)}>{t("cancel")}</Button><Button type="submit" disabled={bulkBusy}>{bulkBusy ? t("loading") : t("create")}</Button></div>
      </form>
    </Modal>}
    {weightQuickModal && <Modal title={t("addWeight")} onClose={() => setWeightQuickModal(false)}>
      <form className="form-stack" onSubmit={async (event) => {
        event.preventDefault(); setQuickBusy(true); setQuickError("");
        try {
          await api.post("/animals/" + quickAnimalId + "/weights", {
            measuredAt: new Date(quickDate + "T12:00:00").toISOString(),
            weightG: Number(quickWeight), notes: quickNotes || null
          });
          setWeightQuickModal(false); setQuickWeight(""); setQuickNotes(""); show(t("saveSuccess"));
        } catch (reason) { setQuickError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
        finally { setQuickBusy(false); }
      }}>
        {quickError && <Alert tone="danger">{quickError}</Alert>}
        <RemoteSelect label={t("animalDetail")} value={quickAnimalId} onChange={setQuickAnimalId} endpoint="/animals" responseKey="animals" secondaryKey="species" filters={{ status: "active", sort: "name" }} detailEndpoint={(id) => `/animals/${encodeURIComponent(id)}`} detailKey="animal" locale={locale} />
        <div className="form-grid"><Field label={t("measuredAt")}><Input type="date" required value={quickDate} onChange={(e) => setQuickDate(e.target.value)} /></Field><Field label={t("weight")}><Input type="number" required min="0.01" max="100000000" step="0.01" value={quickWeight} onChange={(e) => setQuickWeight(e.target.value)} /></Field></div>
        <Field label={t("notes")}><Textarea rows={2} value={quickNotes} onChange={(e) => setQuickNotes(e.target.value)} /></Field>
        <div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setWeightQuickModal(false)}>{t("cancel")}</Button><Button type="submit" disabled={quickBusy || !quickAnimalId}>{quickBusy ? t("loading") : t("save")}</Button></div>
      </form>
    </Modal>}
    {modal && <Modal title={editing ? t("animalEdit") : t("animalNew")} onClose={() => setModal(false)} wide>
      <form className="form-stack" onSubmit={save}>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="form-grid">
          <Field label={t("name")}><Input required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label={t("identifier")}><Input maxLength={120} value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} /></Field>
          <Field label={t("species")}><Input required maxLength={160} value={form.species} onChange={(e) => setForm({ ...form, species: e.target.value })} /></Field>
          <Field label={t("sex")}><Select value={form.sex} onChange={(e) => setForm({ ...form, sex: e.target.value })}><option value="unknown">{t("unknown")}</option><option value="male">{t("male")}</option><option value="female">{t("female")}</option></Select></Field>
          <Field label={t("morph")}><Input value={form.morph} maxLength={200} onChange={(e) => setForm({ ...form, morph: e.target.value })} /></Field>
          <Field label={t("location")}><Input value={form.locationLabel} maxLength={160} onChange={(e) => setForm({ ...form, locationLabel: e.target.value })} /></Field>
          <Field label={t("birthDate")}><Input type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} /></Field>
          <Field label={t("acquiredDate")}><Input type="date" value={form.acquiredDate} onChange={(e) => setForm({ ...form, acquiredDate: e.target.value })} /></Field>
          <Field label={t("previousBreeder")}><Input value={form.previousBreeder} onChange={(e) => setForm({ ...form, previousBreeder: e.target.value })} /></Field>
          {editing && <Field label={t("status")}><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{["active", "sold", "transferred", "deceased"].map((value) => <option value={value} key={value}>{t(`animalStatus_${value}`)}</option>)}</Select></Field>}
        </div>
        <Field label={t("geneticsNotes")}><Textarea rows={2} value={form.geneticsNotes} onChange={(e) => setForm({ ...form, geneticsNotes: e.target.value })} /></Field>
        <Field label={t("origin")}><Textarea rows={2} value={form.originDescription} onChange={(e) => setForm({ ...form, originDescription: e.target.value })} /></Field>
        <Field label={t("animalNotes")}><Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        <label className="checkbox-field"><input type="checkbox" checked={form.birthDateEstimated} onChange={(e) => setForm({ ...form, birthDateEstimated: e.target.checked })} />{t("estimatedDate")}</label>
        <div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setModal(false)}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{busy ? t("loading") : t("save")}</Button></div>
      </form>
    </Modal>}
    {toast}
  </div>;
}

function AnimalDetailPage({ id, locale, navigate }: { id: string; locale: Locale; navigate: (path: string) => void }) {
  const t = (key: string) => translate(locale, key);
  const animalResource = useResource<{ animal: Animal }>(`/animals/${encodeURIComponent(id)}`);
  const [tab, setTab] = useState("overview");
  const [animalEditModal, setAnimalEditModal] = useState(false);
  const [animalEditBusy, setAnimalEditBusy] = useState(false);
  const [animalEditError, setAnimalEditError] = useState("");
  const [animalEditForm, setAnimalEditForm] = useState({
    name: "", identifier: "", species: "", sex: "unknown", morph: "", geneticsNotes: "",
    birthDate: "", birthDateEstimated: false, acquiredDate: "", originDescription: "",
    previousBreeder: "", locationLabel: "", status: "active", notes: ""
  });
  const [recordKind, setRecordKind] = useState<"weight" | "shed" | "note" | null>(null);
  const [recordEdit, setRecordEdit] = useState<Animal | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [recordForm, setRecordForm] = useState({ date: "", weight: "", outcome: "complete", category: "general", title: "", body: "", notes: "" });
  const { toast, show } = useToast();
  const animal = animalResource.data?.animal;
  const weights = useResource<{ weights: Animal[] }>(animal && tab === "history" ? `/animals/${id}/weights?page=1&pageSize=100` : null);
  const sheds = useResource<{ sheds: Animal[] }>(animal && tab === "history" ? `/animals/${id}/sheds?page=1&pageSize=100` : null);
  const notes = useResource<{ notes: Animal[] }>(animal && tab === "history" ? `/animals/${id}/notes?page=1&pageSize=100` : null);
  const documents = useResource<{ documents: Animal[] }>(animal && tab === "documents" ? `/documents?animalId=${encodeURIComponent(id)}&page=1&pageSize=100` : null);
  const traits = useResource<{ traits: Animal[] }>(animal && tab === "traits" ? `/animals/${id}/genetic-traits?page=1&pageSize=100` : null);
  const share = useResource<{ share: Animal }>(animal && tab === "share" ? `/animals/${id}/public-share` : null);

  function openAnimalEdit() {
    if (!animal) return;
    setAnimalEditForm({
      name: getString(animal, "name"), identifier: getString(animal, "identifier"),
      species: getString(animal, "species"), sex: getString(animal, "sex", "unknown"),
      morph: getString(animal, "morph"), geneticsNotes: getString(animal, "geneticsNotes"),
      birthDate: dateForInput(getString(animal, "birthDate") || null),
      birthDateEstimated: Boolean(animal.birthDateEstimated),
      acquiredDate: dateForInput(getString(animal, "acquiredDate") || null),
      originDescription: getString(animal, "originDescription"),
      previousBreeder: getString(animal, "previousBreeder"),
      locationLabel: getString(animal, "locationLabel"),
      status: getString(animal, "status") === "archived" ? "active" : getString(animal, "status", "active"),
      notes: getString(animal, "notes")
    });
    setAnimalEditError("");
    setAnimalEditModal(true);
  }

  async function saveAnimalEdit(event: FormEvent) {
    event.preventDefault();
    setAnimalEditBusy(true); setAnimalEditError("");
    const body = {
      ...animalEditForm,
      identifier: animalEditForm.identifier || null,
      morph: animalEditForm.morph || null,
      geneticsNotes: animalEditForm.geneticsNotes || null,
      birthDate: animalEditForm.birthDate || null,
      acquiredDate: animalEditForm.acquiredDate || null,
      originDescription: animalEditForm.originDescription || null,
      previousBreeder: animalEditForm.previousBreeder || null,
      locationLabel: animalEditForm.locationLabel || null,
      notes: animalEditForm.notes || null
    };
    try {
      await api.patch("/animals/" + id, body);
      setAnimalEditModal(false); animalResource.reload(); show(t("animalUpdated"));
    } catch (reason) {
      setAnimalEditError(reason instanceof ApiError ? reason.message : t("operationFailed"));
    } finally { setAnimalEditBusy(false); }
  }

  function openRecord(kind: "weight" | "shed" | "note", existing?: Animal) {
    setRecordKind(kind); setRecordEdit(existing ?? null); setFormError("");
    setRecordForm({
      date: existing ? dateForInput(getString(existing, kind === "weight" ? "measuredAt" : "occurredAt")) : new Date().toISOString().slice(0, 10),
      weight: existing ? getString(existing, "weightG") : "",
      outcome: existing ? getString(existing, "outcome", "complete") : "complete",
      category: existing ? getString(existing, "category", "general") : "general",
      title: existing ? getString(existing, "title") : "",
      body: existing ? getString(existing, "body") : "",
      notes: existing ? getString(existing, "notes") : ""
    });
  }

  async function saveRecord(event: FormEvent) {
    event.preventDefault(); setBusy(true); setFormError("");
    const isEdit = Boolean(recordEdit);
    const recordId = getString(recordEdit, "id");
    try {
      if (recordKind === "weight") {
        const payload = { measuredAt: new Date(`${recordForm.date}T12:00:00`).toISOString(), weightG: Number(recordForm.weight), notes: recordForm.notes || null };
        if (isEdit) await api.patch(`/weights/${recordId}`, payload); else await api.post(`/animals/${id}/weights`, payload);
      } else if (recordKind === "shed") {
        const payload = { occurredAt: new Date(`${recordForm.date}T12:00:00`).toISOString(), outcome: recordForm.outcome, notes: recordForm.notes || null };
        if (isEdit) await api.patch(`/sheds/${recordId}`, payload); else await api.post(`/animals/${id}/sheds`, payload);
      } else if (recordKind === "note") {
        const payload = { occurredAt: new Date(`${recordForm.date}T12:00:00`).toISOString(), title: recordForm.title || null, category: recordForm.category, body: recordForm.body };
        if (isEdit) await api.patch(`/animal-notes/${recordId}`, payload); else await api.post(`/animals/${id}/notes`, payload);
      }
      setRecordKind(null); weights.reload(); sheds.reload(); notes.reload(); animalResource.reload(); show(t("saveSuccess"));
    } catch (reason) { setFormError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }

  async function deleteRecord(kind: "weight" | "shed" | "note", record: Animal) {
    if (!window.confirm(t("confirmDelete"))) return;
    const idValue = getString(record, "id");
    const path = kind === "weight" ? `/weights/${idValue}` : kind === "shed" ? `/sheds/${idValue}` : `/animal-notes/${idValue}`;
    try { await api.delete(path); weights.reload(); sheds.reload(); notes.reload(); show(t("delete")); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }

  if (animalResource.loading && !animal) return <LoadingState />;
  if (animalResource.error || !animal) return <ErrorState message={animalResource.error?.message ?? t("noRecords")} retry={animalResource.reload} />;
  const animalName = getString(animal, "name");
  const tabItems = [
    ["overview", t("overview")], ["history", t("careHistory")], ["documents", t("documentsTab")],
    ["traits", t("traits")], ["share", t("publicShare")]
  ];

  return <div className="page-stack">
    <div className="back-row"><button className="text-link" onClick={() => navigate("/animals")}>← {t("navAnimals")}</button></div>
    <PageHeader eyebrow={getString(animal, "species")} title={animalName} description={getString(animal, "identifier") || getString(animal, "morph")} action={<Button variant="secondary" onClick={openAnimalEdit}><Icon name="edit" size={16} />{t("edit")}</Button>} />
    <div className="animal-profile-head">
      <div className="animal-profile-avatar"><Icon name="snake" size={30} /></div>
      <div className="animal-profile-main"><strong>{animalName}</strong><span>{getString(animal, "species")} · {getString(animal, "sex") ? t(getString(animal, "sex")) : "—"} · {getString(animal, "morph") || "—"}</span></div>
      <Badge tone={getString(animal, "status") === "active" ? "success" : "neutral"}>{t(`animalStatus_${getString(animal, "status")}`)}</Badge>
      <div className="animal-profile-actions"><Button variant="ghost" size="sm" onClick={() => navigate(`/feeding?animalId=${id}&create=1`)}><Icon name="feed" size={15} />{t("newFeeding")}</Button><Button variant="ghost" size="sm" onClick={() => openRecord("weight")}><Icon name="weight" size={15} />{t("addWeight")}</Button></div>
    </div>
    <div className="tabs-line" role="tablist">{tabItems.map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "selected" : ""} onClick={() => setTab(key)}>{label}</button>)}</div>

    {tab === "overview" && <div className="detail-grid">
      <Panel><PanelHeader title={t("overview")} /><div className="detail-fields">
        <Detail label={t("identifier")} value={getString(animal, "identifier")} /><Detail label={t("species")} value={getString(animal, "species")} />
        <Detail label={t("sex")} value={getString(animal, "sex") ? t(getString(animal, "sex")) : ""} /><Detail label={t("morph")} value={getString(animal, "morph")} />
        <Detail label={t("birthDate")} value={formatDate(getString(animal, "birthDate"), locale)} /><Detail label={t("acquiredDate")} value={formatDate(getString(animal, "acquiredDate"), locale)} />
        <Detail label={t("location")} value={getString(animal, "locationLabel")} /><Detail label={t("previousBreeder")} value={getString(animal, "previousBreeder")} />
      </div></Panel>
      <Panel><PanelHeader title={t("genetics")} /><p className="detail-copy">{getString(animal, "geneticsNotes") || t("noRecords")}</p><PanelHeader title={t("origin")} /><p className="detail-copy">{getString(animal, "originDescription") || t("noRecords")}</p><PanelHeader title={t("animalNotes")} /><p className="detail-copy">{getString(animal, "notes") || t("noRecords")}</p></Panel>
      <Panel><PanelHeader title={t("quickActions")} /><div className="quick-action-grid"><button className="quick-action" onClick={() => openRecord("weight")}><span><Icon name="weight" /></span><strong>{t("addWeight")}</strong><Icon name="plus" /></button><button className="quick-action" onClick={() => openRecord("shed")}><span><Icon name="refresh" /></span><strong>{t("addShed")}</strong><Icon name="plus" /></button><button className="quick-action" onClick={() => openRecord("note")}><span><Icon name="file" /></span><strong>{t("addNote")}</strong><Icon name="plus" /></button></div></Panel>
    </div>}

    {tab === "history" && <div className="page-stack">
      <div className="detail-grid">
        <Panel><PanelHeader title={t("weightHistory")} action={<Button size="sm" onClick={() => openRecord("weight")}><Icon name="plus" size={14} />{t("addWeight")}</Button>} />
          <WeightChart weights={weights.data?.weights ?? []} locale={locale} />
          <RecordList records={weights.data?.weights ?? []} kind="weight" locale={locale} onEdit={(record) => openRecord("weight", record)} onDelete={(record) => void deleteRecord("weight", record)} />
        </Panel>
        <Panel><PanelHeader title={t("addShed")} action={<Button size="sm" onClick={() => openRecord("shed")}><Icon name="plus" size={14} />{t("add")}</Button>} />
          <RecordList records={sheds.data?.sheds ?? []} kind="shed" locale={locale} onEdit={(record) => openRecord("shed", record)} onDelete={(record) => void deleteRecord("shed", record)} />
        </Panel>
        <Panel><PanelHeader title={t("animalNotes")} action={<Button size="sm" onClick={() => openRecord("note")}><Icon name="plus" size={14} />{t("add")}</Button>} />
          <RecordList records={notes.data?.notes ?? []} kind="note" locale={locale} onEdit={(record) => openRecord("note", record)} onDelete={(record) => void deleteRecord("note", record)} />
        </Panel>
      </div>
    </div>}

    {tab === "documents" && <Panel><PanelHeader title={t("documentsTab")} action={<Button onClick={() => navigate(`/documents?animalId=${id}`)}><Icon name="upload" size={15} />{t("uploadDocument")}</Button>} />
      {documents.data?.documents?.length ? <DataTable headers={[t("name"), t("documentCategory"), t("date"), t("actions")]} rows={documents.data.documents.map((doc) => [
        <strong>{getString(doc, "originalFilename")}</strong>, getString(doc, "category"), formatDate(getString(doc, "createdAt"), locale),
        <div className="row-actions"><IconButton label={t("download")} onClick={() => void api.download(`/documents/${getString(doc, "id")}/download`, getString(doc, "originalFilename", "document"))}><Icon name="download" /></IconButton></div>
      ])} empty={t("noDocuments")} /> : <EmptyState title={t("noDocuments")} description={t("emptyHint")} />}</Panel>}

    {tab === "traits" && <Panel><PanelHeader title={t("traits")} action={<Button onClick={() => {
      const traitName = window.prompt(t("traitName")); if (!traitName) return;
      const traitValue = window.prompt(t("traitValue")); if (!traitValue) return;
      void api.post(`/animals/${id}/genetic-traits`, { traitName, traitValue }).then(() => traits.reload()).catch((reason) => show(reason instanceof ApiError ? reason.message : t("operationFailed")));
    }}><Icon name="plus" size={15} />{t("add")}</Button>} />
      {traits.data?.traits?.length ? traits.data.traits.map((trait) => <div className="simple-row" key={getString(trait, "id")}><span className="simple-row-icon"><Icon name="leaf" /></span><div><strong>{getString(trait, "traitName")}</strong><small>{getString(trait, "traitValue")}{getString(trait, "confidenceNote") ? ` · ${getString(trait, "confidenceNote")}` : ""}</small></div><IconButton label={t("delete")} onClick={() => { if (window.confirm(t("confirmDelete"))) void api.delete(`/genetic-traits/${getString(trait, "id")}`).then(() => traits.reload()); }}><Icon name="trash" size={15} /></IconButton></div>) : <EmptyState title={t("noRecords")} />}</Panel>}

    {tab === "share" && <PublicSharePanel animalId={id} locale={locale} resource={share.data?.share ?? null} reload={share.reload} show={show} />}
    {animalEditModal && <Modal title={t("animalEdit")} onClose={() => setAnimalEditModal(false)} wide>
      <form className="form-stack" onSubmit={saveAnimalEdit}>
        {animalEditError && <Alert tone="danger">{animalEditError}</Alert>}
        <div className="form-grid">
          <Field label={t("name")}><Input required maxLength={120} value={animalEditForm.name} onChange={(e) => setAnimalEditForm({ ...animalEditForm, name: e.target.value })} /></Field>
          <Field label={t("identifier")}><Input maxLength={120} value={animalEditForm.identifier} onChange={(e) => setAnimalEditForm({ ...animalEditForm, identifier: e.target.value })} /></Field>
          <Field label={t("species")}><Input required maxLength={160} value={animalEditForm.species} onChange={(e) => setAnimalEditForm({ ...animalEditForm, species: e.target.value })} /></Field>
          <Field label={t("sex")}><Select value={animalEditForm.sex} onChange={(e) => setAnimalEditForm({ ...animalEditForm, sex: e.target.value })}><option value="unknown">{t("unknown")}</option><option value="male">{t("male")}</option><option value="female">{t("female")}</option></Select></Field>
          <Field label={t("morph")}><Input maxLength={200} value={animalEditForm.morph} onChange={(e) => setAnimalEditForm({ ...animalEditForm, morph: e.target.value })} /></Field>
          <Field label={t("location")}><Input maxLength={160} value={animalEditForm.locationLabel} onChange={(e) => setAnimalEditForm({ ...animalEditForm, locationLabel: e.target.value })} /></Field>
          <Field label={t("birthDate")}><Input type="date" value={animalEditForm.birthDate} onChange={(e) => setAnimalEditForm({ ...animalEditForm, birthDate: e.target.value })} /></Field>
          <Field label={t("acquiredDate")}><Input type="date" value={animalEditForm.acquiredDate} onChange={(e) => setAnimalEditForm({ ...animalEditForm, acquiredDate: e.target.value })} /></Field>
          <Field label={t("previousBreeder")}><Input maxLength={160} value={animalEditForm.previousBreeder} onChange={(e) => setAnimalEditForm({ ...animalEditForm, previousBreeder: e.target.value })} /></Field>
          <Field label={t("status")}><Select value={animalEditForm.status} onChange={(e) => setAnimalEditForm({ ...animalEditForm, status: e.target.value })}>{["active", "sold", "transferred", "deceased"].map((value) => <option value={value} key={value}>{t("animalStatus_" + value)}</option>)}</Select></Field>
        </div>
        <Field label={t("geneticsNotes")}><Textarea rows={2} value={animalEditForm.geneticsNotes} onChange={(e) => setAnimalEditForm({ ...animalEditForm, geneticsNotes: e.target.value })} /></Field>
        <Field label={t("origin")}><Textarea rows={2} value={animalEditForm.originDescription} onChange={(e) => setAnimalEditForm({ ...animalEditForm, originDescription: e.target.value })} /></Field>
        <Field label={t("animalNotes")}><Textarea rows={3} value={animalEditForm.notes} onChange={(e) => setAnimalEditForm({ ...animalEditForm, notes: e.target.value })} /></Field>
        <label className="checkbox-field"><input type="checkbox" checked={animalEditForm.birthDateEstimated} onChange={(e) => setAnimalEditForm({ ...animalEditForm, birthDateEstimated: e.target.checked })} />{t("estimatedDate")}</label>
        <div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setAnimalEditModal(false)}>{t("cancel")}</Button><Button type="submit" disabled={animalEditBusy}>{animalEditBusy ? t("loading") : t("save")}</Button></div>
      </form>
    </Modal>}
    {recordKind && <Modal title={recordKind === "weight" ? t("addWeight") : recordKind === "shed" ? t("addShed") : t("addNote")} onClose={() => setRecordKind(null)}>
      <form className="form-stack" onSubmit={saveRecord}>{formError && <Alert tone="danger">{formError}</Alert>}
        <Field label={t("date")}><Input required type="date" value={recordForm.date} onChange={(e) => setRecordForm({ ...recordForm, date: e.target.value })} /></Field>
        {recordKind === "weight" && <Field label={t("weight")}><Input required type="number" min="0.01" step="0.01" value={recordForm.weight} onChange={(e) => setRecordForm({ ...recordForm, weight: e.target.value })} /></Field>}
        {recordKind === "shed" && <Field label={t("outcome")}><Select value={recordForm.outcome} onChange={(e) => setRecordForm({ ...recordForm, outcome: e.target.value })}><option value="complete">{locale === "it" ? "Completa" : "Complete"}</option><option value="partial">{locale === "it" ? "Parziale" : "Partial"}</option><option value="unknown">{t("unknown")}</option></Select></Field>}
        {recordKind === "note" && <><Field label={t("name")}><Input value={recordForm.title} onChange={(e) => setRecordForm({ ...recordForm, title: e.target.value })} /></Field><Field label={t("category")}><Input required value={recordForm.category} onChange={(e) => setRecordForm({ ...recordForm, category: e.target.value })} /></Field><Field label={t("notes")}><Textarea required rows={4} value={recordForm.body} onChange={(e) => setRecordForm({ ...recordForm, body: e.target.value })} /></Field></>}
        {recordKind !== "note" && <Field label={t("notes")}><Textarea rows={3} value={recordForm.notes} onChange={(e) => setRecordForm({ ...recordForm, notes: e.target.value })} /></Field>}
        <div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setRecordKind(null)}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{busy ? t("loading") : t("save")}</Button></div>
      </form>
    </Modal>}
    {toast}
  </div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="detail-field"><span>{label}</span><strong>{value || "—"}</strong></div>;
}

function RecordList({ records, kind, locale, onEdit, onDelete }: { records: Animal[]; kind: "weight" | "shed" | "note"; locale: Locale; onEdit: (record: Animal) => void; onDelete: (record: Animal) => void }) {
  if (!records.length) return <EmptyState title={translate(locale, "noRecords")} />;
  return <div className="record-list">{records.map((record) => <div className="record-row" key={getString(record, "id")}><div><strong>{kind === "weight" ? `${getString(record, "weightG")} g` : kind === "shed" ? getString(record, "outcome") : getString(record, "title") || getString(record, "category")}</strong><small>{formatDate(kind === "weight" ? getString(record, "measuredAt") : getString(record, "occurredAt"), locale)}</small>{kind === "note" && <p>{getString(record, "body")}</p>}</div><div className="row-actions"><IconButton label={translate(locale, "edit")} onClick={() => onEdit(record)}><Icon name="edit" size={15} /></IconButton><IconButton label={translate(locale, "delete")} onClick={() => onDelete(record)}><Icon name="trash" size={15} /></IconButton></div></div>)}</div>;
}

function WeightChart({ weights, locale }: { weights: Animal[]; locale: Locale }) {
  const points = [...weights].reverse().map((weight) => Number(weight.weightG)).filter((n) => Number.isFinite(n));
  if (points.length < 2) return <p className="muted-note">{translate(locale, "noWeights")}</p>;
  const min = Math.min(...points); const max = Math.max(...points); const range = Math.max(max - min, 1);
  const coords = points.map((value, index) => `${8 + index * (284 / (points.length - 1))},${84 - ((value - min) / range) * 64}`).join(" ");
  return <div className="chart-wrap"><svg viewBox="0 0 300 100" role="img" aria-label={translate(locale, "weightHistory")}><path d="M8 84H292" stroke="currentColor" opacity=".15" /><polyline points={coords} fill="none" stroke="var(--forest)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />{points.map((value, index) => <circle key={index} cx={8 + index * (284 / (points.length - 1))} cy={84 - ((value - min) / range) * 64} r="3.5" fill="var(--terracotta)" />)}</svg><div className="chart-caption"><span>{min.toLocaleString(locale)} g</span><span>{max.toLocaleString(locale)} g</span></div></div>;
}

function PublicSharePanel({ animalId, locale, resource, reload, show }: { animalId: string; locale: Locale; resource: Animal | null; reload: () => void; show: (message: string) => void }) {
  const t = (key: string) => translate(locale, key);
  const share = resource;
  const visible = Array.isArray(share?.visibleFields) ? share.visibleFields as string[] : ["name", "species", "morph"];
  const [fields, setFields] = useState<string[]>(visible);
  const [description, setDescription] = useState(getString(share, "publicDescription"));
  const [enabled, setEnabled] = useState(Boolean(share?.isEnabled));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const options = ["name", "species", "morph", "sex", "birthDate"];
  const url = getString(share, "url");
  const qr = useMemo(() => {
    if (!url) return null;
    try { return qrMatrix(url); } catch { return null; }
  }, [url]);
  useEffect(() => {
    setFields(visible);
    setDescription(getString(share, "publicDescription"));
    setEnabled(Boolean(share?.isEnabled));
  }, [share?.id, share?.isEnabled, share?.publicDescription, JSON.stringify(share?.visibleFields ?? [])]);
  async function save() {
    setBusy(true); setError("");
    try {
      if (share) await api.patch(`/public-shares/${getString(share, "id")}`, { visibleFields: fields, publicDescription: description || null, isEnabled: enabled });
      else await api.post(`/animals/${animalId}/public-share`, { visibleFields: fields, publicDescription: description || null, isEnabled: enabled });
      reload(); show(t("saveSuccess"));
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  async function revoke() {
    if (!share) return;
    if (!window.confirm(t("confirmDelete"))) return;
    try { await api.patch(`/public-shares/${getString(share, "id")}`, { revoke: true }); reload(); show(t("saveSuccess")); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }
  return <Panel><PanelHeader title={t("publicShare")} description={locale === "it" ? "Scegli in modo esplicito quali campi rendere pubblici." : "Explicitly choose which fields can be shared publicly."} />
    {error && <Alert tone="danger">{error}</Alert>}
    <Field label={t("publicDescription")}><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
    <div className="field"><span className="field-label">{t("visibleFields")}</span><div className="checkbox-grid">{options.map((field) => <label className="checkbox-field" key={field}><input type="checkbox" checked={fields.includes(field)} onChange={(e) => setFields(e.target.checked ? [...fields, field] : fields.filter((item) => item !== field))} />{t(field)}</label>)}</div></div>
    <label className="checkbox-field"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{t("enableShare")}</label>
    <div className="inline-actions"><Button onClick={() => void save()} disabled={busy}>{busy ? t("loading") : t("save")}</Button>{share && <Button variant="danger" onClick={() => void revoke()}>{t("revokeShare")}</Button>}</div>
    {url && <div className="share-link-box"><span>{url}</span><Button size="sm" variant="secondary" onClick={() => { void navigator.clipboard.writeText(url).then(() => show(t("copied"))); }}><Icon name="copy" size={14} />{t("copyLink")}</Button><Button size="sm" variant="ghost" onClick={() => window.open(url, "_blank", "noopener,noreferrer")}><Icon name="external" size={14} />{t("publicPreview")}</Button></div>}
    {url && qr && <div className="qr-share">
      <div><strong>{locale === "it" ? "QR code della scheda" : "Profile QR code"}</strong>
        <small>{locale === "it" ? "Generato localmente nel browser, senza servizi esterni." : "Generated locally in your browser, without external services."}</small>
        <Button size="sm" variant="secondary" onClick={() => downloadQrSvg(url, "vivarqo-" + animalId + ".svg")}><Icon name="download" size={14} />{locale === "it" ? "Scarica QR SVG" : "Download QR SVG"}</Button>
      </div>
      <svg className="share-qr" viewBox={"0 0 " + (qr.length + 8) + " " + (qr.length + 8)} role="img" aria-label={locale === "it" ? "Codice QR scheda animale" : "Animal profile QR code"} shapeRendering="crispEdges">
        <rect width={qr.length + 8} height={qr.length + 8} fill="#fff" />
        {qr.flatMap((row, y) => row.map((dark, x) => dark ? <rect key={x + "-" + y} x={x + 4} y={y + 4} width="1" height="1" fill="#183a34" /> : null))}
      </svg>
    </div>}
    {url && !qr && <Alert tone="warning">{locale === "it" ? "URL troppo lungo per il QR code integrato." : "The URL is too long for the built-in QR code."}</Alert>}
    <p className="muted-note">{locale === "it" ? "La pagina pubblica espone esclusivamente i campi della allowlist del backend." : "The public page exposes only fields allowed by the backend."}</p>
  </Panel>;
}