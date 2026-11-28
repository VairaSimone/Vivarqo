import { useState, type FormEvent } from "react";
import type { ClutchDto, IncubatorDto, OffspringBatchDto, ReproductiveEventDto, ReproductionCycleDto } from "@vivarqo/contracts/reproduction";
import { eventTypes } from "./types";
import { OffspringConversionModal, type OffspringAnimalDraft } from "./OffspringConversionModal";
import { ReproductiveEventEditor } from "./ReproductiveEventEditor";
import { ClutchEditor } from "./ClutchEditor";
import { OffspringManagement } from "./OffspringManagement";
type CycleDetailEditTarget = ReproductiveEventDto | ClutchDto | OffspringBatchDto;
import { api, ApiError } from "../../lib/api";
import { celsiusToTemperature, formatDate, formatDateTime, formatTemperature, getArray, getString, localDateTimeValue, queryString, temperatureToCelsius, temperatureUnitLabel, todayDate } from "../../lib/domain";
import type { Locale } from "../../lib/domain";
import { translate } from "../../lib/i18n";
import { useResource } from "../../hooks/useResource";
import { RemoteSelect } from "../../components/RemoteSelect";
import { Alert, Badge, Button, DataTable, EmptyState, ErrorState, Field, Icon, IconButton, Input, LoadingState, Modal, PageHeader, Pagination, Panel, PanelHeader, Select, Textarea, useToast } from "../../components/ui";
export function CycleDetail({ id, locale, navigate }: { id: string; locale: Locale; navigate: (path: string) => void }) {
  const t = (key: string) => translate(locale, key);
  const resource = useResource<{ cycle: ReproductionCycleDto }>(`/reproduction-cycles/${encodeURIComponent(id)}`);
  const [tab, setTab] = useState("events");
  const [eventsPage, setEventsPage] = useState(1);
  const [clutchesPage, setClutchesPage] = useState(1);
  const [offspringPage, setOffspringPage] = useState(1);
  const [modal, setModal] = useState<"event" | "clutch" | "offspring" | null>(null);
  const [conversionBatch, setConversionBatch] = useState<OffspringBatchDto | null>(null);
  const [conversionBusy, setConversionBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<CycleDetailEditTarget | null>(null);
  const [eventForm, setEventForm] = useState({ eventType: "pairing", occurredAt: localDateTimeValue(), animalId: "", details: "", temperatureC: "", humidityPct: "" });
  const [clutchForm, setClutchForm] = useState({ laidOn: todayDate(), eggCount: "1", status: "active", incubatorLabel: "", incubatorId: "", incubationStartedAt: "", targetTemperatureMinC: "", targetTemperatureMaxC: "", targetHumidityMinPct: "", targetHumidityMaxPct: "", checkIntervalHours: "", notes: "" });
  const [batchForm, setBatchForm] = useState({ clutchId: "", bornOn: todayDate(), count: "1", notes: "" });
  const { toast, show } = useToast();
  const cycle = resource.data?.cycle;
  const incubatorsResource = useResource<{ incubators: IncubatorDto[] }>("/incubators");
  const pairInsights = useResource<{ pair: {
    mother: { name: string; species: string; morph: string | null; geneticsNotes: string | null; ageYears: number | null; lastWeight: { measuredAt: string; weightG: string | number } | null; geneticTraits: Array<{ id: string; traitName: string; traitValue: string; confidenceNote: string | null; genotype: string | null; inheritanceMode: string | null; certainty: string }> };
    father: { name: string; species: string; morph: string | null; geneticsNotes: string | null; ageYears: number | null; lastWeight: { measuredAt: string; weightG: string | number } | null; geneticTraits: Array<{ id: string; traitName: string; traitValue: string; confidenceNote: string | null; genotype: string | null; inheritanceMode: string | null; certainty: string }> };
    compatibleSpecies: boolean; breedingProfile: { femaleMinAgeMonths: number | null; maleMinAgeMonths: number | null; femaleMinWeightG: string | number | null; maleMinWeightG: string | number | null; notes: string | null } | null; warnings: string[]; commonAncestors: Array<{ id: string; name: string }>; geneticDataIsIncomplete: boolean; inbreedingCoefficientEstimate: number | null; inbreedingCoefficientAssumption: string; geneticPredictions: Array<{ traitName: string; inheritanceMode: string; probabilities: Array<{ genotype: string; probabilityPct: number; phenotype: string | null }>; phenotypePredictions: Array<{ phenotype: string; probabilityPct: number }>; phenotypePredictionStatus: "mapped" | "partial" | "not_configured" | "rules_conflict"; certainty: string }>;
    combinedGeneticOutcomes: Array<{ loci: Array<{ traitName: string; genotype: string; phenotype: string | null }>; phenotype: string | null; probabilityPct: number }>;
    geneticOutcomeCombinationsTruncated: boolean;
    geneticModelAssumptions: string[];
    history: { cycleCount: number; pairingCount: number; firstPairingAt: string | null; lastPairingAt: string | null; clutchCount: number; offspringBatchCount: number; outcomes: Array<{ type: string; occurredAt: string; details: string | null }> };
  } }>(cycle?.parentAAnimalId && cycle?.parentBAnimalId
    ? `/reproduction-pairs/insights?motherId=${encodeURIComponent(cycle.parentAAnimalId)}&fatherId=${encodeURIComponent(cycle.parentBAnimalId)}`
    : null);
  const eventsPageResource = useResource<{ events: ReproductiveEventDto[]; pagination: { page: number; totalPages: number; total: number } }>(cycle ? `/reproduction-cycles/${encodeURIComponent(id)}/events?page=${eventsPage}&pageSize=25` : null);
  const clutchesPageResource = useResource<{ clutches: ClutchDto[]; pagination: { page: number; totalPages: number; total: number } }>(cycle ? `/reproduction-cycles/${encodeURIComponent(id)}/clutches?page=${clutchesPage}&pageSize=25` : null);
  const offspringPageResource = useResource<{ offspringBatches: OffspringBatchDto[]; pagination: { page: number; totalPages: number; total: number } }>(cycle ? `/offspring-batches?cycleId=${encodeURIComponent(id)}&page=${offspringPage}&pageSize=25` : null);
  const events = eventsPageResource.data?.events ?? cycle?.events ?? [];
  const clutches = clutchesPageResource.data?.clutches ?? cycle?.clutches ?? [];
  const offspring = offspringPageResource.data?.offspringBatches ?? cycle?.offspringBatches ?? [];

  function openEvent(event?: ReproductiveEventDto) {
    setEditing(event ?? null);
    setEventForm({
      eventType: getString(event, "eventType", "pairing"),
      occurredAt: event ? localDateTimeValue(new Date(getString(event, "occurredAt"))) : localDateTimeValue(),
      animalId: getString(event, "animalId"), details: getString(event, "details"),
      temperatureC: getString(event, "temperatureC") === "" ? "" : String(celsiusToTemperature(getString(event, "temperatureC"))), humidityPct: getString(event, "humidityPct")
    });
    setError(""); setModal("event");
  }
  async function configureSpeciesThresholds() {
    const pair = pairInsights.data?.pair;
    if (!pair) return;
    const profile = pair.breedingProfile;
    const ask = (label: string, current: number | string | null) => window.prompt(label, current == null ? "" : String(current));
    const femaleAge = ask(locale === "it" ? "Età minima femmina (mesi, vuoto = non impostata)" : "Minimum female age (months, blank = unset)", profile?.femaleMinAgeMonths ?? null);
    if (femaleAge === null) return;
    const maleAge = ask(locale === "it" ? "Età minima maschio (mesi)" : "Minimum male age (months)", profile?.maleMinAgeMonths ?? null);
    if (maleAge === null) return;
    const femaleWeight = ask(locale === "it" ? "Peso minimo femmina (g)" : "Minimum female weight (g)", profile?.femaleMinWeightG ?? null);
    if (femaleWeight === null) return;
    const maleWeight = ask(locale === "it" ? "Peso minimo maschio (g)" : "Minimum male weight (g)", profile?.maleMinWeightG ?? null);
    if (maleWeight === null) return;
    const parseOptional = (value: string, integer: boolean) => {
      if (!value.trim()) return null;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || (integer ? parsed < 0 : parsed <= 0) || (integer && !Number.isInteger(parsed))) throw new Error(locale === "it" ? "Valore soglia non valido." : "Invalid threshold value.");
      return parsed;
    };
    try {
      await api.patch("/species-breeding-profiles", {
        species: pair.mother.species,
        femaleMinAgeMonths: parseOptional(femaleAge, true),
        maleMinAgeMonths: parseOptional(maleAge, true),
        femaleMinWeightG: parseOptional(femaleWeight, false),
        maleMinWeightG: parseOptional(maleWeight, false),
        notes: profile?.notes ?? null,
      });
      pairInsights.reload();
      show(t("saveSuccess"));
    } catch (reason) { show(reason instanceof Error ? reason.message : t("operationFailed")); }
  }

  async function saveEvent(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const body = { eventType: eventForm.eventType, occurredAt: new Date(eventForm.occurredAt).toISOString(), animalId: eventForm.animalId || null, details: eventForm.details || null, temperatureC: eventForm.temperatureC === "" ? null : temperatureToCelsius(eventForm.temperatureC), humidityPct: eventForm.humidityPct === "" ? null : Number(eventForm.humidityPct) };
    try {
      if (editing) await api.patch(`/reproductive-events/${getString(editing, "id")}`, body);
      else await api.post(`/reproduction-cycles/${id}/events`, body);
      setModal(null); resource.reload(); eventsPageResource.reload(); show(t("saveSuccess"));
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  async function deleteEvent(event: ReproductiveEventDto) {
    if (!window.confirm(t("confirmDelete"))) return;
    try { await api.delete(`/reproductive-events/${getString(event, "id")}`); resource.reload(); eventsPageResource.reload(); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }
  function openClutch(clutch?: ClutchDto) {
    setEditing(clutch ?? null);
    setClutchForm({
      laidOn: getString(clutch, "laidOn") || todayDate(),
      eggCount: getString(clutch, "eggCount", "1"),
      status: getString(clutch, "status", "active"),
      incubatorLabel: getString(clutch, "incubatorLabel"),
      incubatorId: getString(clutch, "incubatorId"),
      incubationStartedAt: getString(clutch, "incubationStartedAt") ? localDateTimeValue(new Date(getString(clutch, "incubationStartedAt"))) : "",
      targetTemperatureMinC: getString(clutch, "targetTemperatureMinC"),
      targetTemperatureMaxC: getString(clutch, "targetTemperatureMaxC"),
      targetHumidityMinPct: getString(clutch, "targetHumidityMinPct"),
      targetHumidityMaxPct: getString(clutch, "targetHumidityMaxPct"),
      checkIntervalHours: getString(clutch, "checkIntervalHours"),
      notes: getString(clutch, "notes")
    });
    setError(""); setModal("clutch");
  }
  async function addIncubator() {
    const name = window.prompt(locale === "it" ? "Nome della nuova incubatrice" : "New incubator name");
    if (!name?.trim()) return;
    try {
      const result = await api.post<{ incubator: IncubatorDto }>("/incubators", { name: name.trim() });
      await incubatorsResource.reload();
      setClutchForm((current) => ({ ...current, incubatorId: result.incubator.id, incubatorLabel: current.incubatorLabel || result.incubator.name }));
      show(t("saveSuccess"));
    } catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }
  async function editIncubator(incubator: IncubatorDto) {
    const name = window.prompt(locale === "it" ? "Nome incubatrice" : "Incubator name", incubator.name);
    if (name === null || !name.trim()) return;
    const identifier = window.prompt(locale === "it" ? "Codice / identificativo (facoltativo)" : "Identifier (optional)", incubator.identifier ?? "");
    if (identifier === null) return;
    const capacityValue = window.prompt(locale === "it" ? "Capacità in uova (vuoto = non specificata)" : "Egg capacity (blank = unspecified)", incubator.capacity == null ? "" : String(incubator.capacity));
    if (capacityValue === null) return;
    const intervalValue = window.prompt(locale === "it" ? "Intervallo manutenzione in giorni (vuoto = disattivato)" : "Maintenance interval in days (blank = disabled)", incubator.maintenanceIntervalDays == null ? "" : String(incubator.maintenanceIntervalDays));
    if (intervalValue === null) return;
    const maintenanceIntervalDays = intervalValue.trim() ? Number(intervalValue) : null;
    if (maintenanceIntervalDays !== null && (!Number.isInteger(maintenanceIntervalDays) || maintenanceIntervalDays < 1 || maintenanceIntervalDays > 3650)) { show(locale === "it" ? "L’intervallo deve essere tra 1 e 3650 giorni." : "Interval must be between 1 and 3650 days."); return; }
    const notes = window.prompt(locale === "it" ? "Note (facoltative)" : "Notes (optional)", incubator.notes ?? "");
    if (notes === null) return;
    const capacity = capacityValue.trim() === "" ? null : Number(capacityValue);
    if (capacity !== null && (!Number.isInteger(capacity) || capacity <= 0 || capacity > 100_000)) {
      show(locale === "it" ? "La capacità deve essere un intero positivo." : "Capacity must be a positive integer.");
      return;
    }
    try {
      await api.patch(`/incubators/${encodeURIComponent(incubator.id)}`, {
        name: name.trim(), identifier: identifier.trim() || null, capacity, maintenanceIntervalDays, notes: notes.trim() || null,
      });
      await incubatorsResource.reload();
      show(t("saveSuccess"));
    } catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }
  async function deleteIncubator(incubator: IncubatorDto) {
    if (!window.confirm(locale === "it"
      ? `Archiviare l'incubatrice "${incubator.name}"? Le covate storiche manterranno il collegamento.`
      : `Archive incubator "${incubator.name}"? Existing clutches will keep their historical link.`)) return;
    try {
      await api.delete(`/incubators/${encodeURIComponent(incubator.id)}`);
      await incubatorsResource.reload();
      show(t("delete"));
    } catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }

  async function saveClutch(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const body = {
        laidOn: clutchForm.laidOn, eggCount: Number(clutchForm.eggCount), status: clutchForm.status,
        incubatorLabel: clutchForm.incubatorLabel || null,
        incubatorId: clutchForm.incubatorId || null,
        incubationStartedAt: clutchForm.incubationStartedAt ? new Date(clutchForm.incubationStartedAt).toISOString() : null,
        targetTemperatureMinC: clutchForm.targetTemperatureMinC === "" ? null : Number(clutchForm.targetTemperatureMinC),
        targetTemperatureMaxC: clutchForm.targetTemperatureMaxC === "" ? null : Number(clutchForm.targetTemperatureMaxC),
        targetHumidityMinPct: clutchForm.targetHumidityMinPct === "" ? null : Number(clutchForm.targetHumidityMinPct),
        targetHumidityMaxPct: clutchForm.targetHumidityMaxPct === "" ? null : Number(clutchForm.targetHumidityMaxPct),
        checkIntervalHours: clutchForm.checkIntervalHours === "" ? null : Number(clutchForm.checkIntervalHours),
        notes: clutchForm.notes || null
      };
      if (editing) await api.patch("/clutches/" + getString(editing, "id"), body);
      else await api.post("/clutches", { cycleId: id, ...body });
      setEditing(null); setModal(null); resource.reload(); clutchesPageResource.reload(); show(t("saveSuccess"));
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  async function deleteClutch(clutch: ClutchDto) {
    if (!window.confirm(t("confirmDelete"))) return;
    try { await api.delete("/clutches/" + getString(clutch, "id")); resource.reload(); clutchesPageResource.reload(); show(t("delete")); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }
  function openBatch(batch?: OffspringBatchDto) {
    setEditing(batch ?? null);
    setBatchForm({ clutchId: getString(batch, "clutchId"), bornOn: getString(batch, "bornOn") || todayDate(), count: getString(batch, "count", "1"), notes: getString(batch, "notes") });
    setError(""); setModal("offspring");
  }
  async function convertBatchAnimals(drafts: OffspringAnimalDraft[]) {
    if (!conversionBatch) return;
    setConversionBusy(true);
    let recordsCreated = false;
    try {
      const created = await api.post<{ animals: Array<{ id: string }> }>(`/offspring-batches/${getString(conversionBatch, "id")}/animals`, {
        animals: drafts.map(({ photo: _photo, ...animal }) => ({
          ...animal, identifier: animal.identifier || null, morph: animal.morph || null,
          geneticsNotes: animal.geneticsNotes || null, notes: animal.notes || null,
          locationLabel: animal.locationLabel || null, birthDate: animal.birthDate || conversionBatch.bornOn.slice(0, 10),
          acquiredDate: animal.acquiredDate || null, originDescription: animal.originDescription || null,
          eggId: animal.eggId || null,
          initialWeightG: animal.initialWeightG.trim() ? Number(animal.initialWeightG) : null,
        }))
      });
      recordsCreated = true;
      const failedPhotos: string[] = [];
      for (let index = 0; index < drafts.length; index += 1) {
        const photo = drafts[index]?.photo;
        const animalId = created.animals[index]?.id;
        if (photo && animalId) {
          try { await api.upload(`/animals/${animalId}/photo`, photo); }
          catch { failedPhotos.push(drafts[index]?.name || String(index + 1)); }
        }
      }
      setConversionBatch(null); resource.reload();
      show(failedPhotos.length
        ? (locale === "it" ? `Animali creati, ma non è stato possibile caricare le foto di: ${failedPhotos.join(", ")}` : `Animals created, but photos failed to upload for: ${failedPhotos.join(", ")}`)
        : t("saveSuccess"));
    } catch (reason) {
      if (recordsCreated) { setConversionBatch(null); resource.reload(); }
      show(reason instanceof ApiError ? reason.message : t("operationFailed"));
    }
    finally { setConversionBusy(false); }
  }

  async function saveBatch(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const body = { clutchId: batchForm.clutchId || null, bornOn: batchForm.bornOn, count: Number(batchForm.count), notes: batchForm.notes || null };
      if (editing) await api.patch("/offspring-batches/" + getString(editing, "id"), body);
      else await api.post("/offspring-batches", { cycleId: id, ...body });
      setEditing(null); setModal(null); resource.reload(); offspringPageResource.reload(); show(t("saveSuccess"));
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  async function deleteBatch(batch: OffspringBatchDto) {
    if (!window.confirm(t("confirmDelete"))) return;
    try { await api.delete("/offspring-batches/" + getString(batch, "id")); resource.reload(); offspringPageResource.reload(); show(t("delete")); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }

  if (resource.loading && !cycle) return <LoadingState />;
  if (resource.error || !cycle) return <ErrorState message={resource.error?.message ?? t("noRecords")} retry={resource.reload} />;
  const parentA = cycle.parentA; const parentB = cycle.parentB;
  return <div className="page-stack">
    <div className="back-row"><button className="text-link" onClick={() => navigate("/reproduction")}>← {t("breedingTitle")}</button></div>
    <PageHeader eyebrow={t("cycles")} title={getString(cycle, "name") || t("cycles")} description={`${formatDate(getString(cycle, "startedOn"), locale)} · ${t(`cycleStatus_${getString(cycle, "status")}`)}`} action={<Button onClick={() => { setModal("event"); openEvent(); }}><Icon name="plus" />{t("addEvent")}</Button>} />
    <Panel className="cycle-summary"><div className="cycle-parent"><span>{locale === "it" ? "Madre" : "Mother"}</span><strong>{getString(parentA, "name") || "—"}</strong><small>{getString(parentA, "species")}</small></div><div className="cycle-vs">×</div><div className="cycle-parent"><span>{locale === "it" ? "Padre" : "Father"}</span><strong>{getString(parentB, "name") || "—"}</strong><small>{getString(parentB, "species")}</small></div><div className="cycle-stats"><span>{cycle._count?.events ?? events.length} {t("events")}</span><span>{cycle._count?.clutches ?? clutches.length} {t("clutches")}</span><span>{cycle._count?.offspringBatches ?? offspring.length} {t("offspring")}</span></div></Panel>
    {pairInsights.data?.pair && <Panel>
      <PanelHeader title={locale === "it" ? "Compatibilità e storico della coppia" : "Pair compatibility and history"} action={<Button size="sm" variant="secondary" disabled={!pairInsights.data.pair.compatibleSpecies} onClick={() => void configureSpeciesThresholds()}>{locale === "it" ? "Soglie specie" : "Species thresholds"}</Button>} />
      {pairInsights.data.pair.warnings.length > 0 && <Alert tone="warning">{pairInsights.data.pair.warnings.map((warning) => ({
        MOTHER_SEX_NOT_CONFIRMED_FEMALE: locale === "it" ? "Sesso della madre non confermato come femmina." : "Mother is not confirmed female.",
        FATHER_SEX_NOT_CONFIRMED_MALE: locale === "it" ? "Sesso del padre non confermato come maschio." : "Father is not confirmed male.",
        SPECIES_MISMATCH: locale === "it" ? "Specie differenti: verifica che l'accoppiamento sia intenzionale." : "Different species: verify this pairing is intentional.",
        COMMON_ANCESTORS_FOUND: locale === "it" ? "Sono stati trovati antenati comuni: valuta il rischio di consanguineità." : "Common ancestors found: assess inbreeding risk.",
        MOTHER_AGE_UNKNOWN: locale === "it" ? "Età della madre non disponibile." : "Mother's age is unavailable.",
        FATHER_AGE_UNKNOWN: locale === "it" ? "Età del padre non disponibile." : "Father's age is unavailable.",
        MOTHER_WEIGHT_UNKNOWN: locale === "it" ? "Peso della madre non disponibile." : "Mother's weight is unavailable.",
        MOTHER_BELOW_MIN_AGE: locale === "it" ? "La madre è sotto l'età minima configurata per la specie." : "The mother is below the configured minimum age for this species.",
        FATHER_BELOW_MIN_AGE: locale === "it" ? "Il padre è sotto l'età minima configurata per la specie." : "The father is below the configured minimum age for this species.",
        MOTHER_BELOW_MIN_WEIGHT: locale === "it" ? "La madre è sotto il peso minimo configurato per la specie." : "The mother is below the configured minimum weight for this species.",
        FATHER_BELOW_MIN_WEIGHT: locale === "it" ? "Il padre è sotto il peso minimo configurato per la specie." : "The father is below the configured minimum weight for this species.",
        FATHER_WEIGHT_UNKNOWN: locale === "it" ? "Peso del padre non disponibile." : "Father's weight is unavailable."
      } as Record<string, string>)[warning] ?? warning).join(" ")}</Alert>}
      <div className="detail-grid">
        <div><strong>{locale === "it" ? "Madre" : "Mother"}: {pairInsights.data.pair.mother.name}</strong><p>{pairInsights.data.pair.mother.morph || "Morph non indicato"} · {pairInsights.data.pair.mother.ageYears == null ? "Età n/d" : `${pairInsights.data.pair.mother.ageYears} anni`} · {pairInsights.data.pair.mother.lastWeight ? `${pairInsights.data.pair.mother.lastWeight.weightG} g` : "Peso n/d"}</p><small>{pairInsights.data.pair.mother.geneticsNotes || (locale === "it" ? "Note genetiche non presenti" : "No genetics notes")}</small>{pairInsights.data.pair.mother.geneticTraits.map((trait) => <small key={trait.id}>{trait.traitName}: {trait.traitValue}{trait.genotype ? ` · ${trait.genotype}` : ""}{trait.inheritanceMode ? ` · ${trait.inheritanceMode}` : ""}{trait.certainty ? ` · ${trait.certainty}` : ""}{trait.confidenceNote ? ` · ${trait.confidenceNote}` : ""}</small>)}</div>
        <div><strong>{locale === "it" ? "Padre" : "Father"}: {pairInsights.data.pair.father.name}</strong><p>{pairInsights.data.pair.father.morph || "Morph non indicato"} · {pairInsights.data.pair.father.ageYears == null ? "Età n/d" : `${pairInsights.data.pair.father.ageYears} anni`} · {pairInsights.data.pair.father.lastWeight ? `${pairInsights.data.pair.father.lastWeight.weightG} g` : "Peso n/d"}</p><small>{pairInsights.data.pair.father.geneticsNotes || (locale === "it" ? "Note genetiche non presenti" : "No genetics notes")}</small>{pairInsights.data.pair.father.geneticTraits.map((trait) => <small key={trait.id}>{trait.traitName}: {trait.traitValue}{trait.genotype ? ` · ${trait.genotype}` : ""}{trait.inheritanceMode ? ` · ${trait.inheritanceMode}` : ""}{trait.certainty ? ` · ${trait.certainty}` : ""}{trait.confidenceNote ? ` · ${trait.confidenceNote}` : ""}</small>)}</div>
      </div>
      <div className="cycle-stats"><span>{pairInsights.data.pair.history.cycleCount} {locale === "it" ? "cicli insieme" : "shared cycles"}</span><span>{pairInsights.data.pair.history.pairingCount} {locale === "it" ? "accoppiamenti registrati" : "pairings recorded"}</span><span>{pairInsights.data.pair.history.clutchCount} {t("clutches")}</span><span>{pairInsights.data.pair.history.offspringBatchCount} {t("offspring")}</span></div>
      <p className="muted-note">{locale === "it" ? "Primo accoppiamento: " : "First pairing: "}{pairInsights.data.pair.history.firstPairingAt ? formatDateTime(pairInsights.data.pair.history.firstPairingAt, locale) : "—"} · {locale === "it" ? "Ultimo: " : "Latest: "}{pairInsights.data.pair.history.lastPairingAt ? formatDateTime(pairInsights.data.pair.history.lastPairingAt, locale) : "—"}</p>
      {pairInsights.data.pair.history.outcomes.length > 0 && <div><strong>{locale === "it" ? "Esiti registrati nelle riproduzioni precedenti" : "Recorded outcomes in previous breedings"}</strong><ul>{pairInsights.data.pair.history.outcomes.map((outcome, index) => <li key={`${outcome.type}-${outcome.occurredAt}-${index}`}>{formatDateTime(outcome.occurredAt, locale)} · {({
        pairing: locale === "it" ? "Accoppiamento" : "Pairing",
        pairing_failed: locale === "it" ? "Accoppiamento non riuscito" : "Unsuccessful pairing",
        no_deposition: locale === "it" ? "Nessuna deposizione" : "No egg laying",
        infertile_clutch: locale === "it" ? "Covata non fertile" : "Infertile clutch",
        embryonic_loss: locale === "it" ? "Perdita embrionale" : "Embryonic loss",
        stillbirth: locale === "it" ? "Nascita senza piccoli vivi" : "Stillbirth",
        post_hatch_loss: locale === "it" ? "Perdita dopo la schiusa" : "Post-hatch loss",
        loss: locale === "it" ? "Perdita" : "Loss",
        hatch: locale === "it" ? "Schiusa" : "Hatch",
        live_birth: locale === "it" ? "Nascita viva" : "Live birth"
      } as Record<string, string>)[outcome.type] ?? outcome.type}{outcome.details ? ` — ${outcome.details}` : ""}</li>)}</ul></div>}
      {pairInsights.data.pair.commonAncestors.length > 0 && <div><strong>{locale === "it" ? "Antenati comuni" : "Common ancestors"}</strong><p>{pairInsights.data.pair.commonAncestors.map((ancestor) => ancestor.name).join(", ")}</p></div>}
      {pairInsights.data.pair.inbreedingCoefficientEstimate != null && pairInsights.data.pair.inbreedingCoefficientEstimate > 0 && <Alert tone="warning">{locale === "it" ? "Stima preliminare di consanguineità" : "Preliminary inbreeding estimate"}: {(pairInsights.data.pair.inbreedingCoefficientEstimate * 100).toFixed(2)}%. <small>{pairInsights.data.pair.inbreedingCoefficientAssumption}</small></Alert>}
      {pairInsights.data.pair.geneticPredictions.length > 0 && <div><strong>{locale === "it" ? "Combinazioni genetiche teoriche" : "Theoretical genetic outcomes"}</strong>{pairInsights.data.pair.geneticPredictions.map((prediction) => <div className="record-row" key={prediction.traitName}><strong>{prediction.traitName}</strong><span>{prediction.probabilities.map((item) => `${item.genotype}: ${item.probabilityPct}%${item.phenotype ? ` · ${item.phenotype}` : ""}`).join(" · ")}</span>{prediction.phenotypePredictionStatus !== "not_configured" && <small>{locale === "it" ? `Fenotipi previsti: ${prediction.phenotypePredictions.map((item) => `${item.phenotype} ${item.probabilityPct}%`).join(" · ") || "regole incomplete"}` : `Predicted phenotypes: ${prediction.phenotypePredictions.map((item) => `${item.phenotype} ${item.probabilityPct}%`).join(" · ") || "incomplete rules"}`}</small>}</div>)}</div>}
      {pairInsights.data.pair.combinedGeneticOutcomes?.length > 0 && <div><strong>{locale === "it" ? "Combinazioni multi-locus teoriche" : "Theoretical multi-locus combinations"}</strong><div className="record-list">{pairInsights.data.pair.combinedGeneticOutcomes.map((outcome, index) => <div className="record-row" key={index}><strong>{outcome.probabilityPct.toFixed(3)}%</strong><span>{outcome.loci.map((locus) => `${locus.traitName}: ${locus.genotype}${locus.phenotype ? ` (${locus.phenotype})` : ""}`).join(" · ")}</span></div>)}</div>{pairInsights.data.pair.geneticOutcomeCombinationsTruncated && <Alert tone="warning">{locale === "it" ? "Risultati limitati alle prime 256 combinazioni per contenere il calcolo." : "Results limited to the first 256 combinations to bound computation."}</Alert>}</div>}
      <p className="muted-note">{locale === "it" ? "Le combinazioni multi-locus assumono loci indipendenti: non modellano linkage, ricombinazione o epistasi. I fenotipi sono mostrati solo quando hai configurato regole genotipo→fenotipo esplicite; regole assenti o discordanti non producono previsioni." : "Multi-locus combinations assume independent loci; linkage, recombination and epistasis are not modeled. Phenotypes are shown only when explicit genotype-to-phenotype rules are configured; missing or conflicting rules do not produce predictions."}</p>
      {pairInsights.data.pair.geneticDataIsIncomplete && <p className="muted-note">{locale === "it" ? "Dati genetici incompleti: non è possibile calcolare percentuali affidabili delle combinazioni." : "Genetic data is incomplete: reliable offspring probabilities cannot be calculated."}</p>}
      <p className="muted-note">{locale === "it" ? "Nessuna soglia automatica di età/peso o coefficiente di consanguineità viene inventata: servono parametri validati per specie e pedigree completo." : "No age/weight threshold or inbreeding coefficient is fabricated; validated species parameters and a complete pedigree are required."}</p>
    </Panel>}
    {pairInsights.error && <Alert tone="warning">{locale === "it" ? "Impossibile caricare l'analisi della coppia." : "Could not load pair insights."}</Alert>}
    <Panel>
      <PanelHeader title={locale === "it" ? "Incubatrici" : "Incubators"} action={<Button size="sm" variant="secondary" onClick={() => void addIncubator()}><Icon name="plus" />{locale === "it" ? "Aggiungi" : "Add"}</Button>} />
      {incubatorsResource.loading && !incubatorsResource.data ? <LoadingState /> : (incubatorsResource.data?.incubators ?? []).length
        ? <div className="record-list">{(incubatorsResource.data?.incubators ?? []).map((incubator) => <div className="record-row" key={incubator.id}>
            <div><strong>{incubator.name}</strong><small>{[incubator.identifier, incubator.capacity != null ? `${incubator.capacity} ${locale === "it" ? "uova" : "eggs"}` : null].filter(Boolean).join(" · ") || (locale === "it" ? "Nessun dettaglio aggiuntivo" : "No additional details")}</small>{incubator.maintenanceIntervalDays != null && <small>{locale === "it" ? `Manutenzione ogni ${incubator.maintenanceIntervalDays} giorni` : `Maintenance every ${incubator.maintenanceIntervalDays} days`}{incubator.nextMaintenanceAt ? ` · ${locale === "it" ? "prossima" : "next"}: ${formatDate(incubator.nextMaintenanceAt, locale)}` : ""}</small>}{incubator.notes && <p>{incubator.notes}</p>}</div>
            <div className="row-actions"><IconButton label={t("edit")} onClick={() => void editIncubator(incubator)}><Icon name="edit" size={15} /></IconButton><IconButton label={t("delete")} onClick={() => void deleteIncubator(incubator)}><Icon name="trash" size={15} /></IconButton></div>
          </div>)}</div>
        : <EmptyState title={locale === "it" ? "Nessuna incubatrice registrata" : "No incubators registered"} />}
    </Panel>
    <div className="tabs-line"><button className={tab === "events" ? "selected" : ""} onClick={() => setTab("events")}>{t("events")}</button><button className={tab === "clutches" ? "selected" : ""} onClick={() => setTab("clutches")}>{t("clutches")}</button><button className={tab === "offspring" ? "selected" : ""} onClick={() => setTab("offspring")}>{t("offspring")}</button></div>
    {tab === "events" && <Panel><PanelHeader title={t("events")} action={<Button size="sm" onClick={() => openEvent()}><Icon name="plus" />{t("addEvent")}</Button>} />
      {eventsPageResource.loading && !eventsPageResource.data ? <LoadingState /> : events.length ? <div className="timeline">{events.map((event) => <div className="timeline-item" key={getString(event, "id")}><span className="timeline-dot" /><div className="timeline-copy"><span>{formatDateTime(getString(event, "occurredAt"), locale)}</span><strong>{t(`event_${getString(event, "eventType")}`)}</strong><p>{getString(event, "details")}</p><small>{getString(event, "animal") ? getString(event.animal, "name") : ""}</small></div><div className="row-actions"><IconButton label={t("edit")} onClick={() => openEvent(event)}><Icon name="edit" /></IconButton><IconButton label={t("delete")} onClick={() => void deleteEvent(event)}><Icon name="trash" /></IconButton></div></div>)}</div> : <EmptyState title={t("noRecords")} />}
      {eventsPageResource.data?.pagination && <Pagination page={eventsPageResource.data.pagination.page} totalPages={eventsPageResource.data.pagination.totalPages} onChange={setEventsPage} label={t("page")} />}
    </Panel>}
    {tab === "clutches" && <Panel><PanelHeader title={t("clutches")} action={<Button size="sm" onClick={() => openClutch()}><Icon name="plus" />{t("addClutch")}</Button>} />
      {clutchesPageResource.loading && !clutchesPageResource.data ? <LoadingState /> : clutches.length ? <div className="clutch-grid">{clutches.map((clutch) => <article className="clutch-card" key={getString(clutch, "id")}><button className="clutch-card-open" onClick={() => navigate("/clutches/" + getString(clutch, "id"))}><span className="clutch-symbol"><Icon name="egg" size={20} /></span><strong>{t("clutches")} · {formatDate(getString(clutch, "laidOn"), locale)}</strong><small>{getString(clutch, "eggCount")} {t("eggs")} · {locale === "it" ? "registrate" : "registered"} {clutch._count?.eggs ?? 0} · {getString(clutch, "incubatorLabel") || "—"}</small><Badge>{getString(clutch, "status")}</Badge></button><div className="row-actions"><IconButton label={t("edit")} onClick={() => openClutch(clutch)}><Icon name="edit" /></IconButton><IconButton label={t("delete")} onClick={() => void deleteClutch(clutch)}><Icon name="trash" /></IconButton></div></article>)}</div> : <EmptyState title={t("noRecords")} />}
      {clutchesPageResource.data?.pagination && <Pagination page={clutchesPageResource.data.pagination.page} totalPages={clutchesPageResource.data.pagination.totalPages} onChange={setClutchesPage} label={t("page")} />}
    </Panel>}
    {conversionBatch && <OffspringConversionModal key={getString(conversionBatch, "id")} batch={conversionBatch} locale={locale} busy={conversionBusy} onClose={() => setConversionBatch(null)} onSubmit={convertBatchAnimals} />}
    {modal === "event" && <ReproductiveEventEditor locale={locale} isEditing={Boolean(editing)} form={eventForm} onChange={setEventForm} error={error} busy={busy} onClose={() => setModal(null)} onSubmit={saveEvent} />}
    {modal === "clutch" && <ClutchEditor locale={locale} isEditing={Boolean(editing)} form={clutchForm} onChange={setClutchForm} error={error} busy={busy} onClose={() => { setEditing(null); setModal(null); }} onSubmit={saveClutch} incubators={incubatorsResource.data?.incubators ?? []} onAddIncubator={() => void addIncubator()} />}
    {tab === "offspring" && <><OffspringManagement locale={locale} batches={offspring} clutches={clutches} editorOpen={modal === "offspring"} isEditing={Boolean(editing)} form={batchForm} error={error} busy={busy} onAdd={() => openBatch()} onConvert={setConversionBatch} onEdit={openBatch} onDelete={deleteBatch} onChange={setBatchForm} onClose={() => { setEditing(null); setModal(null); }} onSubmit={saveBatch} />{offspringPageResource.data?.pagination && <Pagination page={offspringPageResource.data.pagination.page} totalPages={offspringPageResource.data.pagination.totalPages} onChange={setOffspringPage} label={t("page")} />}</>}
    {toast}
  </div>;
}