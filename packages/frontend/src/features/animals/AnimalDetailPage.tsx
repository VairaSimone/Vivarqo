import { useEffect, useMemo, useState, type FormEvent } from "react";
import { parseFeedingSessionsResponse } from "@vivarqo/contracts/care";
import type { FeedingEntryDto, FeedingSessionDto, FeedingSessionsResponseDto } from "@vivarqo/contracts/care";
import { api, ApiError } from "../../lib/api";
import { downloadQrSvg, qrMatrix } from "../../lib/qr";
import { dateForInput, dateTimeInputToUtc, dateTimeInputValue, formatDate, formatDateTime, formatWeight, getArray, getString, gramsToWeight, queryString, todayDate, weightToGrams, weightUnitLabel } from "../../lib/domain";
import type { Locale } from "../../lib/domain";
import type { AnimalDto, AnimalNoteDto, AnimalDocumentDto, CareRecordDto, GeneticTraitDto, PublicShareDto, ShedDto, WeightDto } from "@vivarqo/contracts/animals";

import { translate } from "../../lib/i18n";
import { useResource } from "../../hooks/useResource";
import { AnimalMovementHistory } from "./AnimalMovementHistory";
import { AnimalFeedingInsights } from "./AnimalFeedingInsights";
import { RemoteSelect } from "../../components/RemoteSelect";
import { Alert, Badge, Button, DataTable, EmptyState, ErrorState, Field, Icon, IconButton, Input, LoadingState, Modal, Pagination, Panel, PanelHeader, Select, Textarea, useToast } from "../../components/ui";

const sourceAnimalDetailEndpoint = (sourceId: string) => "/animals/" + encodeURIComponent(sourceId);

export function AnimalDetailPage({ id, locale, navigate }: { id: string; locale: Locale; navigate: (path: string) => void }) {
  const t = (key: string) => translate(locale, key);
  const animalResource = useResource<{ animal: AnimalDto }>(`/animals/${encodeURIComponent(id)}`);
  const [tab, setTab] = useState("overview");
  const [internalQrBusy, setInternalQrBusy] = useState(false);
  const [animalEditModal, setAnimalEditModal] = useState(false);
  const [animalEditBusy, setAnimalEditBusy] = useState(false);
  const [animalEditError, setAnimalEditError] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [animalEditForm, setAnimalEditForm] = useState({
    name: "", identifier: "", species: "", sex: "unknown", morph: "", geneticsNotes: "",
    birthDate: "", birthDateEstimated: false, acquiredDate: "", originDescription: "",
    previousBreeder: "", locationLabel: "", status: "active", notes: ""
  });
  const [recordKind, setRecordKind] = useState<"weight" | "shed" | "note" | null>(null);
  const [recordEdit, setRecordEdit] = useState<CareRecordDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [traitModal, setTraitModal] = useState(false);
  const [traitEdit, setTraitEdit] = useState<GeneticTraitDto | null>(null);
  const [traitBusy, setTraitBusy] = useState(false);
  const [traitError, setTraitError] = useState("");
  const [hatchlingCareModal, setHatchlingCareModal] = useState(false);
  const [hatchlingCareBusy, setHatchlingCareBusy] = useState(false);
  const [hatchlingCareForm, setHatchlingCareForm] = useState({ firstFeedingAt: "", firstFeedingAccepted: "", firstShedAt: "", readyForRehomingAt: "", healthStatus: "unknown", healthNotes: "", notes: "" });
  const [traitForm, setTraitForm] = useState({
    traitName: "", traitValue: "", sourceAnimalId: "", confidenceNote: "", inheritanceMode: "", genotype: "", phenotypeRules: "", certainty: "unverified",
  });
  const [recordForm, setRecordForm] = useState({ date: "", weight: "", outcome: "complete", category: "general", title: "", body: "", notes: "" });
  const [feedingPage, setFeedingPage] = useState(1);
  const [feedingEditEntry, setFeedingEditEntry] = useState<FeedingEntryDto | null>(null);
  const [feedingBusy, setFeedingBusy] = useState(false);
  const [feedingFormError, setFeedingFormError] = useState("");
  const [feedingEditForm, setFeedingEditForm] = useState({
    performedAt: "", outcome: "ate", foodType: "", foodSize: "", foodWeightG: "", notes: "",
  });
  const { toast, show } = useToast();
  const animal = animalResource.data?.animal;
  const summaryWeights = useResource<{ weights: WeightDto[] }>(animal && tab === "overview" ? `/animals/${id}/weights?page=1&pageSize=1` : null);
  const summaryFeedings = useResource<FeedingSessionsResponseDto>(animal && tab === "overview" ? "/feeding-sessions" + queryString({ animalId: id, page: 1, pageSize: 1 }) : null, parseFeedingSessionsResponse);
  const weights = useResource<{ weights: WeightDto[] }>(animal && tab === "history" ? `/animals/${id}/weights?page=1&pageSize=100` : null);
  const sheds = useResource<{ sheds: ShedDto[] }>(animal && tab === "history" ? `/animals/${id}/sheds?page=1&pageSize=100` : null);
  const notes = useResource<{ notes: AnimalNoteDto[] }>(animal && tab === "history" ? `/animals/${id}/notes?page=1&pageSize=100` : null);
  const feedings = useResource<FeedingSessionsResponseDto>(animal && tab === "history" ? "/feeding-sessions" + queryString({ animalId: id, page: feedingPage, pageSize: 10 }) : null, parseFeedingSessionsResponse);
  const documents = useResource<{ documents: AnimalDocumentDto[] }>(animal && tab === "documents" ? `/documents?animalId=${encodeURIComponent(id)}&page=1&pageSize=100` : null);
  const traits = useResource<{ traits: GeneticTraitDto[] }>(animal && tab === "traits" ? `/animals/${id}/genetic-traits?page=1&pageSize=100` : null);
  const hatchlingCare = useResource<{ care: { firstFeedingAt: string | null; firstFeedingAccepted: boolean | null; firstShedAt: string | null; readyForRehomingAt: string | null; healthStatus: "unknown" | "healthy" | "monitoring" | "treatment"; healthNotes: string | null; notes: string | null } | null; feedingCount: number; acceptedFeedings: number; weights: WeightDto[]; sheds: ShedDto[] }>(animal?.originOffspringBatchId ? `/animals/${id}/hatchling-care` : null);
  const share = useResource<{ share: PublicShareDto }>(animal && tab === "share" ? `/animals/${id}/public-share` : null);

  useEffect(() => {
    setFeedingPage(1);
    setFeedingEditEntry(null);
  }, [id]);

  useEffect(() => {
    const totalPages = feedings.data?.pagination.totalPages;
    if (totalPages !== undefined && feedingPage > Math.max(1, totalPages)) {
      setFeedingPage(Math.max(1, totalPages));
    }
  }, [feedings.data?.pagination.totalPages, feedingPage]);

  function openAnimalEdit() {
    if (!animal) return;
    setPhotoFile(null);
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
      status: getString(animal, "status", "active"),
      notes: getString(animal, "notes")
    });
    setAnimalEditError("");
    setAnimalEditModal(true);
  }

  async function saveAnimalEdit(event: FormEvent) {
    event.preventDefault();
    setAnimalEditBusy(true); setAnimalEditError("");
    const { status: editedStatus, ...editableAnimalFields } = animalEditForm;
    const body = {
      ...editableAnimalFields,
      ...(getString(animal, "status") === "archived" ? {} : { status: editedStatus }),
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
      if (photoFile) await api.upload("/animals/" + id + "/photo", photoFile);
      setAnimalEditModal(false);
      setPhotoFile(null);
      animalResource.reload();
      show(t("animalUpdated"));
    } catch (reason) {
      setAnimalEditError(reason instanceof ApiError ? reason.message : t("operationFailed"));
    } finally { setAnimalEditBusy(false); }
  }

  function openRecord(kind: "weight" | "shed" | "note", existing?: CareRecordDto) {
    setRecordKind(kind); setRecordEdit(existing ?? null); setFormError("");
    setRecordForm({
      date: existing ? dateForInput(getString(existing, kind === "weight" ? "measuredAt" : "occurredAt")) : todayDate(),
      weight: existing ? String(gramsToWeight(getString(existing, "weightG"))) : "",
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
        const payload = { measuredAt: dateTimeInputToUtc(recordForm.date + "T12:00"), weightG: weightToGrams(recordForm.weight), notes: recordForm.notes || null };
        if (isEdit) await api.patch(`/weights/${recordId}`, payload); else await api.post(`/animals/${id}/weights`, payload);
      } else if (recordKind === "shed") {
        const payload = { occurredAt: dateTimeInputToUtc(recordForm.date + "T12:00"), outcome: recordForm.outcome, notes: recordForm.notes || null };
        if (isEdit) await api.patch(`/sheds/${recordId}`, payload); else await api.post(`/animals/${id}/sheds`, payload);
      } else if (recordKind === "note") {
        const payload = { occurredAt: dateTimeInputToUtc(recordForm.date + "T12:00"), title: recordForm.title || null, category: recordForm.category, body: recordForm.body };
        if (isEdit) await api.patch(`/animal-notes/${recordId}`, payload); else await api.post(`/animals/${id}/notes`, payload);
      }
      setRecordKind(null); weights.reload(); sheds.reload(); notes.reload(); animalResource.reload(); show(t("saveSuccess"));
    } catch (reason) { setFormError(reason instanceof ApiError ? reason.message : reason instanceof RangeError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }

  async function deleteRecord(kind: "weight" | "shed" | "note", record: CareRecordDto) {
    if (!window.confirm(t("confirmDelete"))) return;
    const idValue = getString(record, "id");
    const path = kind === "weight" ? `/weights/${idValue}` : kind === "shed" ? `/sheds/${idValue}` : `/animal-notes/${idValue}`;
    try { await api.delete(path); weights.reload(); sheds.reload(); notes.reload(); show(t("delete")); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }

  function openFeedingEdit(session: FeedingSessionDto, entry: FeedingEntryDto) {
    setFeedingFormError("");
    setFeedingEditForm({
      performedAt: dateTimeInputValue(getString(session, "performedAt")),
      outcome: getString(entry, "outcome", "ate"),
      foodType: getString(entry, "foodType"),
      foodSize: getString(entry, "foodSize"),
      foodWeightG: getString(entry, "foodWeightG") ? String(gramsToWeight(getString(entry, "foodWeightG"))) : "",
      notes: getString(entry, "notes"),
    });
    setFeedingEditEntry(entry);
  }

  async function saveFeedingEdit(event: FormEvent) {
    event.preventDefault();
    if (!feedingEditEntry) return;
    setFeedingBusy(true);
    setFeedingFormError("");
    try {
      await api.patch("/feeding-entries/" + getString(feedingEditEntry, "id"), {
        performedAt: dateTimeInputToUtc(feedingEditForm.performedAt),
        outcome: feedingEditForm.outcome,
        foodType: feedingEditForm.foodType || null,
        foodSize: feedingEditForm.foodSize || null,
        foodWeightG: feedingEditForm.foodWeightG ? weightToGrams(feedingEditForm.foodWeightG) : null,
        notes: feedingEditForm.notes || null,
      });
      setFeedingEditEntry(null);
      feedings.reload();
      show(t("saveSuccess"));
    } catch (reason) {
      setFeedingFormError(reason instanceof ApiError ? reason.message : reason instanceof RangeError ? reason.message : t("operationFailed"));
    } finally {
      setFeedingBusy(false);
    }
  }

  async function deleteFeedingEntry(entry: FeedingEntryDto) {
    if (!window.confirm(t("confirmDelete"))) return;
    try {
      await api.delete("/feeding-entries/" + getString(entry, "id"));
      feedings.reload();
      show(t("delete"));
    } catch (reason) {
      show(reason instanceof ApiError ? reason.message : t("operationFailed"));
    }
  }

  function openGeneticTrait(existing?: GeneticTraitDto) {
    setTraitEdit(existing ?? null);
    setTraitError("");
    setTraitForm({
      traitName: existing?.traitName ?? "",
      traitValue: existing?.traitValue ?? "",
      sourceAnimalId: existing?.sourceAnimalId ?? "",
      confidenceNote: existing?.confidenceNote ?? "",
      inheritanceMode: existing?.inheritanceMode ?? "",
      genotype: existing?.genotype ?? "",
      phenotypeRules: existing?.phenotypeRules ? JSON.stringify(existing.phenotypeRules, null, 2) : "",
      certainty: existing?.certainty ?? "unverified",
    });
    setTraitModal(true);
  }

  async function saveGeneticTrait(event: FormEvent) {
    event.preventDefault();
    if (!traitForm.traitName.trim() || !traitForm.traitValue.trim()) {
      setTraitError(t("formRequired"));
      return;
    }
    if (traitForm.sourceAnimalId === id) {
      setTraitError(t("geneticSelfSourceError"));
      return;
    }
    if ((traitForm.inheritanceMode && !/^(?:[A-Za-z]{2}|[A-Za-z][A-Za-z0-9_-]{0,11}\|[A-Za-z][A-Za-z0-9_-]{0,11})$/.test(traitForm.genotype)) || (traitForm.genotype && !traitForm.inheritanceMode)) {
      setTraitError(locale === "it" ? "Per calcolare le probabilità servono sia la modalità di ereditarietà sia un genotipo di due alleli (es. Aa)." : "To calculate probabilities, provide both an inheritance mode and a two-allele genotype (e.g. Aa).");
      return;
    }
    let phenotypeRules: Record<string, string> | null = null;
    if (traitForm.phenotypeRules.trim()) {
      try {
        const parsed: unknown = JSON.parse(traitForm.phenotypeRules);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
            Object.entries(parsed).some(([key, value]) => !key.trim() || typeof value !== "string" || !value.trim())) {
          throw new Error("invalid phenotype rules");
        }
        phenotypeRules = parsed as Record<string, string>;
      } catch {
        setTraitError(locale === "it" ? "Le regole fenotipo devono essere un oggetto JSON con genotipo come chiave e fenotipo come valore testuale." : "Phenotype rules must be a JSON object mapping genotype keys to phenotype labels.");
        return;
      }
    }
    setTraitBusy(true);
    setTraitError("");
    const payload = {
      traitName: traitForm.traitName.trim(),
      traitValue: traitForm.traitValue.trim(),
      sourceAnimalId: traitForm.sourceAnimalId || null,
      confidenceNote: traitForm.confidenceNote.trim() || null,
      inheritanceMode: traitForm.inheritanceMode || null,
      genotype: traitForm.genotype || null,
      phenotypeRules,
      certainty: traitForm.certainty,
    };
    try {
      if (traitEdit) await api.patch("/genetic-traits/" + traitEdit.id, payload);
      else await api.post("/animals/" + id + "/genetic-traits", payload);
      setTraitModal(false);
      setTraitEdit(null);
      traits.reload();
      show(t("saveSuccess"));
    } catch (reason) {
      setTraitError(reason instanceof ApiError ? reason.message : t("operationFailed"));
    } finally {
      setTraitBusy(false);
    }
  }

  function openHatchlingCare() {
    const care = hatchlingCare.data?.care;
    setHatchlingCareForm({
      firstFeedingAt: care?.firstFeedingAt?.slice(0, 10) ?? "",
      firstFeedingAccepted: care?.firstFeedingAccepted == null ? "" : care.firstFeedingAccepted ? "yes" : "no",
      firstShedAt: care?.firstShedAt?.slice(0, 10) ?? "",
      readyForRehomingAt: care?.readyForRehomingAt?.slice(0, 10) ?? "",
      healthStatus: care?.healthStatus ?? "unknown",
      healthNotes: care?.healthNotes ?? "",
      notes: care?.notes ?? "",
    });
    setHatchlingCareModal(true);
  }
  async function saveHatchlingCare(event: FormEvent) {
    event.preventDefault();
    setHatchlingCareBusy(true);
    const toIso = (value: string) => value ? new Date(value + "T12:00:00").toISOString() : null;
    try {
      await api.patch(`/animals/${encodeURIComponent(id)}/hatchling-care`, {
        firstFeedingAt: toIso(hatchlingCareForm.firstFeedingAt),
        firstFeedingAccepted: hatchlingCareForm.firstFeedingAccepted === "" ? null : hatchlingCareForm.firstFeedingAccepted === "yes",
        firstShedAt: toIso(hatchlingCareForm.firstShedAt),
        readyForRehomingAt: toIso(hatchlingCareForm.readyForRehomingAt),
        healthStatus: hatchlingCareForm.healthStatus,
        healthNotes: hatchlingCareForm.healthNotes || null,
        notes: hatchlingCareForm.notes || null,
      });
      setHatchlingCareModal(false);
      hatchlingCare.reload();
      show(t("saveSuccess"));
    } catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setHatchlingCareBusy(false); }
  }

  async function deleteGeneticTrait(trait: GeneticTraitDto) {
    if (!window.confirm(t("confirmDelete"))) return;
    try {
      await api.delete("/genetic-traits/" + trait.id);
      traits.reload();
      show(t("delete"));
    } catch (reason) {
      show(reason instanceof ApiError ? reason.message : t("operationFailed"));
    }
  }

  if (animalResource.loading && !animal) return <LoadingState />;
  if (animalResource.error || !animal) return <ErrorState message={animalResource.error?.message ?? t("noRecords")} retry={animalResource.reload} />;
  const animalName = getString(animal, "name");
  const isArchived = getString(animal, "status") === "archived";
  const latestWeight = summaryWeights.data?.weights?.[0];
  const latestFeedingSession = summaryFeedings.data?.sessions?.[0];
  const latestFeedingEntry = latestFeedingSession?.entries.find((entry) => getString(entry, "animalId") === id);
  const tabItems = [
    ["overview", t("overview")], ["history", t("careHistory")], ["documents", t("documentsTab")],
    ["traits", t("traits")], ["share", t("publicShare")]
  ];

  async function downloadInternalQr() {
    setInternalQrBusy(true);
    try {
      const result = await api.get<{ path: string }>(`/animals/${encodeURIComponent(id)}/internal-qr`);
      downloadQrSvg(window.location.origin + result.path, "vivarqo-internal-" + id + ".svg");
      show(locale === "it" ? "QR interno scaricato." : "Internal QR downloaded.");
    } catch (reason) {
      show(reason instanceof ApiError ? reason.message : t("operationFailed"));
    } finally {
      setInternalQrBusy(false);
    }
  }

  async function restoreAnimal() {
    if (!window.confirm(t("confirmRestoreAnimal"))) return;
    try {
      await api.post(`/animals/${encodeURIComponent(id)}/restore`);
      animalResource.reload();
      show(t("animalRestored"));
    } catch (reason) {
      show(reason instanceof ApiError ? reason.message : t("operationFailed"));
    }
  }

  return <div className="page-stack animal-detail-page">
    <div className="back-row"><button className="text-link" onClick={() => navigate("/animals")}>← {t("navAnimals")}</button></div>
    <section className="animal-hero">
      <div className="animal-hero-identity">
        <div className="animal-profile-avatar">{getString(animal, "photoUrl") ? <img src={getString(animal, "photoUrl")} alt="" /> : <Icon name="snake" size={30} />}</div>
        <div className="animal-profile-main">
          <div className="animal-hero-title"><h1>{animalName}</h1><Badge tone={getString(animal, "status") === "active" ? "success" : "neutral"}>{t(`animalStatus_${getString(animal, "status")}`)}</Badge></div>
          <p className="animal-hero-meta">{getString(animal, "species") || "—"} <span>·</span> {getString(animal, "sex") ? t(getString(animal, "sex")) : "—"} <span>·</span> {getString(animal, "identifier") || t("identifierMissing")}</p>
          {getString(animal, "morph") && <p className="animal-hero-morph">{getString(animal, "morph")}</p>}
        </div>
      </div>
      <div className="animal-hero-actions">
        <Button variant="secondary" onClick={() => window.print()}><Icon name="download" size={16} />{locale === "it" ? "Stampa / PDF" : "Print / PDF"}</Button><Button variant="secondary" onClick={() => void downloadInternalQr()} disabled={internalQrBusy}><Icon name="qr-code" size={16} />{locale === "it" ? "QR interno" : "Internal QR"}</Button><Button variant="secondary" onClick={openAnimalEdit}><Icon name="edit" size={16} />{t("edit")}</Button>
        {isArchived && <Button onClick={() => void restoreAnimal()}><Icon name="restore" size={16} />{t("restoreAnimal")}</Button>}
      </div>
    </section>
    {isArchived && <Alert tone="warning">{t("archivedAnimalNotice")}</Alert>}
    <section className="animal-summary-grid" aria-label={t("recentActivity")}>
      <article className="animal-summary-card">
        <span>{t("lastWeight")}</span>
        {summaryWeights.loading && !summaryWeights.data ? <strong>…</strong> : summaryWeights.error ? <><strong className="animal-summary-empty">{t("summaryUnavailable")}</strong><button className="text-link" onClick={summaryWeights.reload}>{t("retry")}</button></> : latestWeight ? <><strong>{formatWeight(latestWeight.weightG, locale)}</strong><small>{formatDate(latestWeight.measuredAt, locale)}</small></> : <strong className="animal-summary-empty">{t("notRecorded")}</strong>}
      </article>
      <article className="animal-summary-card">
        <span>{t("lastFeeding")}</span>
        {summaryFeedings.loading && !summaryFeedings.data ? <strong>…</strong> : summaryFeedings.error ? <><strong className="animal-summary-empty">{t("summaryUnavailable")}</strong><button className="text-link" onClick={summaryFeedings.reload}>{t("retry")}</button></> : latestFeedingSession && latestFeedingEntry ? <><strong>{formatDate(latestFeedingSession.performedAt, locale)}</strong><small>{t(getString(latestFeedingEntry, "outcome") === "unknown" ? "feedingUnknown" : getString(latestFeedingEntry, "outcome"))}</small></> : <strong className="animal-summary-empty">{t("notRecorded")}</strong>}
      </article>
    </section>
    <div className="animal-profile-actions animal-quick-actions">
      <Button variant="secondary" disabled={isArchived} onClick={() => navigate(`/feeding?animalId=${encodeURIComponent(id)}&create=1`)}><Icon name="feed" size={15} />{t("newFeeding")}</Button>
      <Button variant="secondary" disabled={isArchived} onClick={() => openRecord("weight")}><Icon name="weight" size={15} />{t("addWeight")}</Button>
      <Button variant="secondary" disabled={isArchived} onClick={() => openRecord("shed")}><Icon name="refresh" size={15} />{t("addShed")}</Button>
      <Button variant="secondary" disabled={isArchived} onClick={() => openRecord("note")}><Icon name="file" size={15} />{t("addNote")}</Button>
    </div>
    <div className="tabs-line" role="tablist">{tabItems.map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "selected" : ""} onClick={() => setTab(key)}>{label}</button>)}</div>

    {tab === "overview" && <div className="detail-grid">
      <AnimalFeedingInsights id={id} locale={locale} readOnly={isArchived} />
      {animal.originOffspringBatchId && <Panel>
        <PanelHeader title={locale === "it" ? "Crescita e prime cure" : "Hatchling care"} action={!isArchived ? <Button size="sm" variant="secondary" onClick={openHatchlingCare}>{locale === "it" ? "Aggiorna tappe" : "Update milestones"}</Button> : undefined} />
        <div className="detail-fields">
          <Detail label={locale === "it" ? "Prime alimentazioni" : "Feedings"} value={hatchlingCare.data ? `${hatchlingCare.data.acceptedFeedings}/${hatchlingCare.data.feedingCount} ${locale === "it" ? "accettate" : "accepted"}` : "—"} />
          <Detail label={locale === "it" ? "Misurazioni peso" : "Weight records"} value={String(hatchlingCare.data?.weights.length ?? 0)} />
          <Detail label={locale === "it" ? "Mute registrate" : "Sheds recorded"} value={String(hatchlingCare.data?.sheds.length ?? 0)} />
          <Detail label={locale === "it" ? "Prima alimentazione" : "First feeding"} value={formatDate(hatchlingCare.data?.care?.firstFeedingAt ?? "", locale)} />
          <Detail label={locale === "it" ? "Prima alimentazione accettata" : "First feeding accepted"} value={hatchlingCare.data?.care?.firstFeedingAccepted == null ? "—" : hatchlingCare.data.care.firstFeedingAccepted ? (locale === "it" ? "Sì" : "Yes") : (locale === "it" ? "No" : "No")} />
          <Detail label={locale === "it" ? "Prima muta" : "First shed"} value={formatDate(hatchlingCare.data?.care?.firstShedAt ?? "", locale)} />
          <Detail label={locale === "it" ? "Pronto per cessione dal" : "Ready for rehoming"} value={formatDate(hatchlingCare.data?.care?.readyForRehomingAt ?? "", locale)} />
          <Detail label={locale === "it" ? "Stato di salute" : "Health status"} value={({ unknown: locale === "it" ? "Non valutato" : "Unknown", healthy: locale === "it" ? "Regolare" : "Healthy", monitoring: locale === "it" ? "Da monitorare" : "Monitoring", treatment: locale === "it" ? "In trattamento" : "Under treatment" } as Record<string,string>)[hatchlingCare.data?.care?.healthStatus ?? "unknown"]} />
        </div>
        {hatchlingCare.data?.care?.healthNotes && <p className="detail-copy">{locale === "it" ? "Note sanitarie: " : "Health notes: "}{hatchlingCare.data.care.healthNotes}</p>}
        {hatchlingCare.data?.care?.notes && <p className="detail-copy">{hatchlingCare.data.care.notes}</p>}
        <p className="muted-note">{locale === "it" ? "Le alimentazioni, i pesi e le mute provengono dai normali registri di cura dell'animale." : "Feedings, weights and sheds are sourced from the animal's standard care records."}</p>
      </Panel>}
            <Panel><PanelHeader title={t("overview")} /><div className="detail-fields">
        <Detail label={t("identifier")} value={getString(animal, "identifier")} /><Detail label={t("species")} value={getString(animal, "species")} />
        <Detail label={t("sex")} value={getString(animal, "sex") ? t(getString(animal, "sex")) : ""} /><Detail label={t("morph")} value={getString(animal, "morph")} />
        <Detail label={t("birthDate")} value={formatDate(getString(animal, "birthDate"), locale)} /><Detail label={t("acquiredDate")} value={formatDate(getString(animal, "acquiredDate"), locale)} />
        <Detail label={t("location")} value={getString(animal, "locationLabel")} /><Detail label={t("previousBreeder")} value={getString(animal, "previousBreeder")} />
      </div></Panel>
      <Panel>
        <PanelHeader title={locale === "it" ? "Genealogia" : "Genealogy"} description={locale === "it" ? "Apri i genitori per consultare anche le generazioni precedenti." : "Open either parent to inspect earlier generations."} />
        <div className="detail-fields">
          <div className="detail-field"><span>{locale === "it" ? "Madre" : "Mother"}</span>{animal.mother ? <button className="text-link" onClick={() => navigate(`/animals/${encodeURIComponent(animal.mother!.id)}`)}>{animal.mother.name}{animal.mother.morph ? ` · ${animal.mother.morph}` : ""}</button> : <strong>{getString(animal, "motherDescription") || "—"}</strong>}</div>
          <div className="detail-field"><span>{locale === "it" ? "Padre" : "Father"}</span>{animal.father ? <button className="text-link" onClick={() => navigate(`/animals/${encodeURIComponent(animal.father!.id)}`)}>{animal.father.name}{animal.father.morph ? ` · ${animal.father.morph}` : ""}</button> : <strong>{getString(animal, "fatherDescription") || "—"}</strong>}</div>
          <div className="detail-field"><span>{locale === "it" ? "Covata di provenienza" : "Source clutch"}</span>{animal.originClutchId ? <button className="text-link" onClick={() => navigate(`/clutches/${encodeURIComponent(animal.originClutchId!)}`)}>{locale === "it" ? "Apri covata" : "Open clutch"}</button> : <strong>—</strong>}</div>
        </div>
        <p className="muted-note">{locale === "it" ? "La genealogia completa si esplora seguendo i collegamenti dei genitori, generazione dopo generazione." : "Explore the full pedigree by following parent links, generation by generation."}</p>
      </Panel>
      <Panel><PanelHeader title={t("genetics")} /><p className="detail-copy">{getString(animal, "geneticsNotes") || t("noRecords")}</p><PanelHeader title={t("origin")} /><p className="detail-copy">{getString(animal, "originDescription") || t("noRecords")}</p><PanelHeader title={t("animalNotes")} /><p className="detail-copy">{getString(animal, "notes") || t("noRecords")}</p></Panel>

    </div>}

    {tab === "history" && <div className="page-stack">
      <div className="detail-grid">
        <Panel>
          <PanelHeader title={t("feedingHistory")} action={!isArchived ? <Button size="sm" onClick={() => navigate("/feeding?animalId=" + encodeURIComponent(id) + "&create=1")}><Icon name="feed" size={14} />{t("newFeeding")}</Button> : undefined} />
          {feedings.loading && !feedings.data ? <LoadingState /> : feedings.error ? <ErrorState message={feedings.error.message} retry={feedings.reload} /> : feedings.data?.sessions.length ? <div className="session-list">
            {feedings.data.sessions.map((session) => {
              const entries = session.entries;
              const entry = entries.find((candidate) => getString(candidate, "animalId") === id);
              if (!entry) return null;
              const outcomeValue = getString(entry, "outcome");
              const foodWeight = getString(entry, "foodWeightG");
              return <article className="session-card" key={getString(entry, "id")}>
                <div className="session-date">
                  <span>{formatDateTime(getString(session, "performedAt"), locale)}</span>
                  <Badge tone={outcomeValue === "ate" ? "success" : outcomeValue === "refused" ? "warning" : "neutral"}>{t(outcomeValue === "unknown" ? "feedingUnknown" : outcomeValue)}</Badge>
                </div>
                <div className="feeding-entry">
                  <div className="feeding-detail">
                    <span>{getString(entry, "foodType") || "—"} · {getString(entry, "foodSize") || "—"}</span>
                    {foodWeight ? <small>{formatWeight(foodWeight, locale)}</small> : null}
                  </div>
                  {!isArchived && <div className="row-actions">
                    <IconButton label={t("edit")} onClick={() => openFeedingEdit(session, entry)}><Icon name="edit" size={15} /></IconButton>
                    <IconButton label={t("delete")} onClick={() => void deleteFeedingEntry(entry)}><Icon name="trash" size={15} /></IconButton>
                  </div>}
                </div>
                {getString(entry, "notes") && <p className="muted-note">{getString(entry, "notes")}</p>}
                {getString(session, "notes") && <p className="muted-note">{getString(session, "notes")}</p>}
              </article>;
            })}
          </div> : <EmptyState title={t("noFeedings")} description={t("emptyHint")} />}
          {feedings.data?.pagination && <Pagination page={feedings.data.pagination.page} totalPages={feedings.data.pagination.totalPages} onChange={setFeedingPage} label={t("page")} />}
        </Panel>
        <Panel><PanelHeader title={t("weightHistory")} action={!isArchived ? <Button size="sm" onClick={() => openRecord("weight")}><Icon name="plus" size={14} />{t("addWeight")}</Button> : undefined} />
          <WeightChart weights={weights.data?.weights ?? []} locale={locale} />
          <RecordList readOnly={isArchived} records={weights.data?.weights ?? []} kind="weight" locale={locale} onEdit={(record) => openRecord("weight", record)} onDelete={(record) => void deleteRecord("weight", record)} />
        </Panel>
        <Panel><PanelHeader title={t("addShed")} action={!isArchived ? <Button size="sm" onClick={() => openRecord("shed")}><Icon name="plus" size={14} />{t("add")}</Button> : undefined} />
          <RecordList readOnly={isArchived} records={sheds.data?.sheds ?? []} kind="shed" locale={locale} onEdit={(record) => openRecord("shed", record)} onDelete={(record) => void deleteRecord("shed", record)} />
        </Panel>
        <Panel><PanelHeader title={t("animalNotes")} action={!isArchived ? <Button size="sm" onClick={() => openRecord("note")}><Icon name="plus" size={14} />{t("add")}</Button> : undefined} />
          <RecordList readOnly={isArchived} records={notes.data?.notes ?? []} kind="note" locale={locale} onEdit={(record) => openRecord("note", record)} onDelete={(record) => void deleteRecord("note", record)} />
        </Panel>
      </div>
      <AnimalMovementHistory id={id} locale={locale} readOnly={isArchived} onTransferRecorded={animalResource.reload} />
    </div>}

    {tab === "documents" && <Panel><PanelHeader title={t("documentsTab")} action={!isArchived ? <Button onClick={() => navigate(`/documents?animalId=${id}`)}><Icon name="upload" size={15} />{t("uploadDocument")}</Button> : undefined} />
      {documents.data?.documents?.length ? <DataTable headers={[t("name"), t("documentCategory"), t("date"), t("actions")]} rows={documents.data.documents.map((doc) => [
        <strong>{getString(doc, "originalFilename")}</strong>, getString(doc, "category"), formatDate(getString(doc, "createdAt"), locale),
        <div className="row-actions"><IconButton label={t("download")} onClick={() => void api.download(`/documents/${getString(doc, "id")}/download`, getString(doc, "originalFilename", "document"))}><Icon name="download" /></IconButton></div>
      ])} empty={t("noDocuments")} /> : <EmptyState title={t("noDocuments")} description={t("emptyHint")} />}</Panel>}

    {tab === "traits" && <Panel>
      <PanelHeader title={t("traits")} action={!isArchived ? <Button onClick={() => openGeneticTrait()}><Icon name="plus" size={15} />{t("addGeneticTrait")}</Button> : undefined} />
      {traits.loading && !traits.data ? <LoadingState /> : traits.error ? <ErrorState message={traits.error.message} retry={traits.reload} /> : traits.data?.traits?.length ? traits.data.traits.map((trait) => (
        <div className="simple-row genetic-trait-row" key={trait.id}>
          <span className="simple-row-icon"><Icon name="leaf" /></span>
          <div className="genetic-trait-copy">
            <strong>{trait.traitName}</strong>
            <span>{trait.traitValue}{trait.genotype ? ` · ${trait.genotype}` : ""}{trait.inheritanceMode ? ` · ${trait.inheritanceMode}` : ""}</span>
            <small>{t("geneticSourceAnimal")}: {trait.sourceAnimal
              ? trait.sourceAnimal.name + (trait.sourceAnimal.identifier ? " · " + trait.sourceAnimal.identifier : "")
              : t("geneticSourceUnknown")}</small>
            {trait.confidenceNote && <small>{t("geneticConfidenceNote")}: {trait.confidenceNote}</small>}
          </div>
          {!isArchived && <div className="row-actions">
            <IconButton label={t("edit")} onClick={() => openGeneticTrait(trait)}><Icon name="edit" size={15} /></IconButton>
            <IconButton label={t("delete")} onClick={() => void deleteGeneticTrait(trait)}><Icon name="trash" size={15} /></IconButton>
          </div>}
        </div>
      )) : <EmptyState title={t("noRecords")} />}
    </Panel>}

    {tab === "share" && <PublicSharePanel animalId={id} locale={locale} hasPhoto={Boolean(getString(animal, "photoUrl"))} resource={share.data?.share ?? null} reload={share.reload} show={show} />}
    {hatchlingCareModal && <Modal title={locale === "it" ? "Prime cure del piccolo" : "Hatchling care milestones"} onClose={() => setHatchlingCareModal(false)}>
      <form className="form-stack" onSubmit={saveHatchlingCare}>
        <Field label={locale === "it" ? "Data prima alimentazione" : "First feeding date"}><Input type="date" value={hatchlingCareForm.firstFeedingAt} onChange={(e) => setHatchlingCareForm({ ...hatchlingCareForm, firstFeedingAt: e.target.value })} /></Field>
        <Field label={locale === "it" ? "Prima alimentazione accettata?" : "First feeding accepted?"}><Select value={hatchlingCareForm.firstFeedingAccepted} onChange={(e) => setHatchlingCareForm({ ...hatchlingCareForm, firstFeedingAccepted: e.target.value })}><option value="">{locale === "it" ? "Non registrato" : "Not recorded"}</option><option value="yes">{locale === "it" ? "Sì" : "Yes"}</option><option value="no">{locale === "it" ? "No" : "No"}</option></Select></Field>
        <Field label={locale === "it" ? "Data prima muta" : "First shed date"}><Input type="date" value={hatchlingCareForm.firstShedAt} onChange={(e) => setHatchlingCareForm({ ...hatchlingCareForm, firstShedAt: e.target.value })} /></Field>
        <Field label={locale === "it" ? "Pronto per cessione dal" : "Ready for rehoming from"}><Input type="date" value={hatchlingCareForm.readyForRehomingAt} onChange={(e) => setHatchlingCareForm({ ...hatchlingCareForm, readyForRehomingAt: e.target.value })} /></Field>
        <Field label={locale === "it" ? "Stato di salute" : "Health status"}><Select value={hatchlingCareForm.healthStatus} onChange={(e) => setHatchlingCareForm({ ...hatchlingCareForm, healthStatus: e.target.value })}><option value="unknown">{locale === "it" ? "Non valutato" : "Unknown"}</option><option value="healthy">{locale === "it" ? "Regolare" : "Healthy"}</option><option value="monitoring">{locale === "it" ? "Da monitorare" : "Monitoring"}</option><option value="treatment">{locale === "it" ? "In trattamento" : "Under treatment"}</option></Select></Field>
        <Field label={locale === "it" ? "Note sanitarie" : "Health notes"}><Textarea rows={2} value={hatchlingCareForm.healthNotes} onChange={(e) => setHatchlingCareForm({ ...hatchlingCareForm, healthNotes: e.target.value })} /></Field>

        <Field label={t("notes")}><Textarea rows={3} value={hatchlingCareForm.notes} onChange={(e) => setHatchlingCareForm({ ...hatchlingCareForm, notes: e.target.value })} /></Field>
        <div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setHatchlingCareModal(false)}>{t("cancel")}</Button><Button type="submit" disabled={hatchlingCareBusy}>{t("save")}</Button></div>
      </form>
    </Modal>}
    {traitModal && <Modal title={traitEdit ? t("editGeneticTrait") : t("addGeneticTrait")} onClose={() => setTraitModal(false)}>
      <form className="form-stack" onSubmit={saveGeneticTrait}>
        {traitError && <Alert tone="danger">{traitError}</Alert>}
        <Field label={t("traitName")}><Input required maxLength={160} value={traitForm.traitName} onChange={(e) => setTraitForm({ ...traitForm, traitName: e.target.value })} /></Field>
        <Field label={t("traitValue")}><Input required maxLength={240} value={traitForm.traitValue} onChange={(e) => setTraitForm({ ...traitForm, traitValue: e.target.value })} /></Field>
        <RemoteSelect
          label={t("geneticSourceAnimal")}
          value={traitForm.sourceAnimalId}
          onChange={(sourceAnimalId) => setTraitForm({ ...traitForm, sourceAnimalId })}
          endpoint="/animals"
          responseKey="animals"
          filters={{ status: "all" }}
          labelKey="name"
          secondaryKey="identifier"
          detailEndpoint={sourceAnimalDetailEndpoint}
          detailKey="animal"
          locale={locale}
        />
        {traitForm.sourceAnimalId === id && <Alert tone="danger">{t("geneticSelfSourceError")}</Alert>}
        <div className="form-grid">
          <Field label={locale === "it" ? "Modalità di ereditarietà" : "Inheritance mode"}>
            <Select value={traitForm.inheritanceMode} onChange={(e) => setTraitForm({ ...traitForm, inheritanceMode: e.target.value })}>
              <option value="">{locale === "it" ? "Non specificata" : "Not specified"}</option>
              <option value="autosomal_recessive">{locale === "it" ? "Recessiva autosomica" : "Autosomal recessive"}</option>
              <option value="incomplete_dominant">{locale === "it" ? "Dominanza incompleta / codominante" : "Incomplete dominance / codominant"}</option>
              <option value="dominant">{locale === "it" ? "Dominante" : "Dominant"}</option>
            </Select>
          </Field>
          <Field label={locale === "it" ? "Genotipo (es. Aa o allele1|allele2)" : "Genotype (e.g. Aa or allele1|allele2)"} hint={locale === "it" ? "Due alleli; usa | per nomi composti. Non dedurre il genotipo dal solo morph." : "Two alleles; use | for multi-character names. Never infer genotype from morph alone."}>
            <Input maxLength={25} value={traitForm.genotype} onChange={(e) => setTraitForm({ ...traitForm, genotype: e.target.value })} />
          </Field>
          <Field label={locale === "it" ? "Regole genotipo → fenotipo (JSON)" : "Genotype → phenotype rules (JSON)"} hint={locale === "it" ? 'Esempio: {"A|A":"Wild type","A|a":"Portatore","a|a":"Morph"}. Inserisci le stesse regole sui genitori dello stesso tratto.' : 'Example: {"A|A":"Wild type","A|a":"Carrier","a|a":"Morph"}. Use the same rules for both parents for this trait.'}>
            <Textarea rows={4} value={traitForm.phenotypeRules} onChange={(e) => setTraitForm({ ...traitForm, phenotypeRules: e.target.value })} placeholder='{"A|A":"Wild type","A|a":"Carrier","a|a":"Morph"}' />
          </Field>
          <Field label={locale === "it" ? "Attendibilità" : "Certainty"}>
            <Select value={traitForm.certainty} onChange={(e) => setTraitForm({ ...traitForm, certainty: e.target.value })}>
              <option value="confirmed">{locale === "it" ? "Confermato" : "Confirmed"}</option>
              <option value="carrier">{locale === "it" ? "Portatore noto" : "Known carrier"}</option>
              <option value="visual">{locale === "it" ? "Fenotipo osservato" : "Observed phenotype"}</option>
              <option value="possible">{locale === "it" ? "Possibile" : "Possible"}</option>
              <option value="unverified">{locale === "it" ? "Non verificato" : "Unverified"}</option>
            </Select>
          </Field>
        </div>
        <Field label={t("geneticConfidenceNote")} hint={t("geneticConfidenceHint")}>
          <Textarea rows={4} maxLength={10000} value={traitForm.confidenceNote} onChange={(e) => setTraitForm({ ...traitForm, confidenceNote: e.target.value })} />
        </Field>
        <div className="modal-actions">
          <Button variant="secondary" type="button" onClick={() => setTraitModal(false)}>{t("cancel")}</Button>
          <Button type="submit" disabled={traitBusy || traitForm.sourceAnimalId === id}>{traitBusy ? t("loading") : t("save")}</Button>
        </div>
      </form>
    </Modal>}
    {feedingEditEntry && <Modal title={t("edit")} onClose={() => setFeedingEditEntry(null)}>
      <form className="form-stack" onSubmit={saveFeedingEdit}>
        {feedingFormError && <Alert tone="danger">{feedingFormError}</Alert>}
        <Field label={t("feedingDate")}><Input required type="datetime-local" value={feedingEditForm.performedAt} onChange={(e) => setFeedingEditForm({ ...feedingEditForm, performedAt: e.target.value })} /></Field>
        <Field label={t("outcome")}><Select value={feedingEditForm.outcome} onChange={(e) => setFeedingEditForm({ ...feedingEditForm, outcome: e.target.value })}><option value="ate">{t("ate")}</option><option value="refused">{t("refused")}</option><option value="not_offered">{t("not_offered")}</option><option value="unknown">{t("feedingUnknown")}</option></Select></Field>
        <Field label={t("foodType")}><Input maxLength={120} value={feedingEditForm.foodType} onChange={(e) => setFeedingEditForm({ ...feedingEditForm, foodType: e.target.value })} /></Field>
        <Field label={t("foodSize")}><Input maxLength={120} value={feedingEditForm.foodSize} onChange={(e) => setFeedingEditForm({ ...feedingEditForm, foodSize: e.target.value })} /></Field>
        <Field label={`${t("foodWeight")} (${weightUnitLabel()})`}><Input type="number" min="0.01" step="0.01" value={feedingEditForm.foodWeightG} onChange={(e) => setFeedingEditForm({ ...feedingEditForm, foodWeightG: e.target.value })} /></Field>
        <Field label={t("notes")}><Textarea rows={3} value={feedingEditForm.notes} onChange={(e) => setFeedingEditForm({ ...feedingEditForm, notes: e.target.value })} /></Field>
        <div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setFeedingEditEntry(null)}>{t("cancel")}</Button><Button type="submit" disabled={feedingBusy}>{feedingBusy ? t("loading") : t("save")}</Button></div>
      </form>
    </Modal>}
    {animalEditModal && <Modal title={t("animalEdit")} onClose={() => setAnimalEditModal(false)} wide>
      <form className="form-stack" onSubmit={saveAnimalEdit}>
        {animalEditError && <Alert tone="danger">{animalEditError}</Alert>}
        <Field label={t("animalPhoto")} hint={t("animalPhotoHint")}>
          <Input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            if (!file) { setPhotoFile(null); return; }
            if (file.size > 5 * 1024 * 1024 || (file.type && !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
              setPhotoFile(null);
              setAnimalEditError(t("photoValidation"));
              e.target.value = "";
              return;
            }
            setAnimalEditError("");
            setPhotoFile(file);
          }} />
        </Field>
        {photoFile && <p className="muted-note">{photoFile.name}</p>}
        {getString(animal, "photoUrl") && <div className="animal-photo-editor">
          <img src={getString(animal, "photoUrl")} alt={t("animalPhoto")} />
          <Button type="button" size="sm" variant="danger" disabled={animalEditBusy} onClick={async () => {
            if (!window.confirm(t("confirmDelete"))) return;
            setAnimalEditBusy(true);
            try {
              await api.delete("/animals/" + id + "/photo");
              setPhotoFile(null);
              animalResource.reload();
              show(t("photoRemoved"));
            } catch (reason) {
              setAnimalEditError(reason instanceof ApiError ? reason.message : t("operationFailed"));
            } finally { setAnimalEditBusy(false); }
          }}>{t("removePhoto")}</Button>
        </div>}
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
          <Field label={t("status")}><Select disabled={isArchived} value={animalEditForm.status} onChange={(e) => setAnimalEditForm({ ...animalEditForm, status: e.target.value })}>{[...(isArchived ? ["archived"] : []), "active", "sold", "transferred", "deceased"].map((value) => <option value={value} key={value}>{t("animalStatus_" + value)}</option>)}</Select></Field>
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
        {recordKind === "weight" && <Field label={`${t("weight")} (${weightUnitLabel()})`}><Input required type="number" min="0.01" step="0.01" value={recordForm.weight} onChange={(e) => setRecordForm({ ...recordForm, weight: e.target.value })} /></Field>}
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

function RecordList({ records, kind, locale, onEdit, onDelete, readOnly = false }: { records: CareRecordDto[]; readOnly?: boolean; kind: "weight" | "shed" | "note"; locale: Locale; onEdit: (record: CareRecordDto) => void; onDelete: (record: CareRecordDto) => void }) {
  if (!records.length) return <EmptyState title={translate(locale, "noRecords")} />;
  return <div className="record-list">{records.map((record) => <div className="record-row" key={getString(record, "id")}><div><strong>{kind === "weight" ? formatWeight(getString(record, "weightG"), locale) : kind === "shed" ? getString(record, "outcome") : getString(record, "title") || getString(record, "category")}</strong><small>{formatDate(kind === "weight" ? getString(record, "measuredAt") : getString(record, "occurredAt"), locale)}</small>{kind === "note" && <p>{getString(record, "body")}</p>}</div>{!readOnly && <div className="row-actions"><IconButton label={translate(locale, "edit")} onClick={() => onEdit(record)}><Icon name="edit" size={15} /></IconButton><IconButton label={translate(locale, "delete")} onClick={() => onDelete(record)}><Icon name="trash" size={15} /></IconButton></div>}</div>)}</div>;
}

function WeightChart({ weights, locale }: { weights: WeightDto[]; locale: Locale }) {
  const points = [...weights].reverse().map((weight) => Number(weight.weightG)).filter((n) => Number.isFinite(n));
  if (points.length < 2) return <p className="muted-note">{translate(locale, "noWeights")}</p>;
  const min = Math.min(...points); const max = Math.max(...points); const range = Math.max(max - min, 1);
  const coords = points.map((value, index) => `${8 + index * (284 / (points.length - 1))},${84 - ((value - min) / range) * 64}`).join(" ");
  return <div className="chart-wrap"><svg viewBox="0 0 300 100" role="img" aria-label={translate(locale, "weightHistory")}><path d="M8 84H292" stroke="currentColor" opacity=".15" /><polyline points={coords} fill="none" stroke="var(--forest)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />{points.map((value, index) => <circle key={index} cx={8 + index * (284 / (points.length - 1))} cy={84 - ((value - min) / range) * 64} r="3.5" fill="var(--terracotta)" />)}</svg><div className="chart-caption"><span>{formatWeight(min, locale)}</span><span>{formatWeight(max, locale)}</span></div></div>;
}

function PublicSharePanel({ animalId, locale, hasPhoto, resource, reload, show }: { animalId: string; locale: Locale; hasPhoto: boolean; resource: PublicShareDto | null; reload: () => void; show: (message: string) => void }) {
  const t = (key: string) => translate(locale, key);
  const share = resource;
  const visible = share?.visibleFields ?? ["name", "species", "morph"];
  const [fields, setFields] = useState<string[]>(visible);
  const [description, setDescription] = useState(getString(share, "publicDescription"));
  const [enabled, setEnabled] = useState(Boolean(share?.isEnabled));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const options = ["name", "species", "morph", "sex", "birthDate", "photo"];
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
    <div className="field"><span className="field-label">{t("visibleFields")}</span><div className="checkbox-grid">{options.map((field) => <label className="checkbox-field" key={field}><input type="checkbox" checked={fields.includes(field)} disabled={field === "photo" && !hasPhoto && !fields.includes("photo")} onChange={(e) => setFields(e.target.checked ? [...fields, field] : fields.filter((item) => item !== field))} />{t(field)}</label>)}</div></div>
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