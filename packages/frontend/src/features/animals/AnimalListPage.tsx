import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "../../lib/api";
import { downloadQrSvg, qrMatrix } from "../../lib/qr";
import { dateForInput, formatDate, formatDateTime, formatWeight, getArray, getString, gramsToWeight, queryString, todayDate, weightToGrams, weightUnitLabel } from "../../lib/domain";
import type { Locale } from "../../lib/domain";
import type { AnimalDto } from "@vivarqo/contracts/animals";
import { AnimalManagementPanel } from "./AnimalManagementPanel";

import { translate } from "../../lib/i18n";
import { useResource } from "../../hooks/useResource";
import { RemoteSelect } from "../../components/RemoteSelect";
import { Alert, Badge, Button, DataTable, EmptyState, ErrorState, Field, Icon, IconButton, Input, ListToolbar, LoadingState, Modal, PageHeader, Pagination, Panel, PanelHeader, Select, Textarea, useToast } from "../../components/ui";
type AnimalForm = {
  name: string; identifier: string; species: string; category: string; domainProfile: Record<string, unknown>;
  sex: string; morph: string; motherAnimalId: string; fatherAnimalId: string; motherDescription: string; fatherDescription: string; geneticsNotes: string;
  birthDate: string; birthDateEstimated: boolean; acquiredDate: string; originDescription: string;
  previousBreeder: string; locationLabel: string; status: string; notes: string;
};
const emptyAnimal: AnimalForm = {
  name: "", identifier: "", species: "", category: "reptiles", domainProfile: {}, sex: "unknown", morph: "", motherAnimalId: "", fatherAnimalId: "", motherDescription: "", fatherDescription: "", geneticsNotes: "", birthDate: "",
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
  const [category, setCategory] = useState(query.get("category") ?? "");
  const [enabledCategories, setEnabledCategories] = useState<string[]>([]);
  const [status, setStatus] = useState("active");
  const [sort, setSort] = useState("updatedAt");
  const [page, setPage] = useState(1);
  const [selectedSavedFilterId, setSelectedSavedFilterId] = useState("");
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
  const [selectedAnimalIds, setSelectedAnimalIds] = useState<string[]>([]);
  const [bulkCareModal, setBulkCareModal] = useState(false);
  const [bulkCareKind, setBulkCareKind] = useState<"weight" | "shed">("weight");
  const [bulkCareDate, setBulkCareDate] = useState(todayDate());
  const [bulkCareWeight, setBulkCareWeight] = useState("");
  const [bulkCareOutcome, setBulkCareOutcome] = useState("complete");
  const [bulkCareNotes, setBulkCareNotes] = useState("");
  const [bulkCareBusy, setBulkCareBusy] = useState(false);
  const [bulkCareError, setBulkCareError] = useState("");

  const [editing, setEditing] = useState<AnimalDto | null>(null);
  const [form, setForm] = useState<AnimalForm>(emptyAnimal);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { toast, show } = useToast();

  useEffect(() => {
    let active = true;
    // The active workspace, not the collaborator's personal account, defines
    // which animal categories are available in this view.
    api.get<{ categories: string[] }>("/collaborators/context")
      .then((context) => {
        if (!active) return;
        const categories = context.categories.filter((value) => ["reptiles", "fish", "birds", "dogs_cats"].includes(value));
        setEnabledCategories(categories);
        setCategory((current) => current && categories.includes(current) ? current : "");
        setForm((current) => ({ ...current, category: current.category && categories.includes(current.category) ? current.category : categories[0] ?? "" }));
      })
      .catch(() => {
        if (!active) return;
        // Fail closed: never offer categories based on a personal-account
        // fallback when the active workspace context cannot be determined.
        setEnabledCategories([]);
        setCategory("");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { setQ(search); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (query.get("create") === "1") openCreate();
    if (query.get("weigh") === "1") setWeightQuickModal(true);
  }, [path]);

  const url = "/animals" + queryString({ page, pageSize: 25, q, category, species, morph, location, sex, status: status || "all", sort });
  const resource = useResource<{ animals: AnimalDto[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>(url);
  const animals = resource.data?.animals ?? [];
  const pager = resource.data?.pagination;
  const savedFiltersResource = useResource<{ filters: Array<{ id: string; name: string; filters: Record<string, unknown> }> }>("/animals/filters");

  async function saveCurrentFilter() {
    const name = window.prompt(locale === "it" ? "Nome del filtro da salvare" : "Name this saved filter");
    if (!name?.trim()) return;
    try {
      await api.post("/animals/filters", { name: name.trim(), filters: { q, species, morph, location, sex, status, sort } });
      savedFiltersResource.reload();
      show(locale === "it" ? "Filtro salvato." : "Filter saved.");
    } catch (reason) {
      show(reason instanceof ApiError ? reason.message : t("operationFailed"));
    }
  }

  async function deleteSavedFilter() {
    if (!selectedSavedFilterId) return;
    if (!window.confirm(locale === "it" ? "Eliminare il filtro salvato?" : "Delete this saved filter?")) return;
    try {
      await api.delete(`/animals/filters/${encodeURIComponent(selectedSavedFilterId)}`);
      setSelectedSavedFilterId("");
      savedFiltersResource.reload();
      show(locale === "it" ? "Filtro eliminato." : "Saved filter deleted.");
    } catch (reason) {
      show(reason instanceof ApiError ? reason.message : t("operationFailed"));
    }
  }

  function applySavedFilter(filterId: string) {
    const saved = savedFiltersResource.data?.filters.find((item) => item.id === filterId);
    if (!saved) return;
    const value = saved.filters;
    setSearch(String(value.q ?? ""));
    setQ(String(value.q ?? ""));
    setSpecies(String(value.species ?? ""));
    setMorph(String(value.morph ?? ""));
    setLocation(String(value.location ?? ""));
    setSex(String(value.sex ?? ""));
    setStatus(String(value.status ?? "active"));
    setSort(String(value.sort ?? "updatedAt"));
    setPage(1);
  }

  function openCreate() { setEditing(null); setForm({ ...emptyAnimal, category: enabledCategories[0] ?? "" }); setPhotoFile(null); setError(""); setModal(true); }
  function openEdit(animal: AnimalDto) {
    setEditing(animal);
    setPhotoFile(null);
    const animalWithDomain = animal as AnimalDto & { category?: string; domainProfile?: Record<string, unknown> | null };
    setForm({
      name: getString(animal, "name"), identifier: getString(animal, "identifier"), species: getString(animal, "species"),
      category: animalWithDomain.category ?? "reptiles", domainProfile: animalWithDomain.domainProfile ?? {},
      sex: getString(animal, "sex", "unknown"), morph: getString(animal, "morph"), motherAnimalId: getString(animal, "motherAnimalId"), fatherAnimalId: getString(animal, "fatherAnimalId"), motherDescription: getString(animal, "motherDescription"), fatherDescription: getString(animal, "fatherDescription"), geneticsNotes: getString(animal, "geneticsNotes"),
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
      ...form,
      domainProfile: Object.fromEntries(Object.entries(form.domainProfile).filter(([, value]) => value !== "" && value !== null && value !== undefined)),
      identifier: form.identifier || null, morph: form.morph || null,
      motherAnimalId: form.motherAnimalId || null, fatherAnimalId: form.fatherAnimalId || null,
      motherDescription: form.motherDescription || null, fatherDescription: form.fatherDescription || null,
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
    <PageHeader eyebrow={t("navAnimals")} title={t("animalsTitle")} description={t("animalsSubtitle")} action={<div className="inline-actions"><Select aria-label={locale === "it" ? "Filtri salvati" : "Saved filters"} value={selectedSavedFilterId} onChange={(e) => { setSelectedSavedFilterId(e.target.value); applySavedFilter(e.target.value); }}><option value="">{locale === "it" ? "Filtri salvati" : "Saved filters"}</option>{(savedFiltersResource.data?.filters ?? []).map((filter) => <option key={filter.id} value={filter.id}>{filter.name}</option>)}</Select><Button variant="secondary" disabled={!selectedSavedFilterId} onClick={() => void deleteSavedFilter()}>{locale === "it" ? "Elimina filtro" : "Delete filter"}</Button><Button variant="secondary" onClick={() => void saveCurrentFilter()}>{locale === "it" ? "Salva filtri" : "Save filters"}</Button>{selectedAnimalIds.length > 0 && <Button variant="secondary" onClick={() => { setBulkCareError(""); setBulkCareModal(true); }}>{locale === "it" ? `Registra su ${selectedAnimalIds.length} animali` : `Record for ${selectedAnimalIds.length} animals`}</Button>}<Button variant="secondary" disabled={enabledCategories.length === 0} onClick={() => { setBulkError(""); setBulkModal(true); }}><Icon name="plus" size={16} />{t("bulkCreateAnimals")}</Button><Button onClick={openCreate} disabled={enabledCategories.length === 0}><Icon name="plus" size={16} />{t("animalNew")}</Button></div>} />
    <AnimalManagementPanel locale={locale} />
    <Panel>
      <ListToolbar searchValue={search} onSearchChange={(value) => { setSearch(value); setPage(1); }} searchPlaceholder={t("search")}
        filters={<><Select aria-label={t("status")} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="active">{t("active")}</option><option value="all">{t("allStatuses")}</option><option value="sold">{t("animalStatus_sold")}</option><option value="transferred">{t("animalStatus_transferred")}</option><option value="deceased">{t("animalStatus_deceased")}</option><option value="archived">{t("archived")}</option></Select>
        <Select aria-label={locale === "it" ? "Categoria" : "Category"} value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}><option value="">{locale === "it" ? "Tutte le categorie" : "All categories"}</option>{enabledCategories.map((value) => <option key={value} value={value}>{value === "dogs_cats" ? (locale === "it" ? "Cani e gatti" : "Dogs and cats") : value === "reptiles" ? (locale === "it" ? "Rettili" : "Reptiles") : value === "fish" ? (locale === "it" ? "Pesci" : "Fish") : (locale === "it" ? "Uccelli" : "Birds")}</option>)}</Select>
        <Select aria-label={t("sex")} value={sex} onChange={(e) => { setSex(e.target.value); setPage(1); }}><option value="">{t("allSexes")}</option><option value="male">{t("male")}</option><option value="female">{t("female")}</option><option value="unknown">{t("unknown")}</option></Select>
        <Input aria-label={t("species")} placeholder={t("species")} value={species} onChange={(e) => { setSpecies(e.target.value); setPage(1); }} />
        <Input aria-label={t("morph")} placeholder={t("morph")} value={morph} onChange={(e) => { setMorph(e.target.value); setPage(1); }} />
        <Input aria-label={t("location")} placeholder={t("location")} value={location} onChange={(e) => { setLocation(e.target.value); setPage(1); }} />
        <Select aria-label={t("sort")} value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}><option value="updatedAt">{t("recentlyUpdated")}</option><option value="createdAt">{t("recentlyCreated")}</option><option value="name">{t("name")}</option></Select></>}
        activeFilterCount={[q, category, status !== "active" ? status : "", sex, species, morph, location].filter(Boolean).length}
        onClearFilters={() => { setSearch(""); setQ(""); setCategory(""); setStatus("active"); setSex(""); setSpecies(""); setMorph(""); setLocation(""); setSort("updatedAt"); setPage(1); }}
        resultCount={pager?.total ?? 0} onRefresh={resource.reload} loading={resource.loading} />
      {resource.loading && !resource.data ? <LoadingState /> : resource.error ? <ErrorState message={resource.error.message} retry={resource.reload} /> :
        rows.length === 0 && (pager?.total ?? 0) === 0 && !q && !species && !morph && !location && !sex && status === "active"
          ? <EmptyState title={locale === "it" ? "Non hai ancora aggiunto animali" : "You haven't added any animals yet"} description={locale === "it" ? "Crea la scheda del primo esemplare oppure importa la tua collezione da Excel per iniziare a gestire alimentazioni, pesi e mute." : "Create your first animal profile or import your collection from Excel to start tracking feedings, weights and sheds."} action={<Button onClick={openCreate} disabled={enabledCategories.length === 0}><Icon name="plus" size={15} />{t("animalNew")}</Button>} />
          : <DataTable headers={[locale === "it" ? "Seleziona" : "Select", t("name"), t("species"), t("morph"), t("sex"), t("location"), t("status"), t("actions")]} rows={rows} empty={t("noAnimals")} />}
      {pager && <Pagination page={pager.page} totalPages={pager.totalPages} onChange={setPage} label={t("page")} />}
    </Panel>
    {bulkCareModal && <Modal title={locale === "it" ? "Registrazione multipla" : "Bulk care record"} onClose={() => setBulkCareModal(false)} wide>
      <form className="form-stack" onSubmit={async (event) => {
        event.preventDefault();
        setBulkCareBusy(true); setBulkCareError("");
        try {
          const payload = bulkCareKind === "weight"
            ? {
                kind: "weight" as const,
                animalIds: selectedAnimalIds,
                measuredAt: new Date(bulkCareDate + "T12:00:00").toISOString(),
                weightG: weightToGrams(bulkCareWeight),
                notes: bulkCareNotes || null,
              }
            : {
                kind: "shed" as const,
                animalIds: selectedAnimalIds,
                occurredAt: new Date(bulkCareDate + "T12:00:00").toISOString(),
                outcome: bulkCareOutcome as "complete" | "partial" | "unknown",
                notes: bulkCareNotes || null,
              };
          const result = await api.post<{ createdCount: number }>("/care-records/bulk", payload);
          setBulkCareModal(false);
          setSelectedAnimalIds([]);
          setBulkCareWeight("");
          setBulkCareNotes("");
          show(locale === "it" ? `Registrazione salvata atomicamente su ${result.createdCount} animali.` : `Record saved atomically for ${result.createdCount} animals.`);
        } catch (error) {
          setBulkCareError(error instanceof ApiError ? error.message : (locale === "it" ? "Il server non ha confermato la registrazione. Verifica lo storico prima di riprovare." : "The server did not confirm the operation. Check the record history before retrying."));
        } finally {
          setBulkCareBusy(false);
        }
      }}>
        {bulkCareError && <Alert tone="danger">{bulkCareError}</Alert>}
        <p>{locale === "it" ? `L'operazione verrà applicata a ${selectedAnimalIds.length} animali selezionati. La registrazione è atomica: se il server rifiuta la richiesta, non viene salvato alcun record.` : `This operation applies to ${selectedAnimalIds.length} selected animals. The operation is atomic: if the server rejects the request, no records are saved.`}</p>
        <Field label={locale === "it" ? "Tipo di registrazione" : "Record type"}><Select value={bulkCareKind} onChange={(event) => setBulkCareKind(event.target.value as "weight" | "shed")}><option value="weight">{locale === "it" ? "Pesatura" : "Weight"}</option><option value="shed">{locale === "it" ? "Muta" : "Shed"}</option></Select></Field>
        <Field label={locale === "it" ? "Data" : "Date"}><Input type="date" required value={bulkCareDate} onChange={(event) => setBulkCareDate(event.target.value)} /></Field>
        {bulkCareKind === "weight" ? <Field label={`${t("weight")} (${weightUnitLabel()})`}><Input type="number" min="0.01" max="100000000" step="0.01" required value={bulkCareWeight} onChange={(event) => setBulkCareWeight(event.target.value)} /></Field> : <Field label={locale === "it" ? "Esito muta" : "Shed outcome"}><Select value={bulkCareOutcome} onChange={(event) => setBulkCareOutcome(event.target.value)}><option value="complete">{locale === "it" ? "Completa" : "Complete"}</option><option value="partial">{locale === "it" ? "Parziale" : "Partial"}</option><option value="unknown">{locale === "it" ? "Non noto" : "Unknown"}</option></Select></Field>}
        <Field label={t("notes")}><Textarea rows={2} value={bulkCareNotes} onChange={(event) => setBulkCareNotes(event.target.value)} /></Field>
        <div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setBulkCareModal(false)} disabled={bulkCareBusy}>{t("cancel")}</Button><Button type="submit" disabled={bulkCareBusy || selectedAnimalIds.length === 0 || (bulkCareKind === "weight" && !bulkCareWeight)}>{bulkCareBusy ? t("loading") : (locale === "it" ? "Registra" : "Save records")}</Button></div>
      </form>
    </Modal>}
    {bulkModal && <Modal title={t("bulkCreateAnimals")} onClose={() => setBulkModal(false)} wide>
      <form className="form-stack" onSubmit={async (event) => {
        event.preventDefault(); setBulkBusy(true); setBulkError("");
        const parsed = bulkText.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => line.split("|").map((value) => value.trim()));
        if (parsed.some((parts) => parts.length < 2 || !parts[0] || !parts[1])) {
          setBulkError(t("bulkFormatError")); setBulkBusy(false); return;
        }
        const payload = parsed.map(([name, animalSpecies, animalSex, animalMorph, identifier]) => ({
          name, species: animalSpecies, category: enabledCategories[0] ?? "", domainProfile: {}, sex: animalSex || "unknown",
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
        <div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setBulkModal(false)}>{t("cancel")}</Button><Button type="submit" disabled={bulkBusy || enabledCategories.length === 0}>{bulkBusy ? t("loading") : t("create")}</Button></div>
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
      <form className="form-stack animal-editor" onSubmit={save}>
        <div className="animal-editor-intro">
          <span className="animal-editor-mark"><Icon name="snake" size={22} /></span>
          <div>
            <p className="animal-editor-kicker">{locale === "it" ? "SCHEDA ANIMALE" : "ANIMAL PROFILE"}</p>
            <p>{editing
              ? (locale === "it" ? "Aggiorna le informazioni dell'esemplare. Puoi modificare i dati in qualsiasi momento." : "Update this animal's information. You can edit these details at any time.")
              : (locale === "it" ? "Inserisci le informazioni principali per creare una scheda completa e riconoscibile." : "Add the key details to create a complete, easy-to-recognize animal profile.")}</p>
          </div>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}

        <section className="animal-editor-section">
          <div className="animal-editor-section-heading">
            <span className="animal-editor-section-icon"><Icon name="fingerprint" size={17} /></span>
            <div>
              <h3>{locale === "it" ? "Identità dell'animale" : "Animal identity"}</h3>
              <p>{locale === "it" ? "I dati essenziali per riconoscere l'esemplare." : "The essential details used to identify this animal."}</p>
            </div>
            <span className="animal-editor-required">{locale === "it" ? "* Obbligatorio" : "* Required"}</span>
          </div>
          <div className="form-grid">
            <Field label={locale === "it" ? "Categoria animale" : "Animal category"}><Select value={form.category} onChange={(e) => setForm((current) => ({ ...current, category: e.target.value, domainProfile: {} }))} disabled={Boolean(editing)}>{enabledCategories.map((value) => <option key={value} value={value}>{value === "dogs_cats" ? (locale === "it" ? "Cani e gatti" : "Dogs and cats") : value === "reptiles" ? (locale === "it" ? "Rettili" : "Reptiles") : value === "fish" ? (locale === "it" ? "Pesci" : "Fish") : (locale === "it" ? "Uccelli" : "Birds")}</option>)}</Select></Field>
            <Field label={t("name")}><Input required maxLength={120} placeholder={locale === "it" ? "Es. Nala" : "e.g. Nala"} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label={t("identifier")} hint={locale === "it" ? "Codice interno, microchip o numero identificativo." : "Internal code, microchip or identification number."}><Input maxLength={120} placeholder={locale === "it" ? "Es. VRQ-001" : "e.g. VRQ-001"} value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} /></Field>
            <Field label={t("species")}><Input required maxLength={160} placeholder={locale === "it" ? "Es. Python regius" : "e.g. Python regius"} value={form.species} onChange={(e) => setForm({ ...form, species: e.target.value })} /></Field>
            <Field label={t("sex")}><Select value={form.sex} onChange={(e) => setForm({ ...form, sex: e.target.value })}><option value="unknown">{t("unknown")}</option><option value="male">{t("male")}</option><option value="female">{t("female")}</option></Select></Field>
            <Field label={t("morph")} hint={locale === "it" ? "Morfologia o variante, se conosciuta." : "Morph or variant, if known."}><Input maxLength={200} placeholder={locale === "it" ? "Es. Pastel, Albino…" : "e.g. Pastel, Albino…"} value={form.morph} onChange={(e) => setForm({ ...form, morph: e.target.value })} /></Field>
            <Field label={t("location")} hint={locale === "it" ? "Rack, terrario o area di stabulazione." : "Rack, terrarium or enclosure area."}><Input maxLength={160} placeholder={locale === "it" ? "Es. Rack 03" : "e.g. Rack 03"} value={form.locationLabel} onChange={(e) => setForm({ ...form, locationLabel: e.target.value })} /></Field>
          </div>
        </section>


        <section className="animal-editor-section">
          <div className="animal-editor-section-heading">
            <span className="animal-editor-section-icon"><Icon name="settings" size={17} /></span>
            <div>
              <h3>{locale === "it" ? "Dati specifici della categoria" : "Category-specific details"}</h3>
              <p>{locale === "it" ? "Campi dedicati alla gestione di questo tipo di animale." : "Fields tailored to this animal category."}</p>
            </div>
          </div>
          <div className="form-grid">
            {form.category === "reptiles" && <>
              <Field label={locale === "it" ? "Alloggiamento / terrario" : "Enclosure"}><Input maxLength={120} value={String(form.domainProfile.enclosure ?? "")} onChange={(e) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, enclosure: e.target.value } }))} /></Field>
              <Field label={locale === "it" ? "Brumazione" : "Brumation"}><Select value={String(form.domainProfile.brumation ?? "not_applicable")} onChange={(e) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, brumation: e.target.value } }))}><option value="not_applicable">{locale === "it" ? "Non applicabile" : "Not applicable"}</option><option value="planned">{locale === "it" ? "Pianificata" : "Planned"}</option><option value="in_progress">{locale === "it" ? "In corso" : "In progress"}</option><option value="completed">{locale === "it" ? "Completata" : "Completed"}</option></Select></Field>
              <Field label={locale === "it" ? "Note alimentazione" : "Feeding notes"}><Textarea rows={2} value={String(form.domainProfile.feedingNotes ?? "")} onChange={(e) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, feedingNotes: e.target.value } }))} /></Field>
            </>}
            {form.category === "fish" && <>
              <Field label={locale === "it" ? "Tipo d'acqua" : "Water type"}><Select value={String(form.domainProfile.waterType ?? "freshwater")} onChange={(e) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, waterType: e.target.value } }))}><option value="freshwater">{locale === "it" ? "Dolce" : "Freshwater"}</option><option value="saltwater">{locale === "it" ? "Marina" : "Saltwater"}</option><option value="brackish">{locale === "it" ? "Salmastra" : "Brackish"}</option></Select></Field>
              <Field label={locale === "it" ? "Temperamento" : "Temperament"}><Input maxLength={120} value={String(form.domainProfile.temperament ?? "")} onChange={(e) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, temperament: e.target.value } }))} /></Field>
              <Field label={locale === "it" ? "Dimensione adulta (cm)" : "Adult size (cm)"}><Input type="number" min="0.1" max="500" step="0.1" value={String(form.domainProfile.maxSizeCm ?? "")} onChange={(e) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, maxSizeCm: e.target.value === "" ? "" : Number(e.target.value) } }))} /></Field>
              <Field label={locale === "it" ? "Alimentazione" : "Diet"}><Input maxLength={160} value={String(form.domainProfile.diet ?? "")} onChange={(e) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, diet: e.target.value } }))} /></Field>
              <label className="checkbox-field"><input type="checkbox" checked={Boolean(form.domainProfile.shoaling)} onChange={(e) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, shoaling: e.target.checked } }))} /><span>{locale === "it" ? "Specie gregaria" : "Shoaling species"}</span></label>
            </>}
            {form.category === "birds" && <>
              <Field label={locale === "it" ? "Numero anello" : "Ring number"}><Input maxLength={80} value={String(form.domainProfile.ringNumber ?? "")} onChange={(e) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, ringNumber: e.target.value } }))} /></Field>
              <Field label={locale === "it" ? "Alimentazione" : "Diet"}><Input maxLength={160} value={String(form.domainProfile.diet ?? "")} onChange={(e) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, diet: e.target.value } }))} /></Field>
              <Field label={locale === "it" ? "Abitudine al contatto" : "Tameness"}><Select value={String(form.domainProfile.tameness ?? "wild")} onChange={(e) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, tameness: e.target.value } }))}><option value="wild">{locale === "it" ? "Selvatico" : "Wild"}</option><option value="socialized">{locale === "it" ? "Socializzato" : "Socialized"}</option><option value="tame">{locale === "it" ? "Addomesticato" : "Tame"}</option></Select></Field>
              <Field label={locale === "it" ? "Capacità di volo" : "Flight status"}><Select value={String(form.domainProfile.flightStatus ?? "unknown")} onChange={(e) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, flightStatus: e.target.value } }))}><option value="unknown">{locale === "it" ? "Non noto" : "Unknown"}</option><option value="full_flight">{locale === "it" ? "Volo completo" : "Full flight"}</option><option value="clipped">{locale === "it" ? "Remiganti accorciate" : "Clipped"}</option></Select></Field>
            </>}
            {form.category === "dogs_cats" && <>
              <Field label={locale === "it" ? "Razza" : "Breed"}><Input maxLength={160} value={String(form.domainProfile.breed ?? "")} onChange={(e) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, breed: e.target.value } }))} /></Field>
              <Field label={locale === "it" ? "Microchip" : "Microchip"}><Input maxLength={40} value={String(form.domainProfile.microchip ?? "")} onChange={(e) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, microchip: e.target.value } }))} /></Field>
              <Field label={locale === "it" ? "Colore mantello" : "Coat colour"}><Input maxLength={120} value={String(form.domainProfile.coatColor ?? "")} onChange={(e) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, coatColor: e.target.value } }))} /></Field>
              <Field label={locale === "it" ? "Peso (kg)" : "Weight (kg)"}><Input type="number" min="0.01" max="250" step="0.01" value={String(form.domainProfile.weightKg ?? "")} onChange={(e) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, weightKg: e.target.value === "" ? "" : Number(e.target.value) } }))} /></Field>
              <Field label={locale === "it" ? "Vaccinazioni" : "Vaccination status"}><Select value={String(form.domainProfile.vaccinationStatus ?? "unknown")} onChange={(e) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, vaccinationStatus: e.target.value } }))}><option value="unknown">{locale === "it" ? "Non noto" : "Unknown"}</option><option value="not_up_to_date">{locale === "it" ? "Da aggiornare" : "Not up to date"}</option><option value="up_to_date">{locale === "it" ? "In regola" : "Up to date"}</option></Select></Field>
              <label className="checkbox-field"><input type="checkbox" checked={Boolean(form.domainProfile.sterilized)} onChange={(e) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, sterilized: e.target.checked } }))} /><span>{locale === "it" ? "Sterilizzato" : "Neutered / spayed"}</span></label>
            </>}
          </div>
        </section>

        <section className="animal-editor-section animal-editor-genealogy">
          <div className="animal-editor-section-heading">
            <span className="animal-editor-section-icon"><Icon name="git-branch" size={17} /></span>
            <div>
              <h3>{locale === "it" ? "Genealogia e genitori" : "Pedigree and parents"}</h3>
              <p>{locale === "it" ? "Collega genitori già presenti oppure annota quelli esterni alla piattaforma." : "Link existing parents or record parents outside the platform."}</p>
            </div>
            <span className="animal-editor-optional">{locale === "it" ? "Facoltativa" : "Optional"}</span>
          </div>
          <div className="animal-editor-parent-grid">
            <div className="animal-editor-parent-card">
              <div className="animal-editor-parent-title"><span className="animal-editor-parent-symbol">♀</span><div><strong>{locale === "it" ? "Madre" : "Mother"}</strong><small>{locale === "it" ? "Femmina" : "Female"}</small></div></div>
              <RemoteSelect label={locale === "it" ? "Seleziona dalla piattaforma" : "Select from platform"} value={form.motherAnimalId} onChange={(value) => setForm((current) => ({ ...current, motherAnimalId: value, motherDescription: value ? "" : current.motherDescription }))} endpoint="/animals" responseKey="animals" secondaryKey="species" filters={{ status: "all", sex: "female", sort: "name" }} detailEndpoint={(id) => `/animals/${encodeURIComponent(id)}`} detailKey="animal" locale={locale} />
              <Field label={locale === "it" ? "Oppure nome e morph esterni" : "Or external name and morph"}><Input maxLength={240} placeholder={locale === "it" ? "Es. Luna · Pastel het Clown" : "e.g. Luna · Pastel het Clown"} value={form.motherDescription} onChange={(e) => setForm((current) => ({ ...current, motherDescription: e.target.value, motherAnimalId: "" }))} /></Field>
            </div>
            <div className="animal-editor-parent-card">
              <div className="animal-editor-parent-title"><span className="animal-editor-parent-symbol">♂</span><div><strong>{locale === "it" ? "Padre" : "Father"}</strong><small>{locale === "it" ? "Maschio" : "Male"}</small></div></div>
              <RemoteSelect label={locale === "it" ? "Seleziona dalla piattaforma" : "Select from platform"} value={form.fatherAnimalId} onChange={(value) => setForm((current) => ({ ...current, fatherAnimalId: value, fatherDescription: value ? "" : current.fatherDescription }))} endpoint="/animals" responseKey="animals" secondaryKey="species" filters={{ status: "all", sex: "male", sort: "name" }} detailEndpoint={(id) => `/animals/${encodeURIComponent(id)}`} detailKey="animal" locale={locale} />
              <Field label={locale === "it" ? "Oppure nome e morph esterni" : "Or external name and morph"}><Input maxLength={240} placeholder={locale === "it" ? "Es. Thor · Banana Pied" : "e.g. Thor · Banana Pied"} value={form.fatherDescription} onChange={(e) => setForm((current) => ({ ...current, fatherDescription: e.target.value, fatherAnimalId: "" }))} /></Field>
            </div>
          </div>
          <p className="animal-editor-genealogy-hint">{locale === "it" ? "Se selezioni un genitore registrato, il collegamento alla sua scheda viene salvato. Il testo manuale serve per genitori non presenti in Vivarqo." : "Selecting a registered parent saves a link to its profile. Manual text is for parents not registered in Vivarqo."}</p>
        </section>

        <section className="animal-editor-section">
          <div className="animal-editor-section-heading">
            <span className="animal-editor-section-icon"><Icon name="camera" size={17} /></span>
            <div>
              <h3>{locale === "it" ? "Fotografia" : "Photograph"}</h3>
              <p>{locale === "it" ? "Aggiungi un'immagine per riconoscere subito l'esemplare." : "Add an image to recognize the animal at a glance."}</p>
            </div>
            <span className="animal-editor-optional">{locale === "it" ? "Facoltativa" : "Optional"}</span>
          </div>
          <div className="animal-editor-photo">
            {editing?.photoUrl
              ? <img src={editing.photoUrl} alt={t("animalPhoto")} />
              : <span className="animal-editor-photo-placeholder"><Icon name="image" size={23} /></span>}
            <div className="animal-editor-photo-copy">
              <strong>{photoFile ? photoFile.name : (locale === "it" ? "Nessuna nuova immagine selezionata" : "No new image selected")}</strong>
              <span>{locale === "it" ? "JPG, PNG o WebP · massimo 5 MB" : "JPG, PNG or WebP · 5 MB maximum"}</span>
              <Field label={locale === "it" ? "Fotografia" : "Photograph"}><Input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => selectPhoto(e.target.files?.[0] ?? null)} /></Field>
            </div>
            {editing?.photoUrl && <Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => void removePhoto()}>{t("removePhoto")}</Button>}
          </div>
          <p className="animal-editor-photo-hint">{t("animalPhotoHint")}</p>
        </section>

        <section className="animal-editor-section">
          <div className="animal-editor-section-heading">
            <span className="animal-editor-section-icon"><Icon name="calendar-days" size={17} /></span>
            <div>
              <h3>{locale === "it" ? "Date e provenienza" : "Dates and origin"}</h3>
              <p>{locale === "it" ? "Tieni traccia della nascita, dell'ingresso in allevamento e dell'origine." : "Track birth, acquisition and the animal's origin."}</p>
            </div>
            <span className="animal-editor-optional">{locale === "it" ? "Facoltativo" : "Optional"}</span>
          </div>
          <div className="form-grid">
            <Field label={t("birthDate")}><Input type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} /></Field>
            <Field label={t("acquiredDate")}><Input type="date" value={form.acquiredDate} onChange={(e) => setForm({ ...form, acquiredDate: e.target.value })} /></Field>
            <Field label={t("previousBreeder")}><Input placeholder={locale === "it" ? "Nome dell'allevatore" : "Breeder name"} value={form.previousBreeder} onChange={(e) => setForm({ ...form, previousBreeder: e.target.value })} /></Field>
            {editing && <Field label={t("status")}><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{["active", "sold", "transferred", "deceased"].map((value) => <option value={value} key={value}>{t(`animalStatus_${value}`)}</option>)}</Select></Field>}
          </div>
          <label className="checkbox-field animal-editor-estimated"><input type="checkbox" checked={form.birthDateEstimated} onChange={(e) => setForm({ ...form, birthDateEstimated: e.target.checked })} />{t("estimatedDate")}</label>
          <Field label={t("origin")} hint={locale === "it" ? "Ad esempio: nato in allevamento, acquistato o ceduto." : "For example: captive-bred, purchased or transferred."}><Textarea rows={2} value={form.originDescription} onChange={(e) => setForm({ ...form, originDescription: e.target.value })} /></Field>
        </section>

        <section className="animal-editor-section">
          <div className="animal-editor-section-heading">
            <span className="animal-editor-section-icon"><Icon name="notebook-pen" size={17} /></span>
            <div>
              <h3>{locale === "it" ? "Genetica e annotazioni" : "Genetics and notes"}</h3>
              <p>{locale === "it" ? "Conserva dettagli utili per la gestione futura." : "Keep useful details for future care and management."}</p>
            </div>
            <span className="animal-editor-optional">{locale === "it" ? "Facoltativo" : "Optional"}</span>
          </div>
          <Field label={t("geneticsNotes")}><Textarea rows={2} placeholder={locale === "it" ? "Genetica conosciuta, accoppiamenti, test…" : "Known genetics, pairings, tests…"} value={form.geneticsNotes} onChange={(e) => setForm({ ...form, geneticsNotes: e.target.value })} /></Field>
          <Field label={t("animalNotes")}><Textarea rows={3} placeholder={locale === "it" ? "Note generali sull'esemplare…" : "General notes about this animal…"} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </section>

        <div className="animal-editor-footer-note">{locale === "it" ? "I campi contrassegnati con * sono obbligatori. Tutti gli altri dettagli possono essere aggiunti o aggiornati in seguito." : "Fields marked with * are required. All other details can be added or updated later."}</div>
        <div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setModal(false)}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{busy ? t("loading") : t("save")}</Button></div>
      </form>
    </Modal>}
    {toast}
  </div>;
}