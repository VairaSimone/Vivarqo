import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { dateTimeInputToUtc, formatDateTime, formatWeight, getArray, getString, gramsToWeight, localDateTimeValue, queryString, weightToGrams, weightUnitLabel } from "../lib/domain";
import type { Locale } from "../lib/domain";
import { translate } from "../lib/i18n";
import { useResource } from "../hooks/useResource";
import { Alert, Badge, Button, DataTable, EmptyState, ErrorState, Field, Icon, IconButton, Input, LoadingState, Modal, PageHeader, Pagination, Panel, PanelHeader, Select, Textarea, useToast } from "../components/ui";

type Item = Record<string, unknown>;
type AnimalOption = { id: string; name: string; identifier?: string | null; species: string; status?: string };

export function CarePage({ locale, path, timezone }: { locale: Locale; path: string; timezone: string }) {
  const t = (key: string) => translate(locale, key);
  const queryParams = new URLSearchParams(path.includes("?") ? path.slice(path.indexOf("?")) : "");
  const [q, setQ] = useState("");
  const [animalId, setAnimalId] = useState(queryParams.get("animalId") ?? "");
  const [outcome, setOutcome] = useState("");
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(queryParams.get("create") === "1" || queryParams.get("bulk") === "1");
  const [bulk, setBulk] = useState(queryParams.get("bulk") === "1" || (queryParams.get("create") === "1" && !queryParams.get("animalId")));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [performedAt, setPerformedAt] = useState(localDateTimeValue(new Date(), timezone));
  const [sessionNotes, setSessionNotes] = useState("");
  const [animalSearch, setAnimalSearch] = useState("");
  const [animalPage, setAnimalPage] = useState(1);
  const [selected, setSelected] = useState<string[]>(queryParams.get("animalId") ? [queryParams.get("animalId")!] : []);
  const [entries, setEntries] = useState<Record<string, { outcome: string; foodType: string; foodSize: string; foodWeightG: string; notes: string }>>({});
  const [editEntry, setEditEntry] = useState<Item | null>(null);
  const [editData, setEditData] = useState({ outcome: "ate", foodType: "", foodSize: "", foodWeightG: "", notes: "" });
  const { toast, show } = useToast();

  const listUrl = "/feeding-sessions" + queryString({ page, pageSize: 25, animalId, outcome, q });
  const resource = useResource<{ sessions: Item[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>(listUrl);
  const animalsResource = useResource<{ animals: AnimalOption[]; pagination: { total: number; page: number; totalPages: number } }>(
    modal ? "/animals" + queryString({ page: animalPage, pageSize: 25, q: animalSearch, status: "active", sort: "name" }) : null
  );

  useEffect(() => { if (animalSearch) setAnimalPage(1); }, [animalSearch]);

  useEffect(() => {
    if (queryParams.get("create") === "1" || queryParams.get("bulk") === "1") {
      setBulk(queryParams.get("bulk") === "1" || (queryParams.get("create") === "1" && !queryParams.get("animalId")));
      setSelected(queryParams.get("animalId") ? [queryParams.get("animalId")!] : []);
      setPerformedAt(localDateTimeValue(new Date(), timezone));
      setModal(true);
    }
  }, [path, timezone]);

  function openNew(isBulk: boolean) {
    setBulk(isBulk); setModal(true); setError(""); setSelected(animalId ? [animalId] : []);
    setEntries({}); setPerformedAt(localDateTimeValue(new Date(), timezone)); setSessionNotes(""); setAnimalSearch(""); setAnimalPage(1);
  }

  function toggleAnimal(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  function updateEntry(id: string, field: string, value: string) {
    setEntries((current) => ({
      ...current,
      [id]: { ...(current[id] ?? { outcome: "ate", foodType: "", foodSize: "", foodWeightG: "", notes: "" }), [field]: value }
    }));
  }

  async function saveSession(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    if (selected.length === 0) {
      setError(t("selectAnimals"));
      setBusy(false);
      return;
    }
    try {
      const payload = {
        performedAt: dateTimeInputToUtc(performedAt, timezone),
        notes: sessionNotes || null,
        entries: selected.map((id) => {
          const entry = entries[id] ?? { outcome: "ate", foodType: "", foodSize: "", foodWeightG: "", notes: "" };
          return {
            animalId: id,
            outcome: entry.outcome,
            foodType: entry.foodType || null,
            foodSize: entry.foodSize || null,
            foodWeightG: entry.foodWeightG ? weightToGrams(entry.foodWeightG) : null,
            notes: entry.notes || null
          };
        })
      };
      await api.post("/feeding-sessions", payload);
      setModal(false);
      resource.reload();
      show(t("feedingCreated"));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : reason instanceof RangeError ? reason.message : t("operationFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function saveEntry(event: FormEvent) {
    event.preventDefault(); if (!editEntry) return; setBusy(true); setError("");
    const payload = {
      outcome: editData.outcome, foodType: editData.foodType || null, foodSize: editData.foodSize || null,
      foodWeightG: editData.foodWeightG ? weightToGrams(editData.foodWeightG) : null, notes: editData.notes || null
    };
    try { await api.patch(`/feeding-entries/${getString(editEntry, "id")}`, payload); setEditEntry(null); resource.reload(); show(t("saveSuccess")); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }

  async function deleteEntry(entry: Item) {
    if (!window.confirm(t("confirmDelete"))) return;
    try { await api.delete(`/feeding-entries/${getString(entry, "id")}`); resource.reload(); show(t("delete")); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }

  const animalResults = animalsResource.data?.animals ?? [];
  const totalPagesAnimals = animalsResource.data?.pagination?.totalPages ?? 1;
  const sessions = resource.data?.sessions ?? [];
  const pager = resource.data?.pagination;

  return <div className="page-stack">
    <PageHeader eyebrow={t("navAnimals")} title={t("feedingsTitle")} description={t("feedingsSubtitle")} action={<div className="inline-actions"><Button variant="secondary" onClick={() => openNew(false)}><Icon name="plus" size={15} />{t("registerFeeding")}</Button><Button onClick={() => openNew(true)}><Icon name="feed" size={15} />{t("bulkFeeding")}</Button></div>} />
    <Panel className="filters-panel"><div className="filter-row">
      <label className="search-control"><Icon name="search" /><input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder={t("search")} /></label>
      <Select aria-label={t("outcome")} value={outcome} onChange={(e) => { setOutcome(e.target.value); setPage(1); }}><option value="">{t("outcome")} · {t("all")}</option><option value="ate">{t("ate")}</option><option value="refused">{t("refused")}</option><option value="not_offered">{t("not_offered")}</option><option value="unknown">{t("feedingUnknown")}</option></Select>
      <Input placeholder={t("animalDetail")} value={animalId} onChange={(e) => { setAnimalId(e.target.value); setPage(1); }} />
    </div></Panel>
    <Panel>
      <div className="list-meta"><span>{pager?.total ?? 0} {t("rows")}</span><Button variant="ghost" size="sm" onClick={resource.reload}><Icon name="refresh" size={15} />{t("refresh")}</Button></div>
      {resource.loading && !resource.data ? <LoadingState /> : resource.error ? <ErrorState message={resource.error.message} retry={resource.reload} /> : sessions.length ? <div className="session-list">
        {sessions.map((session) => {
          const sessionEntries = getArray<Item>(session, "entries");
          return <article className="session-card" key={getString(session, "id")}>
            <div className="session-date"><span>{formatDateTime(getString(session, "performedAt"), locale)}</span><Badge>{sessionEntries.length} {t("feedingEntries")}</Badge></div>
            <div className="session-animals">{sessionEntries.map((entry) => {
              const animal = entry.animal as Item | undefined;
              const outcomeValue = getString(entry, "outcome");
              return <div className="feeding-entry" key={getString(entry, "id")}>
                <div className="animal-mini"><span className="animal-avatar"><Icon name="snake" size={14} /></span><span><strong>{getString(animal, "name") || t("noRecords")}</strong><small>{getString(animal, "species")}</small></span></div>
                <div className="feeding-detail"><Badge tone={outcomeValue === "ate" ? "success" : outcomeValue === "refused" ? "warning" : "neutral"}>{t(outcomeValue === "unknown" ? "feedingUnknown" : outcomeValue)}</Badge><span>{getString(entry, "foodType") || "—"} · {getString(entry, "foodSize") || "—"}</span>{entry.foodWeightG ? <small>{formatWeight(String(entry.foodWeightG), locale)}</small> : null}</div>
                <div className="row-actions"><IconButton label={t("edit")} onClick={() => {
                  setError("");
                  const foodWeightValue = getString(entry, "foodWeightG");
                  setEditData({
                    outcome: outcomeValue,
                    foodType: getString(entry, "foodType"),
                    foodSize: getString(entry, "foodSize"),
                    foodWeightG: foodWeightValue ? String(gramsToWeight(foodWeightValue)) : "",
                    notes: getString(entry, "notes"),
                  });
                  setEditEntry(entry);
                }}><Icon name="edit" size={15} /></IconButton><IconButton label={t("delete")} onClick={() => void deleteEntry(entry)}><Icon name="trash" size={15} /></IconButton></div>
              </div>;
            })}</div>
            {getString(session, "notes") && <p className="muted-note">{getString(session, "notes")}</p>}
          </article>;
        })}
      </div> : <EmptyState title={t("noFeedings")} description={t("emptyHint")} action={<Button onClick={() => openNew(true)}>{t("bulkFeeding")}</Button>} />}
      {pager && <Pagination page={pager.page} totalPages={pager.totalPages} onChange={setPage} label={t("page")} />}
    </Panel>

    {modal && <Modal title={bulk ? t("bulkFeeding") : t("registerFeeding")} onClose={() => setModal(false)} wide>
      <form className="form-stack" onSubmit={saveSession}>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="form-grid">
          <Field label={t("feedingDate")}><Input type="datetime-local" required value={performedAt} onChange={(e) => setPerformedAt(e.target.value)} /></Field>
          <Field label={t("notes")}><Input value={sessionNotes} onChange={(e) => setSessionNotes(e.target.value)} /></Field>
        </div>
        <div className="selector-header"><div><strong>{t("selectAnimals")}</strong><small>{selected.length} {t("selected")}</small></div><label className="search-control"><Icon name="search" /><input value={animalSearch} onChange={(e) => setAnimalSearch(e.target.value)} placeholder={t("search")} /></label></div>
        {animalsResource.loading && !animalsResource.data ? <LoadingState /> : <div className="animal-picker">
          {animalResults.map((animal) => <label className={`animal-option ${selected.includes(animal.id) ? "selected" : ""}`} key={animal.id}><input type="checkbox" checked={selected.includes(animal.id)} onChange={() => toggleAnimal(animal.id)} /><span className="animal-avatar"><Icon name="snake" size={14} /></span><span><strong>{animal.name}</strong><small>{animal.identifier || animal.species}</small></span><i>{selected.includes(animal.id) ? <Icon name="check" size={16} /> : null}</i></label>)}
          {!animalResults.length && <p className="muted-note">{t("noAnimals")}</p>}
        </div>}
        {totalPagesAnimals > 1 && <div className="pagination"><span>{t("page")} {animalPage} / {totalPagesAnimals}</span><div><Button size="sm" variant="secondary" disabled={animalPage <= 1} onClick={() => setAnimalPage((p) => p - 1)} type="button">←</Button><Button size="sm" variant="secondary" disabled={animalPage >= totalPagesAnimals} onClick={() => setAnimalPage((p) => p + 1)} type="button">→</Button></div></div>}
        {selected.length > 0 && <div className="feeding-per-animal"><div className="subsection-heading"><h3>{t("feedingEntries")}</h3><span>{selected.length}</span></div>
          {selected.map((id) => {
            const animal = animalResults.find((item) => item.id === id);
            const entry = entries[id] ?? { outcome: "ate", foodType: "", foodSize: "", foodWeightG: "", notes: "" };
            return <div className="feeding-animal-form" key={id}><div className="animal-mini"><span className="animal-avatar"><Icon name="snake" size={14} /></span><strong>{animal?.name || id}</strong></div>
              <div className="form-grid form-grid-small">
                <Field label={t("outcome")}><Select value={entry.outcome} onChange={(e) => updateEntry(id, "outcome", e.target.value)}><option value="ate">{t("ate")}</option><option value="refused">{t("refused")}</option><option value="not_offered">{t("not_offered")}</option><option value="unknown">{t("feedingUnknown")}</option></Select></Field>
                <Field label={t("foodType")}><Input value={entry.foodType} onChange={(e) => updateEntry(id, "foodType", e.target.value)} /></Field>
                <Field label={t("foodSize")}><Input value={entry.foodSize} onChange={(e) => updateEntry(id, "foodSize", e.target.value)} /></Field>
                <Field label={`${t("foodWeight")} (${weightUnitLabel()})`}><Input type="number" min="0.01" step="0.01" value={entry.foodWeightG} onChange={(e) => updateEntry(id, "foodWeightG", e.target.value)} /></Field>
              </div>
            </div>;
          })}
        </div>}
        <div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setModal(false)}>{t("cancel")}</Button><Button type="submit" disabled={busy || selected.length === 0}>{busy ? t("loading") : t("registerFeeding")}</Button></div>
      </form>
    </Modal>}

    {editEntry && <Modal title={t("edit")} onClose={() => setEditEntry(null)}>
      <form className="form-stack" onSubmit={saveEntry}>{error && <Alert tone="danger">{error}</Alert>}
        <Field label={t("outcome")}><Select value={editData.outcome} onChange={(e) => setEditData({ ...editData, outcome: e.target.value })}><option value="ate">{t("ate")}</option><option value="refused">{t("refused")}</option><option value="not_offered">{t("not_offered")}</option><option value="unknown">{t("feedingUnknown")}</option></Select></Field>
        <Field label={t("foodType")}><Input value={editData.foodType} onChange={(e) => setEditData({ ...editData, foodType: e.target.value })} /></Field>
        <Field label={t("foodSize")}><Input value={editData.foodSize} onChange={(e) => setEditData({ ...editData, foodSize: e.target.value })} /></Field>
        <Field label={`${t("foodWeight")} (${weightUnitLabel()})`}><Input type="number" min="0.01" step="0.01" value={editData.foodWeightG} onChange={(e) => setEditData({ ...editData, foodWeightG: e.target.value })} /></Field>
        <Field label={t("notes")}><Textarea rows={3} value={editData.notes} onChange={(e) => setEditData({ ...editData, notes: e.target.value })} /></Field>
        <div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setEditEntry(null)}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("save")}</Button></div>
      </form>
    </Modal>}
    {toast}
  </div>;
}