import { useState, type FormEvent } from "react";
import type { OffspringBatchDto, ReproductionCycleSummaryDto } from "@vivarqo/contracts/reproduction";
import { cycleStatuses } from "./types";
import { OffspringConversionModal } from "./OffspringConversionModal";
import { api, ApiError } from "../../lib/api";
import { celsiusToTemperature, formatDate, formatDateTime, formatTemperature, getArray, getString, localDateTimeValue, queryString, temperatureToCelsius, temperatureUnitLabel, todayDate } from "../../lib/domain";
import type { Locale } from "../../lib/domain";
import { translate } from "../../lib/i18n";
import { useResource } from "../../hooks/useResource";
import { RemoteSelect } from "../../components/RemoteSelect";
import { Alert, Badge, Button, DataTable, EmptyState, ErrorState, Field, Icon, IconButton, Input, LoadingState, Modal, PageHeader, Pagination, Panel, PanelHeader, Select, Textarea, useToast } from "../../components/ui";
export function CycleList({ locale, path, navigate }: { locale: Locale; path: string; navigate: (path: string) => void }) {
  const t = (key: string) => translate(locale, key);
  const params = new URLSearchParams(path.includes("?") ? path.slice(path.indexOf("?")) : "");
  const tab = params.get("tab") === "offspring" ? "offspring" : "cycles";
  const [page, setPage] = useState(1);
  const [batchPage, setBatchPage] = useState(1);
  const [status, setStatus] = useState("all");
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<ReproductionCycleSummaryDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cycleForm, setCycleForm] = useState({ name: "", startedOn: todayDate(), endedOn: "", status: "planned", parentAAnimalId: "", parentBAnimalId: "", notes: "" });
  const [offspringModal, setOffspringModal] = useState(false);
  const [conversionBatch, setConversionBatch] = useState<OffspringBatchDto | null>(null);
  const [conversionBusy, setConversionBusy] = useState(false);
  const [offspringForm, setOffspringForm] = useState({ cycleId: "", clutchId: "", bornOn: todayDate(), count: "1", notes: "" });
  const cycles = useResource<{ cycles: ReproductionCycleSummaryDto[]; pagination: { page: number; totalPages: number; total: number } }>(
    tab === "cycles" ? `/reproduction-cycles${queryString({ page, pageSize: 25, status })}` : null
  );
  const batches = useResource<{ offspringBatches: OffspringBatchDto[]; pagination: { page: number; totalPages: number; total: number } }>(
    tab === "offspring" ? `/offspring-batches${queryString({ page: batchPage, pageSize: 25 })}` : null
  );
  const { toast, show } = useToast();

  function openCycle(cycle?: ReproductionCycleSummaryDto) {
    setEditing(cycle ?? null);
    setCycleForm({
      name: getString(cycle, "name"), startedOn: getString(cycle, "startedOn") || todayDate(),
      endedOn: getString(cycle, "endedOn"), status: getString(cycle, "status", "planned"),
      parentAAnimalId: getString(cycle, "parentAAnimalId"), parentBAnimalId: getString(cycle, "parentBAnimalId"),
      notes: getString(cycle, "notes")
    });
    setError(""); setModal(true);
  }
  async function saveCycle(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const body = { name: cycleForm.name || null, startedOn: cycleForm.startedOn, endedOn: cycleForm.endedOn || null, status: cycleForm.status, parentAAnimalId: cycleForm.parentAAnimalId || null, parentBAnimalId: cycleForm.parentBAnimalId || null, notes: cycleForm.notes || null };
    try {
      if (editing) await api.patch(`/reproduction-cycles/${getString(editing, "id")}`, body);
      else await api.post("/reproduction-cycles", body);
      setModal(false); cycles.reload(); show(t("saveSuccess"));
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  async function deleteCycle(cycle: ReproductionCycleSummaryDto) {
    if (!window.confirm(t("confirmDelete"))) return;
    try { await api.delete(`/reproduction-cycles/${getString(cycle, "id")}`); cycles.reload(); show(t("delete")); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }
  async function convertBatchAnimals(names: string[], species: string) {
    if (!conversionBatch) return;
    setConversionBusy(true);
    try {
      await api.post(`/offspring-batches/${getString(conversionBatch, "id")}/animals`, { animals: names.map((name) => ({ name, species, sex: "unknown" })) });
      setConversionBatch(null); batches.reload(); show(t("saveSuccess"));
    } catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setConversionBusy(false); }
  }

  async function saveOffspring(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await api.post("/offspring-batches", { cycleId: offspringForm.cycleId, clutchId: offspringForm.clutchId || null, bornOn: offspringForm.bornOn, count: Number(offspringForm.count), notes: offspringForm.notes || null });
      setOffspringModal(false); setBatchPage(1); batches.reload(); show(t("saveSuccess"));
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }

  return <div className="page-stack">
    <PageHeader eyebrow={t("navBreeding")} title={t("breedingTitle")} description={t("breedingSubtitle")} action={<Button onClick={() => tab === "cycles" ? openCycle() : (setOffspringForm({ cycleId: "", clutchId: "", bornOn: todayDate(), count: "1", notes: "" }), setOffspringModal(true))}><Icon name="plus" />{tab === "cycles" ? t("newCycle") : t("addOffspring")}</Button>} />
    <div className="tabs-line"><button className={tab === "cycles" ? "selected" : ""} onClick={() => navigate("/reproduction")}>{t("cycles")}</button><button className={tab === "offspring" ? "selected" : ""} onClick={() => navigate("/reproduction?tab=offspring")}>{t("offspring")}</button></div>
    {tab === "cycles" ? <>
      <Panel className="filters-panel"><div className="filter-row"><Select aria-label={t("status")} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="all">{t("allStatuses")}</option>{cycleStatuses.map((value) => <option value={value} key={value}>{t(`cycleStatus_${value}`)}</option>)}</Select><span className="muted-note">{cycles.data?.pagination.total ?? 0} {t("cycles")}</span></div></Panel>
      {cycles.loading && !cycles.data ? <LoadingState /> : cycles.error ? <ErrorState message={cycles.error.message} retry={cycles.reload} /> :
        cycles.data?.cycles.length ? <div className="cycle-grid">{cycles.data.cycles.map((cycle) => {
          const parentA = cycle.parentA; const parentB = cycle.parentB; const count = cycle._count;
          return <article className="cycle-card" key={getString(cycle, "id")}>
            <div className="cycle-card-top"><span className="cycle-symbol"><Icon name="leaf" size={21} /></span><Badge tone={getString(cycle, "status") === "active" ? "success" : "neutral"}>{t(`cycleStatus_${getString(cycle, "status")}`)}</Badge></div>
            <button className="cycle-title" onClick={() => navigate(`/reproduction-cycles/${getString(cycle, "id")}`)}><strong>{getString(cycle, "name") || t("cycles")}</strong><span>{formatDate(getString(cycle, "startedOn"), locale)}{getString(cycle, "endedOn") ? ` – ${formatDate(getString(cycle, "endedOn"), locale)}` : ""}</span></button>
            <div className="cycle-parents"><span>{t("parentA")}: <b>{getString(parentA, "name") || "—"}</b></span><span>{t("parentB")}: <b>{getString(parentB, "name") || "—"}</b></span></div>
            <div className="cycle-card-bottom"><span>{Number(count?.events ?? 0)} {t("events")} · {Number(count?.clutches ?? 0)} {t("clutches")} · {Number(count?.offspringBatches ?? 0)} {t("offspring")}</span><div className="row-actions"><IconButton label={t("edit")} onClick={() => openCycle(cycle)}><Icon name="edit" /></IconButton><IconButton label={t("delete")} onClick={() => void deleteCycle(cycle)}><Icon name="trash" /></IconButton><IconButton label={t("details")} onClick={() => navigate(`/reproduction-cycles/${getString(cycle, "id")}`)}><Icon name="chevron" /></IconButton></div></div>
          </article>;
        })}</div> : status === "all" ? <EmptyState title={locale === "it" ? "Non hai ancora registrato riproduzioni" : "You haven't recorded any breeding cycles yet"} description={locale === "it" ? "Crea il tuo primo ciclo per collegare i riproduttori, annotare gli eventi e tenere sotto controllo covate e piccoli." : "Create your first cycle to link the breeding animals, record events and keep track of clutches and offspring."} action={<Button onClick={() => openCycle()}><Icon name="plus" size={15} />{locale === "it" ? "Crea il primo ciclo" : "Create your first cycle"}</Button>} /> : <EmptyState title={t("noRecords")} description={locale === "it" ? "Nessun ciclo corrisponde ai filtri selezionati." : "No cycles match the selected filters."} />
      {cycles.data?.pagination && <Pagination page={page} totalPages={cycles.data.pagination.totalPages} onChange={setPage} label={t("page")} />}
    </> : <Panel><PanelHeader title={t("offspring")} action={<Button onClick={() => setOffspringModal(true)}><Icon name="plus" />{t("addOffspring")}</Button>} />
      {batches.loading && !batches.data ? <LoadingState /> : batches.error ? <ErrorState message={batches.error.message} retry={batches.reload} /> :
        batches.data?.offspringBatches.length ? <div className="record-list">{batches.data.offspringBatches.map((batch) => <div className="record-row" key={getString(batch, "id")}><div><strong>{getString(batch, "count")} {t("offspring")}</strong><small>{formatDate(getString(batch, "bornOn"), locale)} · {getString(batch, "cycle") ? getString(batch.cycle, "name") : ""}</small><p>{getString(batch, "notes")}</p></div><div className="row-actions"><IconButton label={t("convertToAnimals")} onClick={() => setConversionBatch(batch)}><Icon name="plus" /></IconButton><IconButton label={t("details")} onClick={() => navigate(`/reproduction-cycles/${getString(batch, "cycleId")}`)}><Icon name="chevron" /></IconButton><IconButton label={t("delete")} onClick={() => { if (window.confirm(t("confirmDelete"))) void api.delete(`/offspring-batches/${getString(batch, "id")}`).then(() => batches.reload()).catch((reason) => show(reason instanceof ApiError ? reason.message : t("operationFailed"))); }}><Icon name="trash" /></IconButton></div></div>)}</div> : <EmptyState title={locale === "it" ? "Nessun piccolo registrato" : "No offspring recorded"} description={locale === "it" ? "Quando nasceranno i piccoli, registra qui il gruppo collegandolo al ciclo e alla covata." : "When offspring are born, record the batch here and link it to its cycle and clutch."} action={<Button size="sm" onClick={() => setOffspringModal(true)}><Icon name="plus" size={14} />{t("addOffspring")}</Button>} />}</Panel>}
    {tab === "offspring" && batches.data?.pagination && <Pagination page={batchPage} totalPages={batches.data.pagination.totalPages} onChange={setBatchPage} label={t("page")} />}
    {conversionBatch && <OffspringConversionModal key={getString(conversionBatch, "id")} batch={conversionBatch} locale={locale} busy={conversionBusy} onClose={() => setConversionBatch(null)} onSubmit={convertBatchAnimals} />}

    {modal && <Modal title={editing ? t("edit") : t("newCycle")} onClose={() => setModal(false)} wide>
      <form className="form-stack" onSubmit={saveCycle}>{error && <Alert tone="danger">{error}</Alert>}
        <Field label={t("cycleName")}><Input value={cycleForm.name} onChange={(e) => setCycleForm({ ...cycleForm, name: e.target.value })} /></Field>
        <div className="form-grid"><Field label={t("startedOn")}><Input required type="date" value={cycleForm.startedOn} onChange={(e) => setCycleForm({ ...cycleForm, startedOn: e.target.value })} /></Field><Field label={t("endedOn")}><Input type="date" value={cycleForm.endedOn} onChange={(e) => setCycleForm({ ...cycleForm, endedOn: e.target.value })} /></Field>
        <Field label={t("status")}><Select value={cycleForm.status} onChange={(e) => setCycleForm({ ...cycleForm, status: e.target.value })}>{cycleStatuses.map((value) => <option value={value} key={value}>{t(`cycleStatus_${value}`)}</option>)}</Select></Field></div>
        <div className="form-grid">
          <RemoteSelect label={t("parentA")} value={cycleForm.parentAAnimalId} onChange={(parentAAnimalId) => setCycleForm({ ...cycleForm, parentAAnimalId })} endpoint="/animals" responseKey="animals" filters={{ status: "active", sort: "name" }} detailEndpoint={(id) => `/animals/${encodeURIComponent(id)}`} detailKey="animal" locale={locale} />
          <RemoteSelect label={t("parentB")} value={cycleForm.parentBAnimalId} onChange={(parentBAnimalId) => setCycleForm({ ...cycleForm, parentBAnimalId })} endpoint="/animals" responseKey="animals" filters={{ status: "active", sort: "name" }} detailEndpoint={(id) => `/animals/${encodeURIComponent(id)}`} detailKey="animal" locale={locale} />
        </div>
        <Field label={t("notes")}><Textarea rows={3} value={cycleForm.notes} onChange={(e) => setCycleForm({ ...cycleForm, notes: e.target.value })} /></Field>
        <div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setModal(false)}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("save")}</Button></div>
      </form>
    </Modal>}
    {offspringModal && <Modal title={t("addOffspring")} onClose={() => setOffspringModal(false)}>
      <form className="form-stack" onSubmit={saveOffspring}>{error && <Alert tone="danger">{error}</Alert>}
        <RemoteSelect label={t("cycles")} value={offspringForm.cycleId} onChange={(cycleId) => setOffspringForm({ ...offspringForm, cycleId })} endpoint="/reproduction-cycles" responseKey="cycles" filters={{ status: "all" }} detailEndpoint={(id) => `/reproduction-cycles/${encodeURIComponent(id)}`} detailKey="cycle" locale={locale} />
        <div className="form-grid"><Field label={t("bornOn")}><Input required type="date" value={offspringForm.bornOn} onChange={(e) => setOffspringForm({ ...offspringForm, bornOn: e.target.value })} /></Field><Field label={t("count")}><Input required type="number" min="0" max="10000" value={offspringForm.count} onChange={(e) => setOffspringForm({ ...offspringForm, count: e.target.value })} /></Field></div>
        <Field label={t("notes")}><Textarea rows={2} value={offspringForm.notes} onChange={(e) => setOffspringForm({ ...offspringForm, notes: e.target.value })} /></Field>
        <div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setOffspringModal(false)}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("save")}</Button></div>
      </form>
    </Modal>}
    {toast}
  </div>;
}