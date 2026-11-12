import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "../../lib/api";
import { downloadQrSvg, qrMatrix } from "../../lib/qr";
import { dateForInput, formatDate, formatDateTime, formatWeight, getArray, getString, gramsToWeight, queryString, todayDate, weightToGrams, weightUnitLabel } from "../../lib/domain";
import type { Locale } from "../../lib/domain";
import type { AnimalDto } from "@vivarqo/contracts/animals";

import { translate } from "../../lib/i18n";
import { useResource } from "../../hooks/useResource";
import { RemoteSelect } from "../../components/RemoteSelect";
import { Alert, Badge, Button, DataTable, EmptyState, ErrorState, Field, Icon, IconButton, Input, ListToolbar, LoadingState, Modal, PageHeader, Pagination, Panel, PanelHeader, Select, Textarea, useToast } from "../../components/ui";
type AnimalForm = {
  name: string; identifier: string; species: string; sex: string; morph: string; geneticsNotes: string;
  birthDate: string; birthDateEstimated: boolean; acquiredDate: string; originDescription: string;
  previousBreeder: string; locationLabel: string; status: string; notes: string;
};
const emptyAnimal: AnimalForm = {
  name: "", identifier: "", species: "", sex: "unknown", morph: "", geneticsNotes: "", birthDate: "",
  birthDateEstimated: false, acquiredDate: "", originDescription: "", previousBreeder: "", locationLabel: "", status: "active", notes: ""
};

export function AnimalListPage({ locale, navigate, path }: { locale: Locale; navigate: (path: string) => void; path: string }) {
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
  const [editing, setEditing] = useState<AnimalDto | null>(null);
  const [form, setForm] = useState<AnimalForm>(emptyAnimal);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
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
  const resource = useResource<{ animals: AnimalDto[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>(url);
  const animals = resource.data?.animals ?? [];
  const pager = resource.data?.pagination;

  function openCreate() { setEditing(null); setForm(emptyAnimal); setPhotoFile(null); setError(""); setModal(true); }
  function openEdit(animal: AnimalDto) {
    setEditing(animal);
    setPhotoFile(null);
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
    event.preventDefault();
    setBusy(true);
    setError("");
    const body = {
      ...form, identifier: form.identifier || null, morph: form.morph || null,
      geneticsNotes: form.geneticsNotes || null, birthDate: form.birthDate || null,
      acquiredDate: form.acquiredDate || null, originDescription: form.originDescription || null,
      previousBreeder: form.previousBreeder || null, locationLabel: form.locationLabel || null, notes: form.notes || null
    };
    let targetAnimal = editing;
    try {
      if (editing) {
        await api.patch("/animals/" + getString(editing, "id"), body);
      } else {
        const { status: _status, ...createBody } = body;
        const created = await api.post<{ animal: AnimalDto }>("/animals", createBody);
        targetAnimal = created.animal;
        // Keep the created id when a subsequent photo upload needs to be retried.
        setEditing(created.animal);
      }
      if (photoFile && targetAnimal) {
        await api.upload("/animals/" + getString(targetAnimal, "id") + "/photo", photoFile);
      }
      setModal(false);
      setPhotoFile(null);
      resource.reload();
      show(editing ? t("animalUpdated") : t("animalCreated"));
    } catch (reason) {
      if (targetAnimal && !editing) resource.reload();
      setError(reason instanceof ApiError ? reason.message : t("operationFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto() {
    if (!editing || !getString(editing, "photoUrl")) return;
    if (!window.confirm(t("confirmDelete"))) return;
    setBusy(true);
    setError("");
    try {
      await api.delete("/animals/" + getString(editing, "id") + "/photo");
      setEditing({ ...editing, photoUrl: null });
      setPhotoFile(null);
      resource.reload();
      show(t("photoRemoved"));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t("operationFailed"));
    } finally {
      setBusy(false);
    }
  }

  function selectPhoto(file: File | null) {
    if (!file) { setPhotoFile(null); return; }
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (file.size > 5 * 1024 * 1024 || (file.type && !allowed.includes(file.type))) {
      setPhotoFile(null);
      setError(t("photoValidation"));
      return;
    }
    setError("");
    setPhotoFile(file);
  }

  async function updateStatus(animal: AnimalDto, action: "archive" | "restore" | "delete") {
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
      <button className="animal-name-cell" onClick={() => navigate(`/animals/${id}`)}><span className="animal-avatar">{getString(animal, "photoUrl") ? <img className="animal-avatar-image" src={getString(animal, "photoUrl")} alt="" loading="lazy" /> : <Icon name="snake" size={16} />}</span><span><strong>{getString(animal, "name")}</strong><small>{getString(animal, "identifier") || getString(animal, "species")}</small></span></button>,
      <span>{getString(animal, "species")}</span>,
      <span>{getString(animal, "morph") || "—"}</span>,
      <span>{getString(animal, "sex") ? t(getString(animal, "sex")) : "—"}</span>,
      <span>{getString(animal, "locationLabel") || "—"}</span>,
      <Badge tone={getString(animal, "status") === "active" ? "success" : "neutral"}>{t(`animalStatus_${getString(animal, "status")}`)}</Badge>,
      <div className="row-actions"><IconButton label={t("edit")} onClick={() => openEdit(animal)}><Icon name="edit" size={16} /></IconButton>{getString(animal, "status") === "archived" ? <IconButton label={t("restore")} onClick={() => void updateStatus(animal, "restore")}><Icon name="restore" size={16} /></IconButton> : <IconButton label={t("archive")} onClick={() => void updateStatus(animal, "archive")}><Icon name="archive" size={16} /></IconButton>}<IconButton label={t("delete")} onClick={() => void updateStatus(animal, "delete")}><Icon name="trash" size={16} /></IconButton></div>
    ];
  });

  return <div className="page-stack">
    <PageHeader eyebrow={t("navAnimals")} title={t("animalsTitle")} description={t("animalsSubtitle")} action={<div className="inline-actions"><Button variant="secondary" onClick={() => { setBulkError(""); setBulkModal(true); }}><Icon name="plus" size={16} />{t("bulkCreateAnimals")}</Button><Button onClick={openCreate}><Icon name="plus" size={16} />{t("animalNew")}</Button></div>} />
    <Panel>
      <ListToolbar searchValue={search} onSearchChange={(value) => { setSearch(value); setPage(1); }} searchPlaceholder={t("search")}
        filters={<><Select aria-label={t("status")} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="active">{t("active")}</option><option value="all">{t("allStatuses")}</option><option value="sold">{t("animalStatus_sold")}</option><option value="transferred">{t("animalStatus_transferred")}</option><option value="deceased">{t("animalStatus_deceased")}</option><option value="archived">{t("archived")}</option></Select>
        <Select aria-label={t("sex")} value={sex} onChange={(e) => { setSex(e.target.value); setPage(1); }}><option value="">{t("allSexes")}</option><option value="male">{t("male")}</option><option value="female">{t("female")}</option><option value="unknown">{t("unknown")}</option></Select>
        <Input aria-label={t("species")} placeholder={t("species")} value={species} onChange={(e) => { setSpecies(e.target.value); setPage(1); }} />
        <Input aria-label={t("morph")} placeholder={t("morph")} value={morph} onChange={(e) => { setMorph(e.target.value); setPage(1); }} />
        <Input aria-label={t("location")} placeholder={t("location")} value={location} onChange={(e) => { setLocation(e.target.value); setPage(1); }} />
        <Select aria-label={t("sort")} value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}><option value="updatedAt">{t("recentlyUpdated")}</option><option value="createdAt">{t("recentlyCreated")}</option><option value="name">{t("name")}</option></Select></>}
        activeFilterCount={[q, status !== "active" ? status : "", sex, species, morph, location].filter(Boolean).length}
        onClearFilters={() => { setSearch(""); setQ(""); setStatus("active"); setSex(""); setSpecies(""); setMorph(""); setLocation(""); setSort("updatedAt"); setPage(1); }}
        resultCount={pager?.total ?? 0} onRefresh={resource.reload} loading={resource.loading} />
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
            weightG: weightToGrams(quickWeight), notes: quickNotes || null
          });
          setWeightQuickModal(false); setQuickWeight(""); setQuickNotes(""); show(t("saveSuccess"));
        } catch (reason) { setQuickError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
        finally { setQuickBusy(false); }
      }}>
        {quickError && <Alert tone="danger">{quickError}</Alert>}
        <RemoteSelect label={t("animalDetail")} value={quickAnimalId} onChange={setQuickAnimalId} endpoint="/animals" responseKey="animals" secondaryKey="species" filters={{ status: "active", sort: "name" }} detailEndpoint={(id) => `/animals/${encodeURIComponent(id)}`} detailKey="animal" locale={locale} />
        <div className="form-grid"><Field label={t("measuredAt")}><Input type="date" required value={quickDate} onChange={(e) => setQuickDate(e.target.value)} /></Field><Field label={`${t("weight")} (${weightUnitLabel()})`}><Input type="number" required min="0.01" max="100000000" step="0.01" value={quickWeight} onChange={(e) => setQuickWeight(e.target.value)} /></Field></div>
        <Field label={t("notes")}><Textarea rows={2} value={quickNotes} onChange={(e) => setQuickNotes(e.target.value)} /></Field>
        <div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setWeightQuickModal(false)}>{t("cancel")}</Button><Button type="submit" disabled={quickBusy || !quickAnimalId}>{quickBusy ? t("loading") : t("save")}</Button></div>
      </form>
    </Modal>}
    {modal && <Modal title={editing ? t("animalEdit") : t("animalNew")} onClose={() => setModal(false)} wide>
      <form className="form-stack" onSubmit={save}>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label={t("animalPhoto")} hint={t("animalPhotoHint")}>
          <Input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => selectPhoto(e.target.files?.[0] ?? null)} />
        </Field>
        {photoFile && <p className="muted-note">{photoFile.name}</p>}
        {editing?.photoUrl && <div className="animal-photo-editor"><img src={editing.photoUrl} alt={t("animalPhoto")} /><Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => void removePhoto()}>{t("removePhoto")}</Button></div>}
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