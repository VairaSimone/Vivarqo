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

type CompanionType = "dog" | "cat";

function getCompanionType(species: string, profile: Record<string, unknown>): CompanionType {
  if (profile.animalType === "dog" || profile.animalType === "cat") return profile.animalType;
  return /felis|gatt|cat/i.test(species) ? "cat" : "dog";
}

function getCompanionSpecies(type: CompanionType): string {
  return type === "cat" ? "Felis catus" : "Canis lupus familiaris";
}

const animalDomainProfileKeys: Record<string, readonly string[]> = {"reptiles":["enclosure","brumation","feedingNotes"],"fish":["aquariumId","waterType","temperament","maxSizeCm","shoaling","diet"],"birds":["aviaryId","diet","tameness","flightStatus"],"dogs_cats":["animalType","breed","microchip","veterinarianName","veterinaryClinic","veterinaryPhone","veterinaryEmail","veterinaryAddress","allergies","chronicConditions","sterilized","vaccinationStatus","coatColor","indoorOutdoor","activityLevel","weightKg"]};

const animalCategoryCards: Array<{
  key: string;
  category: string;
  animalType?: CompanionType;
  emoji: string;
  title: { it: string; en: string };
  description: { it: string; en: string };
}> = [
  { key: "reptiles", category: "reptiles", emoji: "🐍", title: { it: "Rettili", en: "Reptiles" }, description: { it: "Serpenti, sauri, tartarughe e altre specie.", en: "Snakes, lizards, turtles and other reptiles." } },
  { key: "birds", category: "birds", emoji: "🐦", title: { it: "Uccelli", en: "Birds" }, description: { it: "Pappagalli, piccoli uccelli e altre specie.", en: "Parrots, small birds and other species." } },
  { key: "fish", category: "fish", emoji: "🐠", title: { it: "Pesci", en: "Fish" }, description: { it: "Pesci ornamentali e specie acquatiche.", en: "Ornamental fish and aquatic species." } },
  { key: "dog", category: "dogs_cats", animalType: "dog", emoji: "🐕", title: { it: "Cani", en: "Dogs" }, description: { it: "Cani domestici.", en: "Domestic dogs." } },
  { key: "cat", category: "dogs_cats", animalType: "cat", emoji: "🐈", title: { it: "Gatti", en: "Cats" }, description: { it: "Gatti domestici.", en: "Domestic cats." } },
];

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
  const [bulkDefaultCategory, setBulkDefaultCategory] = useState("");
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
  const [selectedAnimalCategories, setSelectedAnimalCategories] = useState<Record<string, string>>({});
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
  const [wizardStep, setWizardStep] = useState<0 | 1 | 2>(0);
  const [wizardStepError, setWizardStepError] = useState("");
  const [initialWeight, setInitialWeight] = useState("");
  const [initialWeightDate, setInitialWeightDate] = useState(todayDate());
  const [initialWeightSaved, setInitialWeightSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { toast, show } = useToast();
  const isCompanion = form.category === "dogs_cats";
  const companionType: CompanionType = form.domainProfile.animalType === "cat" ? "cat" : "dog";
  const selectedCategoryCard = animalCategoryCards.find((card) =>
    card.category === form.category && (!card.animalType || card.animalType === companionType),
  );

  function selectAnimalCategory(category: string, animalType?: CompanionType) {
    setForm((current) => ({
      ...current,
      category,
      species: category === "dogs_cats" ? getCompanionSpecies(animalType ?? "dog") : "",
      domainProfile: category === "dogs_cats" ? { animalType: animalType ?? "dog" } : {},
      morph: "",
      geneticsNotes: "",
      motherAnimalId: "",
      fatherAnimalId: "",
      motherDescription: "",
      fatherDescription: "",
      locationLabel: "",
    }));
    setInitialWeight("");
    setInitialWeightDate(todayDate());
    setInitialWeightSaved(false);
    setWizardStepError("");
  }

  useEffect(() => {
    let active = true;
    // The active workspace, not the collaborator's personal account, defines
    // which animal categories are available in this view.
    api.get<{ categories: string[] }>("/collaborators/context")
      .then((context) => {
        if (!active) return;
        const categories = context.categories.filter((value) => ["reptiles", "fish", "birds", "dogs_cats"].includes(value));
        setEnabledCategories(categories);
        setBulkDefaultCategory((current) => current && categories.includes(current) ? current : categories[0] ?? "");
        setCategory((current) => current && categories.includes(current) ? current : "");
        setForm((current) => {
          const nextCategory = current.category && categories.includes(current.category) ? current.category : categories[0] ?? "";
          if (nextCategory === "dogs_cats" && !current.domainProfile.animalType) {
            return { ...current, category: nextCategory, species: current.species || getCompanionSpecies("dog"), domainProfile: { ...current.domainProfile, animalType: "dog" } };
          }
          return { ...current, category: nextCategory };
        });
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
  const selectableAnimals = animals.filter((animal) => animal.status === "active");
  const allVisibleAnimalsSelected = selectableAnimals.length > 0 && selectableAnimals.every((animal) => selectedAnimalIds.includes(animal.id));
  const canBulkShed = selectedAnimalIds.length > 0 && selectedAnimalIds.every((id) => selectedAnimalCategories[id] === "reptiles");

  useEffect(() => {
    if (!canBulkShed) setBulkCareKind("weight");
  }, [canBulkShed]);
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

  function openCreate() {
    setEditing(null);
    const initialCategory = enabledCategories[0] ?? "";
    setForm({
      ...emptyAnimal,
      category: initialCategory,
      species: initialCategory === "dogs_cats" ? getCompanionSpecies("dog") : "",
      domainProfile: initialCategory === "dogs_cats" ? { animalType: "dog" } : {},
    });
    setPhotoFile(null);
    setWizardStep(0);
    setWizardStepError("");
    setInitialWeight("");
    setInitialWeightDate(todayDate());
    setInitialWeightSaved(false);
    setError("");
    setModal(true);
  }
  function openEdit(animal: AnimalDto) {
    setEditing(animal);
    setPhotoFile(null);
    const animalWithDomain = animal as AnimalDto & { category?: string; domainProfile?: Record<string, unknown> | null };
    const animalCategory = animalWithDomain.category ?? "reptiles";
    const domainProfile = { ...(animalWithDomain.domainProfile ?? {}) };
    // Bird identifiers now live only in BirdProfile. Strip the old JSON field
    // before submitting the full domainProfile during edits of legacy animals.
    if (animalCategory === "birds") delete domainProfile.ringNumber;
    if (animalCategory === "dogs_cats") {
      domainProfile.animalType = getCompanionType(getString(animal, "species"), domainProfile);
    }
    setWizardStep(0);
    setWizardStepError("");
    setInitialWeight("");
    setInitialWeightDate(todayDate());
    setInitialWeightSaved(false);
    setForm({
      name: getString(animal, "name"), identifier: getString(animal, "identifier"),
      species: getString(animal, "species") || (animalCategory === "dogs_cats" ? getCompanionSpecies(getCompanionType("", domainProfile)) : ""),
      category: animalCategory, domainProfile,
      sex: getString(animal, "sex", "unknown"), morph: getString(animal, "morph"), motherAnimalId: getString(animal, "motherAnimalId"), fatherAnimalId: getString(animal, "fatherAnimalId"), motherDescription: getString(animal, "motherDescription"), fatherDescription: getString(animal, "fatherDescription"), geneticsNotes: getString(animal, "geneticsNotes"),
      birthDate: dateForInput(getString(animal, "birthDate") || null), birthDateEstimated: Boolean(animal.birthDateEstimated),
      acquiredDate: dateForInput(getString(animal, "acquiredDate") || null), originDescription: getString(animal, "originDescription"),
      previousBreeder: getString(animal, "previousBreeder"), locationLabel: getString(animal, "locationLabel"),
      status: getString(animal, "status", "active"), notes: getString(animal, "notes")
    });
    setError(""); setModal(true);
  }

  function validateWizardStep(step: 0 | 1 | 2): boolean {
    const fail = (message: string) => {
      setWizardStepError(message);
      return false;
    };
    setWizardStepError("");

    if (step === 0) {
      if (!form.name.trim()) return fail(locale === "it" ? "Inserisci il nome dell'animale." : "Enter the animal's name.");
      if (!form.category || !enabledCategories.includes(form.category)) {
        return fail(locale === "it" ? "Seleziona una categoria abilitata nel tuo account." : "Choose a category enabled for your account.");
      }
      if (form.category !== "dogs_cats" && !form.species.trim()) {
        return fail(locale === "it" ? "La specie è obbligatoria per questa categoria." : "Species is required for this category.");
      }
    }

    if (step === 1) {
      if (initialWeight.trim()) {
        let grams = 0;
        try { grams = weightToGrams(initialWeight); }
        catch { return fail(locale === "it" ? "Inserisci un peso numerico valido." : "Enter a valid numeric weight."); }
        if (!Number.isFinite(grams) || grams <= 0 || grams > 100_000_000) {
          return fail(locale === "it" ? "Il peso deve essere un numero maggiore di zero e in un intervallo valido." : "Weight must be greater than zero and within the supported range.");
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(initialWeightDate)) {
          return fail(locale === "it" ? "Inserisci una data valida per la pesatura." : "Enter a valid weighing date.");
        }
      }
      if (form.category === "fish" && form.domainProfile.maxSizeCm !== undefined && form.domainProfile.maxSizeCm !== "") {
        const size = Number(form.domainProfile.maxSizeCm);
        if (!Number.isFinite(size) || size <= 0 || size > 500) {
          return fail(locale === "it" ? "La dimensione adulta deve essere compresa tra 0 e 500 cm." : "Adult size must be between 0 and 500 cm.");
        }
      }
      if (form.category === "dogs_cats" && form.domainProfile.weightKg !== undefined && form.domainProfile.weightKg !== "") {
        const weight = Number(form.domainProfile.weightKg);
        if (!Number.isFinite(weight) || weight <= 0 || weight > 250) {
          return fail(locale === "it" ? "Il peso deve essere compreso tra 0 e 250 kg." : "Weight must be between 0 and 250 kg.");
        }
      }
    }

    if (step === 2) {
      if (form.motherAnimalId && form.motherAnimalId === form.fatherAnimalId) {
        return fail(locale === "it" ? "Lo stesso animale non può essere selezionato come entrambi i genitori." : "The same animal cannot be selected as both parents.");
      }
      const veterinaryEmail = String(form.domainProfile.veterinaryEmail ?? "").trim();
      if (veterinaryEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(veterinaryEmail)) {
        return fail(locale === "it" ? "L'indirizzo email del veterinario non è valido." : "The veterinarian email address is invalid.");
      }
    }
    return true;
  }

  function validateAllWizardSteps(): boolean {
    for (const step of [0, 1, 2] as const) {
      if (!validateWizardStep(step)) {
        setWizardStep(step);
        return false;
      }
    }
    return true;
  }

  function goToNextWizardStep() {
    if (!validateWizardStep(wizardStep)) return;
    if (wizardStep < 2) setWizardStep((current) => (current + 1) as 1 | 2);
  }

  function handleWizardSubmit(event: FormEvent) {
    event.preventDefault();
    if (wizardStep < 2) goToNextWizardStep();
    else void save();
  }

  async function save() {
    if (!validateAllWizardSteps()) return;
    const allowedProfileKeys = new Set(animalDomainProfileKeys[form.category] ?? []);
    const cleanDomainProfile = Object.fromEntries(
      Object.entries(form.domainProfile).filter(([key, value]) => allowedProfileKeys.has(key) && value !== "" && value !== null && value !== undefined),
    );
    const profilePatch = Object.fromEntries(
      Object.entries(form.domainProfile).filter(([key]) => allowedProfileKeys.has(key))
        .map(([key, value]) => [key, value === "" ? null : value]),
    );
    setBusy(true);
    setError("");
    const body = {
      ...form,
      domainProfile: editing ? (Object.keys(profilePatch).length ? profilePatch : undefined) : cleanDomainProfile,
      identifier: form.identifier || null,
      morph: form.category === "reptiles" ? (form.morph || null) : undefined,
      motherAnimalId: form.motherAnimalId || null, fatherAnimalId: form.fatherAnimalId || null,
      motherDescription: form.motherDescription || null, fatherDescription: form.fatherDescription || null,
      geneticsNotes: form.geneticsNotes || null, birthDate: form.birthDate || null,
      acquiredDate: form.acquiredDate || null, originDescription: form.originDescription || null,
      previousBreeder: form.previousBreeder || null, locationLabel: form.locationLabel || null,
      status: form.status === "archived" ? undefined : form.status,
      notes: form.notes || null
    };
    let targetAnimal = editing;
    try {
      if (editing) {
        await api.patch("/animals/" + getString(editing, "id"), body);
      } else {
        const created = await api.post<{ animal: AnimalDto }>("/animals", body);
        targetAnimal = created.animal;
        // Keep the created id when a subsequent photo upload needs to be retried.
        setEditing(created.animal);
      }
      if (initialWeight.trim() && !initialWeightSaved && targetAnimal) {
        await api.post("/animals/" + getString(targetAnimal, "id") + "/weights", {
          measuredAt: new Date(initialWeightDate + "T12:00:00").toISOString(),
          weightG: weightToGrams(initialWeight),
        });
        setInitialWeightSaved(true);
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

  function updateAnimalSelection(animal: AnimalDto, checked: boolean) {
    if (checked) {
      setSelectedAnimalIds((current) => current.includes(animal.id) ? current : [...current, animal.id]);
      setSelectedAnimalCategories((current) => ({ ...current, [animal.id]: animal.category }));
      return;
    }
    setSelectedAnimalIds((current) => current.filter((id) => id !== animal.id));
    setSelectedAnimalCategories((current) => {
      const next = { ...current };
      delete next[animal.id];
      return next;
    });
  }

  function updatePageSelection(checked: boolean) {
    const pageIds = new Set(selectableAnimals.map((animal) => animal.id));
    setSelectedAnimalIds((current) => checked
      ? [...new Set([...current, ...pageIds])]
      : current.filter((id) => !pageIds.has(id)));
    setSelectedAnimalCategories((current) => {
      const next = { ...current };
      for (const animal of selectableAnimals) {
        if (checked) next[animal.id] = animal.category;
        else delete next[animal.id];
      }
      return next;
    });
  }

  async function updateStatus(animal: AnimalDto, action: "archive" | "restore" | "delete") {
    const label = action === "archive" ? t("confirmArchive") : t("confirmDelete");
    if (!window.confirm(label)) return;
    try {
      if (action === "delete") await api.delete(`/animals/${getString(animal, "id")}`);
      else await api.post(`/animals/${getString(animal, "id")}/${action}`);
      resource.reload();
      if (action === "archive" || action === "delete") updateAnimalSelection(animal, false);
      show(action === "archive" ? t("animalArchived") : action === "restore" ? t("animalRestored") : t("animalDeleted"));
    } catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }

  const showMorphColumn = animals.some((animal) => animal.category === "reptiles");

  const rows = animals.map((animal) => {
    const id = animal.id;
    return [
      <input
        type="checkbox"
        aria-label={locale === "it" ? `Seleziona ${animal.name}` : `Select ${animal.name}`}
        checked={selectedAnimalIds.includes(id)}
        disabled={animal.status !== "active"}
        onChange={(event) => updateAnimalSelection(animal, event.target.checked)}
      />,
      <button className="animal-name-cell" onClick={() => navigate(`/animals/${id}`)}><span className="animal-avatar">{getString(animal, "photoUrl") ? <img className="animal-avatar-image" src={getString(animal, "photoUrl")} alt="" loading="lazy" /> : <Icon name="snake" size={16} />}</span><span><strong>{getString(animal, "name")}</strong><small>{getString(animal, "identifier") || getString(animal, "species")}</small></span></button>,
      <span>{getString(animal, "species")}</span>,
      ...(showMorphColumn ? [<span>{animal.category === "reptiles" ? (getString(animal, "morph") || "—") : "—"}</span>] : []),
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
        {(!category || category === "reptiles") && <Input aria-label={t("morph")} placeholder={t("morph")} value={morph} onChange={(e) => { setMorph(e.target.value); setPage(1); }} />}
        <Input aria-label={t("location")} placeholder={t("location")} value={location} onChange={(e) => { setLocation(e.target.value); setPage(1); }} />
        <Select aria-label={t("sort")} value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}><option value="updatedAt">{t("recentlyUpdated")}</option><option value="createdAt">{t("recentlyCreated")}</option><option value="name">{t("name")}</option></Select></>}
        activeFilterCount={[q, category, status !== "active" ? status : "", sex, species, morph, location].filter(Boolean).length}
        onClearFilters={() => { setSearch(""); setQ(""); setCategory(""); setStatus("active"); setSex(""); setSpecies(""); setMorph(""); setLocation(""); setSort("updatedAt"); setPage(1); }}
        resultCount={pager?.total ?? 0} onRefresh={resource.reload} loading={resource.loading} />
      {animals.length > 0 && <label className="checkbox-field animal-select-page">
        <input type="checkbox" checked={allVisibleAnimalsSelected} disabled={selectableAnimals.length === 0} onChange={(event) => updatePageSelection(event.target.checked)} />
        {locale === "it"
          ? `Seleziona tutti gli animali attivi in questa pagina (${selectableAnimals.length})`
          : `Select all active animals on this page (${selectableAnimals.length})`}
      </label>}
      {resource.loading && !resource.data ? <LoadingState /> : resource.error ? <ErrorState message={resource.error.message} retry={resource.reload} /> :
        rows.length === 0 && (pager?.total ?? 0) === 0 && !q && !species && !morph && !location && !sex && status === "active"
          ? <EmptyState title={locale === "it" ? "Non hai ancora aggiunto animali" : "You haven't added any animals yet"} description={locale === "it" ? "Crea la scheda del primo esemplare oppure importa la tua collezione da Excel per iniziare a gestire alimentazioni, pesi e mute." : "Create your first animal profile or import your collection from Excel to start tracking feedings, weights and sheds."} action={<Button onClick={openCreate} disabled={enabledCategories.length === 0}><Icon name="plus" size={15} />{t("animalNew")}</Button>} />
          : <DataTable headers={[locale === "it" ? "Seleziona" : "Select", t("name"), t("species"), ...(showMorphColumn ? [t("morph")] : []), t("sex"), t("location"), t("status"), t("actions")]} rows={rows} empty={t("noAnimals")} />}
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
          setSelectedAnimalCategories({});
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
        <Field label={locale === "it" ? "Tipo di registrazione" : "Record type"}><Select value={bulkCareKind} onChange={(event) => setBulkCareKind(event.target.value as "weight" | "shed")}><option value="weight">{locale === "it" ? "Pesatura" : "Weight"}</option>{canBulkShed && <option value="shed">{locale === "it" ? "Muta" : "Shed"}</option>}</Select></Field>
        <Field label={locale === "it" ? "Data" : "Date"}><Input type="date" required value={bulkCareDate} onChange={(event) => setBulkCareDate(event.target.value)} /></Field>
        {bulkCareKind === "weight" ? <Field label={`${t("weight")} (${weightUnitLabel()})`}><Input type="number" min="0.01" max="100000000" step="0.01" required value={bulkCareWeight} onChange={(event) => setBulkCareWeight(event.target.value)} /></Field> : <Field label={locale === "it" ? "Esito muta" : "Shed outcome"}><Select value={bulkCareOutcome} onChange={(event) => setBulkCareOutcome(event.target.value)}><option value="complete">{locale === "it" ? "Completa" : "Complete"}</option><option value="partial">{locale === "it" ? "Parziale" : "Partial"}</option><option value="unknown">{locale === "it" ? "Non noto" : "Unknown"}</option></Select></Field>}
        <Field label={t("notes")}><Textarea rows={2} value={bulkCareNotes} onChange={(event) => setBulkCareNotes(event.target.value)} /></Field>
        <div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setBulkCareModal(false)} disabled={bulkCareBusy}>{t("cancel")}</Button><Button type="submit" disabled={bulkCareBusy || selectedAnimalIds.length === 0 || (bulkCareKind === "weight" && !bulkCareWeight)}>{bulkCareBusy ? t("loading") : (locale === "it" ? "Registra" : "Save records")}</Button></div>
      </form>
    </Modal>}
    {bulkModal && <Modal title={t("bulkCreateAnimals")} onClose={() => setBulkModal(false)} wide>
      <form className="form-stack" onSubmit={async (event) => {
        event.preventDefault(); setBulkBusy(true); setBulkError("");
        const categoryByToken: Record<string, string> = {
          reptiles: "reptiles", rettili: "reptiles", fish: "fish", pesci: "fish",
          birds: "birds", uccelli: "birds", dogscats: "dogs_cats", caniegatti: "dogs_cats",
          "dogscats:dog": "dogs_cats:dog", cane: "dogs_cats:dog", cani: "dogs_cats:dog",
          "dogscats:cat": "dogs_cats:cat", gatto: "dogs_cats:cat", gatti: "dogs_cats:cat",
        };
        const normalizeToken = (value: string) => value.trim().toLocaleLowerCase("it-IT").replace(/[\s_-]+/g, "");
        const parsed = bulkText.split("\n").map((line) => line.trim()).filter(Boolean)
          .map((line) => line.split("|").map((value) => value.trim()));
        const parsedAnimals: Array<Record<string, unknown>> = [];
        const invalidRow = parsed.findIndex((parts) => {
          if (parts.length < 2 || parts.length > 7 || !parts[0]) return true;
          const categoryToken = categoryByToken[normalizeToken(parts[2] ?? "")];
          const hasCategory = Boolean(categoryToken);
          const selectedCategory = hasCategory ? categoryToken! : bulkDefaultCategory;
          const rowCategory = selectedCategory.startsWith("dogs_cats:") ? "dogs_cats" : selectedCategory;
          if (!enabledCategories.includes(rowCategory)) return true;

          const sex = hasCategory ? (parts[3] ?? "") : (parts[2] ?? "");
          const morph = hasCategory ? (parts[4] ?? "") : (parts[3] ?? "");
          const identifier = hasCategory ? (parts[5] ?? "") : (parts[4] ?? "");
          const profileJson = hasCategory ? (parts[6] ?? "") : (parts[5] ?? "");
          if (sex && !["male", "female", "unknown", "maschio", "femmina", "sconosciuto"].includes(normalizeToken(sex))) return true;

          let parsedProfile: unknown = {};
          if (profileJson) {
            try { parsedProfile = JSON.parse(profileJson) as unknown; }
            catch { return true; }
            if (typeof parsedProfile !== "object" || parsedProfile === null || Array.isArray(parsedProfile)) return true;
          }
          const domainProfile = { ...(parsedProfile as Record<string, unknown>) };
          let animalType: "dog" | "cat" | undefined;
          if (selectedCategory === "dogs_cats:dog") animalType = "dog";
          else if (selectedCategory === "dogs_cats:cat") animalType = "cat";
          else if (rowCategory === "dogs_cats") {
            if (domainProfile.animalType === "dog" || domainProfile.animalType === "cat") animalType = domainProfile.animalType;
            else if (domainProfile.animalType === undefined || domainProfile.animalType === "") {
              const speciesText = parts[1] ?? "";
              animalType = /felis|gatt|\bcat\b/i.test(speciesText) ? "cat"
                : /canis|cane|\bdog\b/i.test(speciesText) ? "dog" : "dog";
            }
          }
          if (animalType) domainProfile.animalType = animalType;
          const species = parts[1] || (rowCategory === "dogs_cats"
            ? (animalType === "cat" ? "Felis catus" : "Canis lupus familiaris")
            : "");
          if (!species) return true;
          parsedAnimals.push({
            name: parts[0], species, category: rowCategory, domainProfile,
            sex: normalizeToken(sex) === "maschio" ? "male" : normalizeToken(sex) === "femmina" ? "female" : (sex || "unknown"),
            morph: morph || null, identifier: identifier || null,
          });
          return false;
        });
        if (invalidRow >= 0) {
          setBulkError(locale === "it"
            ? `Riga ${invalidRow + 1} non valida: controlla nome, specie, categoria abilitata, sesso e JSON facoltativo del profilo.`
            : `Row ${invalidRow + 1} is invalid: check name, species, enabled category, sex and optional profile JSON.`);
          setBulkBusy(false);
          return;
        }
        const payload = parsedAnimals;
        try {
          await api.post("/animals/bulk", { animals: payload });
          setBulkModal(false); setBulkText(""); resource.reload(); show(t("bulkAnimalsCreated", { count: payload.length }));
        } catch (reason) { setBulkError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
        finally { setBulkBusy(false); }
      }}>
        {bulkError && <Alert tone="danger">{bulkError}</Alert>}
        <Field label={locale === "it" ? "Categoria predefinita per il formato storico" : "Default category for legacy rows"}>
          <Select value={bulkDefaultCategory} onChange={(e) => setBulkDefaultCategory(e.target.value)}>
            {enabledCategories.map((value) => <option key={value} value={value}>{value === "dogs_cats" ? (locale === "it" ? "Cani e gatti" : "Dogs and cats") : value === "reptiles" ? (locale === "it" ? "Rettili" : "Reptiles") : value === "fish" ? (locale === "it" ? "Pesci" : "Fish") : (locale === "it" ? "Uccelli" : "Birds")}</option>)}
          </Select>
        </Field>
        <Field
          label={t("bulkAnimalRows")}
          hint={locale === "it"
            ? "Senza categoria: nome | specie | sesso | morph | identificativo | {JSON profilo facoltativo}. Con categoria: nome | specie | categoria | sesso | morph | identificativo | {JSON profilo facoltativo}. Identificativo e JSON possono essere omessi."
            : "Without category: name | species | sex | morph | identifier | {optional profile JSON}. With category: name | species | category | sex | morph | identifier | {optional profile JSON}. Identifier and JSON can be omitted."}
        >
          <Textarea required rows={8} value={bulkText} onChange={(e) => setBulkText(e.target.value)} placeholder='Nala | Python regius | reptiles | female | Pastel | A-001 | {"enclosure":"Terrario 1"}' />
        </Field>
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
      <form className="form-stack animal-editor animal-wizard" onSubmit={handleWizardSubmit}>
        <div className="animal-editor-intro animal-wizard-intro">
          <span className="animal-editor-mark"><Icon name="snake" size={22} /></span>
          <div>
            <p className="animal-editor-kicker">{locale === "it" ? "NUOVO ANIMALE" : "NEW ANIMAL"}</p>
            <p>{editing
              ? (locale === "it" ? "Modifica la scheda seguendo i tre passaggi. La categoria dell'animale esistente resta bloccata." : "Update the profile across three steps. The existing animal category stays locked.")
              : (locale === "it" ? "Crea una scheda ordinata. Puoi aggiungere i dettagli adesso oppure completarli in seguito." : "Create a structured profile. Add details now or complete them later.")}</p>
          </div>
        </div>

        <nav className="animal-wizard-progress" aria-label={locale === "it" ? "Passaggi della procedura" : "Wizard steps"}>
          {[
            { number: "01", title: locale === "it" ? "Identità" : "Identity", description: locale === "it" ? "Riconoscimento" : "Identification" },
            { number: "02", title: locale === "it" ? "Gestione" : "Management", description: locale === "it" ? "Posizione e cura" : "Housing and care" },
            { number: "03", title: locale === "it" ? "Dettagli" : "Details", description: locale === "it" ? "Origine e note" : "Origin and notes" },
          ].map((item, index) => <div key={item.number} className={"animal-wizard-progress-step" + (wizardStep === index ? " current" : wizardStep > index ? " complete" : "")} aria-current={wizardStep === index ? "step" : undefined}>
            <span className="animal-wizard-progress-number">{wizardStep > index ? <Icon name="check" size={14} /> : item.number}</span>
            <span className="animal-wizard-progress-copy"><strong>{item.title}</strong><small>{item.description}</small></span>
          </div>)}
        </nav>

        {error && <Alert tone="danger">{error}</Alert>}
        {wizardStepError && <Alert tone="danger">{wizardStepError}</Alert>}

        {wizardStep === 0 && <>
          <section className="animal-editor-section animal-wizard-section">
            <div className="animal-editor-section-heading">
              <span className="animal-editor-section-icon"><Icon name="fingerprint" size={17} /></span>
              <div>
                <h3>{locale === "it" ? "Identificazione dell'animale" : "Animal identification"}</h3>
                <p>{locale === "it" ? "Seleziona la categoria, poi inserisci i dati essenziali dell'esemplare." : "Choose the category, then enter the animal's essential details."}</p>
              </div>
              <span className="animal-editor-required">{locale === "it" ? "Nome e categoria obbligatori" : "Name and category required"}</span>
            </div>

            <div className="animal-category-grid" role="group" aria-label={locale === "it" ? "Categoria animale" : "Animal category"}>
              {(editing
                ? animalCategoryCards.filter((card) => card.category === form.category && (!card.animalType || card.animalType === companionType))
                : animalCategoryCards.filter((card) => enabledCategories.includes(card.category))
              ).map((card) => {
                const selected = card.category === form.category && (!card.animalType || card.animalType === companionType);
                return <button
                  key={card.key}
                  type="button"
                  className={"animal-category-card" + (selected ? " selected" : "")}
                  aria-pressed={selected}
                  disabled={Boolean(editing)}
                  onClick={() => selectAnimalCategory(card.category, card.animalType)}
                >
                  <span className="animal-category-emoji" aria-hidden="true">{card.emoji}</span>
                  <span className="animal-category-copy"><strong>{card.title[locale]}</strong><small>{card.description[locale]}</small></span>
                  <span className="animal-category-check" aria-hidden="true">{selected ? <Icon name="checkCircle" size={18} /> : null}</span>
                </button>;
              })}
              {!editing && enabledCategories.length === 0 && <Alert tone="warning">{locale === "it" ? "Non hai categorie abilitate. Attivane almeno una nelle impostazioni prima di creare un animale." : "No animal categories are enabled. Enable at least one in settings before creating an animal."}</Alert>}
            </div>
            {editing && <p className="animal-wizard-locked-note">{locale === "it" ? "La categoria non si modifica dalla scheda: le conversioni richiedono una procedura separata per proteggere i dati specifici." : "The category cannot be changed from the profile editor. Conversions use a separate flow to protect category-specific data."}</p>}
          </section>

          <section className="animal-editor-section animal-wizard-section">
            <div className="animal-editor-section-heading">
              <span className="animal-editor-section-icon"><Icon name="fingerprint" size={17} /></span>
              <div>
                <h3>{locale === "it" ? "Dati anagrafici" : "Core details"}</h3>
                <p>{locale === "it" ? "Nome, specie, sesso e identificativo condivisi da tutte le categorie." : "Name, species, sex and identifier shared by every category."}</p>
              </div>
            </div>
            <div className="form-grid">
              <Field label={locale === "it" ? "Nome" : "Name"} required><Input required maxLength={120} autoComplete="off" placeholder={locale === "it" ? "Es. Nala" : "e.g. Nala"} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></Field>
              {isCompanion
                ? <Field label={locale === "it" ? "Specie" : "Species"} hint={locale === "it" ? "Impostata automaticamente dalla scelta Cane o Gatto; la razza è un dato separato." : "Set automatically from Dog or Cat; breed is stored separately."}><Input value={form.species} readOnly /></Field>
                : <Field label={locale === "it" ? "Specie" : "Species"} hint={locale === "it" ? "Puoi inserire il nome comune o scientifico." : "Enter the common or scientific name."}><Input required maxLength={160} placeholder={locale === "it" ? "Es. Python regius" : "e.g. Python regius"} value={form.species} onChange={(event) => setForm((current) => ({ ...current, species: event.target.value, motherAnimalId: "", fatherAnimalId: "" }))} /></Field>}
              <Field label={locale === "it" ? "Sesso" : "Sex"}><Select value={form.sex} onChange={(event) => setForm((current) => ({ ...current, sex: event.target.value }))}><option value="unknown">{t("unknown")}</option><option value="male">{t("male")}</option><option value="female">{t("female")}</option></Select></Field>
              <Field label={locale === "it" ? "Identificativo interno" : "Internal identifier"} hint={locale === "it" ? "Facoltativo: un codice assegnato da te, distinto da microchip e anello." : "Optional: your own code, separate from a microchip or bird ring."}><Input maxLength={120} placeholder={locale === "it" ? "Es. VRQ-001" : "e.g. VRQ-001"} value={form.identifier} onChange={(event) => setForm((current) => ({ ...current, identifier: event.target.value }))} /></Field>
              {form.category === "reptiles" && <Field label={locale === "it" ? "Morph / variante" : "Morph / variant"} hint={locale === "it" ? "Solo per le specie per cui è significativo; puoi aggiungerlo in seguito." : "Only for species where it is meaningful; you can add it later."}><Input maxLength={200} placeholder={locale === "it" ? "Es. Pastel, Albino…" : "e.g. Pastel, Albino…"} value={form.morph} onChange={(event) => setForm((current) => ({ ...current, morph: event.target.value }))} /></Field>}
            </div>
          </section>

          <section className="animal-editor-section animal-wizard-section">
            <div className="animal-editor-section-heading">
              <span className="animal-editor-section-icon"><Icon name="camera" size={17} /></span>
              <div>
                <h3>{locale === "it" ? "Fotografia" : "Photograph"}</h3>
                <p>{locale === "it" ? "Aggiungi l'immagine principale per riconoscere subito l'esemplare." : "Add a main image to identify the animal at a glance."}</p>
              </div>
              <span className="animal-editor-optional">{locale === "it" ? "Facoltativa" : "Optional"}</span>
            </div>
            <div className="animal-editor-photo">
              {editing?.photoUrl && !photoFile
                ? <img src={editing.photoUrl} alt={t("animalPhoto")} />
                : <span className="animal-editor-photo-placeholder"><Icon name="image" size={23} /></span>}
              <div className="animal-editor-photo-copy">
                <strong>{photoFile ? photoFile.name : (locale === "it" ? "Nessuna immagine selezionata" : "No image selected")}</strong>
                <span>{locale === "it" ? "JPG, PNG o WebP · massimo 5 MB" : "JPG, PNG or WebP · 5 MB maximum"}</span>
                <Field label={locale === "it" ? "Fotografia" : "Photograph"}><Input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => selectPhoto(event.target.files?.[0] ?? null)} /></Field>
              </div>
              {editing?.photoUrl && <Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => void removePhoto()}>{t("removePhoto")}</Button>}
            </div>
            <p className="animal-editor-photo-hint">{t("animalPhotoHint")}</p>
          </section>
        </>}

        {wizardStep === 1 && <>
          <section className="animal-editor-section animal-wizard-section">
            <div className="animal-editor-section-heading">
              <span className="animal-editor-section-icon"><Icon name="home" size={17} /></span>
              <div>
                <h3>{locale === "it" ? "Posizione e sistemazione" : "Location and housing"}</h3>
                <p>{locale === "it" ? "Indica dove si trova l'animale. La descrizione cambia in base alla categoria." : "Record where the animal lives. The hint adapts to its category."}</p>
              </div>
            </div>
            <Field
              label={form.category === "reptiles" ? (locale === "it" ? "Stabulazione / rack" : "Housing / rack")
                : form.category === "fish" ? (locale === "it" ? "Acquario / vasca" : "Aquarium / tank")
                  : form.category === "birds" ? (locale === "it" ? "Voliera / gabbia" : "Aviary / cage")
                    : (locale === "it" ? "Ambiente / posizione" : "Living environment / location")}
              hint={form.category === "reptiles" ? (locale === "it" ? "Rack, terrario o area di stabulazione." : "Rack, terrarium or enclosure area.")
                : form.category === "fish" ? (locale === "it" ? "Acquario o vasca in cui vive l'esemplare." : "Aquarium or tank where it lives.")
                  : form.category === "birds" ? (locale === "it" ? "Voliera, gabbia o area di volo." : "Aviary, cage or flight area.")
                    : (locale === "it" ? "Casa, stanza, giardino o altro ambiente abituale." : "Home, room, garden or other usual environment.")}
            >
              <Input maxLength={160} placeholder={form.category === "reptiles" ? (locale === "it" ? "Es. Rack 03" : "e.g. Rack 03")
                : form.category === "fish" ? (locale === "it" ? "Es. Acquario 1" : "e.g. Aquarium 1")
                  : form.category === "birds" ? (locale === "it" ? "Es. Voliera esterna" : "e.g. Outdoor aviary")
                    : (locale === "it" ? "Es. Casa / giardino" : "e.g. Home / garden")}
                value={form.locationLabel} onChange={(event) => setForm((current) => ({ ...current, locationLabel: event.target.value }))} />
            </Field>
          </section>

          <section className="animal-editor-section animal-wizard-section">
            <div className="animal-editor-section-heading">
              <span className="animal-editor-section-icon"><Icon name="weight" size={17} /></span>
              <div>
                <h3>{locale === "it" ? "Peso iniziale" : "Initial weight"}</h3>
                <p>{locale === "it" ? "Se lo inserisci, viene salvato nello storico delle pesature con la sua data." : "When provided, it is saved as a dated measurement in the animal's weight history."}</p>
              </div>
              <span className="animal-editor-optional">{locale === "it" ? "Facoltativo" : "Optional"}</span>
            </div>
            <div className="form-grid">
              <Field label={locale === "it" ? "Peso" : "Weight"} hint={locale === "it" ? "L'unità segue le preferenze del tuo account." : "The unit follows your account preferences."}>
                <Input type="number" min="0.01" max="100000000" step="0.01" value={initialWeight} onChange={(event) => setInitialWeight(event.target.value)} placeholder={locale === "it" ? "Es. 1250" : "e.g. 1250"} />
              </Field>
              <Field label={locale === "it" ? "Data della pesatura" : "Weighing date"}><Input type="date" value={initialWeightDate} onChange={(event) => setInitialWeightDate(event.target.value)} /></Field>
            </div>
          </section>

          <section className="animal-editor-section animal-wizard-section">
            <div className="animal-editor-section-heading">
              <span className="animal-editor-section-icon"><Icon name="settings" size={17} /></span>
              <div>
                <h3>{locale === "it" ? "Informazioni specifiche" : "Category-specific details"}</h3>
                <p>{form.category === "reptiles"
                  ? (locale === "it" ? "Terrario, brumazione e alimentazione. Puoi completare il profilo più avanti." : "Enclosure, brumation and feeding. Complete the profile later if needed.")
                  : form.category === "fish"
                    ? (locale === "it" ? "Acqua, dimensioni e dieta dell'esemplare." : "Water, size and diet details.")
                    : form.category === "birds"
                      ? (locale === "it" ? "Alimentazione, interazione e capacità di volo." : "Diet, tameness and flight status.")
                      : (locale === "it" ? "Razza, comportamento e informazioni veterinarie." : "Breed, behaviour and veterinary details.")}</p>
              </div>
              <span className="animal-editor-optional">{locale === "it" ? "Facoltative" : "Optional"}</span>
            </div>
            <div className="form-grid">
              {form.category === "reptiles" && <>
                <Field label={locale === "it" ? "Alloggiamento / terrario" : "Enclosure"}><Input maxLength={120} value={String(form.domainProfile.enclosure ?? "")} onChange={(event) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, enclosure: event.target.value } }))} /></Field>
                <Field label={locale === "it" ? "Brumazione" : "Brumation"}><Select value={String(form.domainProfile.brumation ?? "")} onChange={(event) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, brumation: event.target.value } }))}><option value="">{locale === "it" ? "Non registrata" : "Not recorded"}</option><option value="not_applicable">{locale === "it" ? "Non applicabile" : "Not applicable"}</option><option value="planned">{locale === "it" ? "Pianificata" : "Planned"}</option><option value="in_progress">{locale === "it" ? "In corso" : "In progress"}</option><option value="completed">{locale === "it" ? "Completata" : "Completed"}</option></Select></Field>
                <Field label={locale === "it" ? "Note alimentazione" : "Feeding notes"}><Textarea rows={2} value={String(form.domainProfile.feedingNotes ?? "")} onChange={(event) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, feedingNotes: event.target.value } }))} /></Field>
              </>}
              {form.category === "fish" && <>
                <Field label={locale === "it" ? "Tipo d'acqua" : "Water type"}><Select value={String(form.domainProfile.waterType ?? "")} onChange={(event) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, waterType: event.target.value } }))}><option value="">{locale === "it" ? "Non registrato" : "Not recorded"}</option><option value="freshwater">{locale === "it" ? "Dolce" : "Freshwater"}</option><option value="saltwater">{locale === "it" ? "Marina" : "Saltwater"}</option><option value="brackish">{locale === "it" ? "Salmastra" : "Brackish"}</option></Select></Field>
                <Field label={locale === "it" ? "Temperamento" : "Temperament"}><Input maxLength={120} value={String(form.domainProfile.temperament ?? "")} onChange={(event) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, temperament: event.target.value } }))} /></Field>
                <Field label={locale === "it" ? "Dimensione adulta (cm)" : "Adult size (cm)"}><Input type="number" min="0.1" max="500" step="0.1" value={String(form.domainProfile.maxSizeCm ?? "")} onChange={(event) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, maxSizeCm: event.target.value === "" ? "" : Number(event.target.value) } }))} /></Field>
                <Field label={locale === "it" ? "Alimentazione" : "Diet"}><Input maxLength={160} value={String(form.domainProfile.diet ?? "")} onChange={(event) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, diet: event.target.value } }))} /></Field>
                <label className="checkbox-field"><input type="checkbox" checked={Boolean(form.domainProfile.shoaling)} onChange={(event) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, shoaling: event.target.checked } }))} /><span>{locale === "it" ? "Specie gregaria" : "Shoaling species"}</span></label>
              </>}
              {form.category === "birds" && <>
                <Field label={locale === "it" ? "Alimentazione" : "Diet"}><Input maxLength={160} value={String(form.domainProfile.diet ?? "")} onChange={(event) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, diet: event.target.value } }))} /></Field>
                <Field label={locale === "it" ? "Abitudine al contatto" : "Tameness"}><Select value={String(form.domainProfile.tameness ?? "")} onChange={(event) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, tameness: event.target.value } }))}><option value="">{locale === "it" ? "Non registrata" : "Not recorded"}</option><option value="wild">{locale === "it" ? "Selvatico" : "Wild"}</option><option value="socialized">{locale === "it" ? "Socializzato" : "Socialized"}</option><option value="tame">{locale === "it" ? "Addomesticato" : "Tame"}</option></Select></Field>
                <Field label={locale === "it" ? "Capacità di volo" : "Flight status"}><Select value={String(form.domainProfile.flightStatus ?? "")} onChange={(event) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, flightStatus: event.target.value } }))}><option value="">{locale === "it" ? "Non registrata" : "Not recorded"}</option><option value="unknown">{locale === "it" ? "Non noto" : "Unknown"}</option><option value="full_flight">{locale === "it" ? "Volo completo" : "Full flight"}</option><option value="clipped">{locale === "it" ? "Remiganti accorciate" : "Clipped"}</option></Select></Field>
              </>}
              {form.category === "dogs_cats" && <>
                <Field label={locale === "it" ? "Razza" : "Breed"} hint={locale === "it" ? "La razza è distinta dalla specie scientifica." : "Breed is stored separately from the scientific species."}><Input maxLength={160} value={String(form.domainProfile.breed ?? "")} onChange={(event) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, breed: event.target.value } }))} /></Field>
                <Field label={locale === "it" ? "Microchip" : "Microchip"}><Input maxLength={40} value={String(form.domainProfile.microchip ?? "")} onChange={(event) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, microchip: event.target.value } }))} /></Field>
                <Field label={locale === "it" ? "Colore mantello" : "Coat colour"}><Input maxLength={120} value={String(form.domainProfile.coatColor ?? "")} onChange={(event) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, coatColor: event.target.value } }))} /></Field>
                {companionType === "cat"
                  ? <Field label={locale === "it" ? "Accesso all'esterno" : "Outdoor access"}><Select value={String(form.domainProfile.indoorOutdoor ?? "")} onChange={(event) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, indoorOutdoor: event.target.value } }))}><option value="">{locale === "it" ? "Non registrato" : "Not recorded"}</option><option value="indoor">{locale === "it" ? "Solo in casa" : "Indoor only"}</option><option value="outdoor">{locale === "it" ? "Solo esterno" : "Outdoor only"}</option><option value="both">{locale === "it" ? "Dentro e fuori" : "Indoor and outdoor"}</option></Select></Field>
                  : <Field label={locale === "it" ? "Livello di attività" : "Activity level"}><Select value={String(form.domainProfile.activityLevel ?? "")} onChange={(event) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, activityLevel: event.target.value } }))}><option value="">{locale === "it" ? "Non registrato" : "Not recorded"}</option><option value="low">{locale === "it" ? "Basso" : "Low"}</option><option value="moderate">{locale === "it" ? "Moderato" : "Moderate"}</option><option value="high">{locale === "it" ? "Alto" : "High"}</option></Select></Field>}
                <Field label={locale === "it" ? "Vaccinazioni" : "Vaccination status"}><Select value={String(form.domainProfile.vaccinationStatus ?? "")} onChange={(event) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, vaccinationStatus: event.target.value } }))}><option value="">{locale === "it" ? "Non registrato" : "Not recorded"}</option><option value="unknown">{locale === "it" ? "Non noto" : "Unknown"}</option><option value="not_up_to_date">{locale === "it" ? "Da aggiornare" : "Not up to date"}</option><option value="up_to_date">{locale === "it" ? "In regola" : "Up to date"}</option></Select></Field>
                <label className="checkbox-field"><input type="checkbox" checked={Boolean(form.domainProfile.sterilized)} onChange={(event) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, sterilized: event.target.checked } }))} /><span>{locale === "it" ? "Sterilizzato" : "Neutered / spayed"}</span></label>
                <Field label={locale === "it" ? "Veterinario" : "Veterinarian"}><Input maxLength={160} value={String(form.domainProfile.veterinarianName ?? "")} onChange={(event) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, veterinarianName: event.target.value } }))} /></Field>
                <Field label={locale === "it" ? "Clinica veterinaria" : "Veterinary clinic"}><Input maxLength={160} value={String(form.domainProfile.veterinaryClinic ?? "")} onChange={(event) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, veterinaryClinic: event.target.value } }))} /></Field>
                <Field label={locale === "it" ? "Telefono veterinario" : "Veterinary phone"}><Input maxLength={40} value={String(form.domainProfile.veterinaryPhone ?? "")} onChange={(event) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, veterinaryPhone: event.target.value } }))} /></Field>
                <Field label={locale === "it" ? "Email veterinario" : "Veterinary email"}><Input type="email" maxLength={254} value={String(form.domainProfile.veterinaryEmail ?? "")} onChange={(event) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, veterinaryEmail: event.target.value } }))} /></Field>
                <Field label={locale === "it" ? "Indirizzo veterinario" : "Veterinary address"}><Input maxLength={300} value={String(form.domainProfile.veterinaryAddress ?? "")} onChange={(event) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, veterinaryAddress: event.target.value } }))} /></Field>
                <Field label={locale === "it" ? "Allergie" : "Allergies"}><Textarea rows={2} maxLength={5000} value={String(form.domainProfile.allergies ?? "")} onChange={(event) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, allergies: event.target.value } }))} /></Field>
                <Field label={locale === "it" ? "Patologie croniche" : "Chronic conditions"}><Textarea rows={2} maxLength={5000} value={String(form.domainProfile.chronicConditions ?? "")} onChange={(event) => setForm((current) => ({ ...current, domainProfile: { ...current.domainProfile, chronicConditions: event.target.value } }))} /></Field>
              </>}
            </div>
          </section>
        </>}

        {wizardStep === 2 && <>
          <section className="animal-editor-section animal-wizard-section animal-editor-genealogy">
            <div className="animal-editor-section-heading">
              <span className="animal-editor-section-icon"><Icon name="git-branch" size={17} /></span>
              <div>
                <h3>{isCompanion ? (locale === "it" ? "Pedigree e genitori" : "Pedigree and parents") : (locale === "it" ? "Genealogia e genitori" : "Pedigree and parents")}</h3>
                <p>{locale === "it" ? "Collega animali già registrati oppure annota i genitori esterni, se conosciuti." : "Link existing animals or record external parents, when known."}</p>
              </div>
              <span className="animal-editor-optional">{locale === "it" ? "Facoltativa" : "Optional"}</span>
            </div>
            <div className="animal-editor-parent-grid">
              <div className="animal-editor-parent-card">
                <div className="animal-editor-parent-title"><span className="animal-editor-parent-symbol">♀</span><div><strong>{locale === "it" ? "Madre" : "Mother"}</strong><small>{locale === "it" ? "Femmina" : "Female"}</small></div></div>
                <RemoteSelect label={locale === "it" ? "Seleziona dalla piattaforma" : "Select from platform"} value={form.motherAnimalId} onChange={(value) => setForm((current) => ({ ...current, motherAnimalId: value, motherDescription: value ? "" : current.motherDescription }))} endpoint="/animals" responseKey="animals" secondaryKey="species" filters={{ status: "all", sex: "female", category: form.category, speciesExact: form.species, sort: "name" }} detailEndpoint={(id) => "/animals/" + encodeURIComponent(id)} detailKey="animal" locale={locale} />
                <Field label={isCompanion ? (locale === "it" ? "Oppure nome e razza" : "Or external name and breed") : (locale === "it" ? "Oppure nome e morph esterni" : "Or external name and morph")}><Input maxLength={240} placeholder={isCompanion ? (locale === "it" ? "Es. Luna · Maine Coon" : "e.g. Luna · Maine Coon") : (locale === "it" ? "Es. Luna · Pastel het Clown" : "e.g. Luna · Pastel het Clown")} value={form.motherDescription} onChange={(event) => setForm((current) => ({ ...current, motherDescription: event.target.value, motherAnimalId: "" }))} /></Field>
              </div>
              <div className="animal-editor-parent-card">
                <div className="animal-editor-parent-title"><span className="animal-editor-parent-symbol">♂</span><div><strong>{locale === "it" ? "Padre" : "Father"}</strong><small>{locale === "it" ? "Maschio" : "Male"}</small></div></div>
                <RemoteSelect label={locale === "it" ? "Seleziona dalla piattaforma" : "Select from platform"} value={form.fatherAnimalId} onChange={(value) => setForm((current) => ({ ...current, fatherAnimalId: value, fatherDescription: value ? "" : current.fatherDescription }))} endpoint="/animals" responseKey="animals" secondaryKey="species" filters={{ status: "all", sex: "male", category: form.category, speciesExact: form.species, sort: "name" }} detailEndpoint={(id) => "/animals/" + encodeURIComponent(id)} detailKey="animal" locale={locale} />
                <Field label={isCompanion ? (locale === "it" ? "Oppure nome e razza" : "Or external name and breed") : (locale === "it" ? "Oppure nome e morph esterni" : "Or external name and morph")}><Input maxLength={240} placeholder={isCompanion ? (locale === "it" ? "Es. Milo · Labrador" : "e.g. Milo · Labrador") : (locale === "it" ? "Es. Thor · Banana Pied" : "e.g. Thor · Banana Pied")} value={form.fatherDescription} onChange={(event) => setForm((current) => ({ ...current, fatherDescription: event.target.value, fatherAnimalId: "" }))} /></Field>
              </div>
            </div>
            <p className="animal-editor-genealogy-hint">{locale === "it" ? "I genitori non sono obbligatori. I collegamenti interni vengono controllati prima del salvataggio." : "Parents are optional. Internal parent links are validated before saving."}</p>
          </section>

          <section className="animal-editor-section animal-wizard-section">
            <div className="animal-editor-section-heading">
              <span className="animal-editor-section-icon"><Icon name="calendar-days" size={17} /></span>
              <div>
                <h3>{locale === "it" ? "Date e provenienza" : "Dates and origin"}</h3>
                <p>{locale === "it" ? "Quando è nato e come è entrato nella tua collezione." : "When the animal was born and how it joined your collection."}</p>
              </div>
              <span className="animal-editor-optional">{locale === "it" ? "Facoltative" : "Optional"}</span>
            </div>
            <div className="form-grid">
              <Field label={t("birthDate")}><Input type="date" value={form.birthDate} onChange={(event) => setForm((current) => ({ ...current, birthDate: event.target.value }))} /></Field>
              <Field label={t("acquiredDate")}><Input type="date" value={form.acquiredDate} onChange={(event) => setForm((current) => ({ ...current, acquiredDate: event.target.value }))} /></Field>
              <Field label={isCompanion ? (locale === "it" ? "Proprietario precedente" : "Previous owner") : t("previousBreeder")}><Input placeholder={isCompanion ? (locale === "it" ? "Nome del precedente proprietario" : "Previous owner's name") : (locale === "it" ? "Nome dell'allevatore" : "Breeder name")} value={form.previousBreeder} onChange={(event) => setForm((current) => ({ ...current, previousBreeder: event.target.value }))} /></Field>
              <Field label={locale === "it" ? "Stato iniziale" : "Initial status"}><Select value={form.status === "archived" ? "active" : form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>{["active", "sold", "transferred", "deceased"].map((value) => <option value={value} key={value}>{t("animalStatus_" + value)}</option>)}</Select></Field>
            </div>
            <label className="checkbox-field animal-editor-estimated"><input type="checkbox" checked={form.birthDateEstimated} onChange={(event) => setForm((current) => ({ ...current, birthDateEstimated: event.target.checked }))} />{t("estimatedDate")}</label>
            <Field label={t("origin")} hint={locale === "it" ? "Ad esempio: nato in allevamento, acquistato, adottato o trasferito." : "For example: captive-bred, purchased, adopted or transferred."}><Textarea rows={2} maxLength={5000} value={form.originDescription} onChange={(event) => setForm((current) => ({ ...current, originDescription: event.target.value }))} placeholder={locale === "it" ? "Descrivi la provenienza…" : "Describe the animal's origin…"} /></Field>
          </section>

          <section className="animal-editor-section animal-wizard-section">
            <div className="animal-editor-section-heading">
              <span className="animal-editor-section-icon"><Icon name="notebook-pen" size={17} /></span>
              <div>
                <h3>{isCompanion ? (locale === "it" ? "Annotazioni" : "Notes") : (locale === "it" ? "Genetica e annotazioni" : "Genetics and notes")}</h3>
                <p>{locale === "it" ? "Informazioni aggiuntive, genetica conosciuta e note utili alla gestione." : "Additional information, known genetics and care notes."}</p>
              </div>
              <span className="animal-editor-optional">{locale === "it" ? "Facoltative" : "Optional"}</span>
            </div>
            {form.category === "reptiles" && <Field label={t("geneticsNotes")}><Textarea rows={2} maxLength={10000} placeholder={locale === "it" ? "Genetica conosciuta, test e informazioni verificate…" : "Known genetics, tests and verified information…"} value={form.geneticsNotes} onChange={(event) => setForm((current) => ({ ...current, geneticsNotes: event.target.value }))} /></Field>}
            <Field label={isCompanion ? (locale === "it" ? "Note sanitarie e comportamentali" : "Health and behaviour notes") : t("animalNotes")}><Textarea rows={3} maxLength={10000} placeholder={isCompanion ? (locale === "it" ? "Comportamento, terapie, esigenze particolari…" : "Behaviour, treatments, special needs…") : (locale === "it" ? "Note generali sull'esemplare…" : "General notes about this animal…")} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></Field>
          </section>

          <section className="animal-editor-section animal-wizard-documents">
            <div className="animal-editor-section-heading">
              <span className="animal-editor-section-icon"><Icon name="file" size={17} /></span>
              <div>
                <h3>{locale === "it" ? "Documenti" : "Documents"}</h3>
                <p>{locale === "it" ? "Certificati, documenti CITES, pedigree e ricevute possono essere allegati alla scheda dopo la creazione." : "Certificates, CITES records, pedigrees and receipts can be attached to the profile after creation."}</p>
              </div>
            </div>
            <p className="muted-note">{locale === "it" ? "Dopo il salvataggio apri la sezione Documenti dell'animale per caricare e organizzare gli allegati." : "After saving, open the animal's Documents section to upload and organize attachments."}</p>
          </section>

          <section className="animal-wizard-review" aria-label={locale === "it" ? "Riepilogo animale" : "Animal summary"}>
            <div><span className="animal-wizard-review-kicker">{locale === "it" ? "RIEPILOGO" : "SUMMARY"}</span><h3>{locale === "it" ? "Controlla la scheda prima di salvarla" : "Review the profile before saving"}</h3></div>
            <div className="animal-wizard-review-grid">
              <div><small>{locale === "it" ? "Nome" : "Name"}</small><strong>{form.name.trim() || "—"}</strong></div>
              <div><small>{locale === "it" ? "Categoria" : "Category"}</small><strong>{selectedCategoryCard?.title[locale] ?? "—"}</strong></div>
              <div><small>{locale === "it" ? "Specie" : "Species"}</small><strong>{form.species || "—"}</strong></div>
              <div><small>{locale === "it" ? "Sesso" : "Sex"}</small><strong>{t(form.sex)}</strong></div>
              <div><small>{locale === "it" ? "Identificativo" : "Identifier"}</small><strong>{form.identifier || "—"}</strong></div>
              <div><small>{locale === "it" ? "Posizione" : "Location"}</small><strong>{form.locationLabel || "—"}</strong></div>
              <div><small>{locale === "it" ? "Peso iniziale" : "Initial weight"}</small><strong>{initialWeight ? initialWeight + " " + weightUnitLabel() : "—"}</strong></div>
              <div><small>{locale === "it" ? "Stato" : "Status"}</small><strong>{t("animalStatus_" + (form.status === "archived" ? "active" : form.status))}</strong></div>
            </div>
          </section>
        </>}

        <div className="animal-wizard-footer">
          <div className="animal-wizard-footer-back">
            {wizardStep > 0
              ? <Button type="button" variant="secondary" disabled={busy} onClick={() => { setWizardStepError(""); setWizardStep((current) => (current - 1) as 0 | 1); }}><Icon name="chevron" size={15} />{locale === "it" ? "Indietro" : "Back"}</Button>
              : <Button type="button" variant="ghost" disabled={busy} onClick={() => setModal(false)}>{t("cancel")}</Button>}
          </div>
          <div className="animal-wizard-footer-next">
            {wizardStep === 1 && <Button type="button" variant="ghost" disabled={busy} onClick={() => { setWizardStepError(""); setWizardStep(2); }}>{locale === "it" ? "Salta gestione" : "Skip management"}<Icon name="arrow" size={15} /></Button>}
            {wizardStep === 2 && <Button type="button" variant="ghost" disabled={busy} onClick={() => void save()}>{locale === "it" ? "Salta dettagli e salva" : "Skip details and save"}</Button>}
            {wizardStep < 2
              ? <Button type="button" disabled={busy} onClick={goToNextWizardStep}>{locale === "it" ? "Continua" : "Continue"}<Icon name="arrow" size={15} /></Button>
              : <Button type="submit" disabled={busy}>{busy ? t("loading") : (editing ? t("save") : (locale === "it" ? "Crea animale" : "Create animal"))}</Button>}
          </div>
        </div>
      </form>
    </Modal>}
    {toast}
  </div>;
}