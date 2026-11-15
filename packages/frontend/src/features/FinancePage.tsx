import { useState, type FormEvent } from "react";
import { parseFinanceEntriesResponse, parseFinanceSummaryResponse } from "@vivarqo/contracts/finance";
import type { FinanceEntriesResponseDto, FinanceEntryDto, FinanceSummaryDto } from "@vivarqo/contracts/finance";
import { api, ApiError } from "../lib/api";
import { amountToCents, formatDate, formatMoneyCents, getString, queryString, todayDate } from "../lib/domain";
import type { Locale } from "../lib/domain";
import { translate } from "../lib/i18n";
import { useResource } from "../hooks/useResource";
import { RemoteSelect } from "../components/RemoteSelect";
import { Alert, Badge, Button, DataTable, EmptyState, ErrorState, Field, Icon, IconButton, Input, LoadingState, Modal, PageHeader, Pagination, Panel, PanelHeader, Select, useToast } from "../components/ui";

export function FinancePage({ locale }: { locale: Locale }) {
  const t = (key: string) => translate(locale, key);
  const [page, setPage] = useState(1);
  const [entryType, setEntryType] = useState("");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<FinanceEntryDto | null>(null);
  const [form, setForm] = useState({ entryType: "expense", occurredOn: todayDate(), amount: "", currency: "EUR", category: "", description: "", animalId: "", documentId: "", reproductionCycleId: "", clutchId: "", offspringBatchId: "" });
  const currentDate = new Date();
  const [budgetPeriod, setBudgetPeriod] = useState<"month" | "year">("month");
  const [budgetYear, setBudgetYear] = useState(currentDate.getFullYear());
  const [budgetMonth, setBudgetMonth] = useState(currentDate.getMonth() + 1);
  const [budgetCategory, setBudgetCategory] = useState("all");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [recurrenceForm, setRecurrenceForm] = useState({ entryType: "expense", amount: "", currency: "EUR", category: "", description: "", frequency: "monthly", nextOccurrenceOn: todayDate(), endOn: "", animalId: "" });
  const [recurrenceBusy, setRecurrenceBusy] = useState(false);
  const [recurrenceError, setRecurrenceError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [formDirty, setFormDirty] = useState(false);
  const { toast, show } = useToast();
  const url = "/finance/entries" + queryString({ page, pageSize: 25, entryType, category, q, from, to });
  const resource = useResource<FinanceEntriesResponseDto>(url, parseFinanceEntriesResponse);
  const summary = useResource<FinanceSummaryDto>(
    "/finance/summary" + queryString({ from, to, currency: "EUR" }), parseFinanceSummaryResponse
  );
  const budgetUrl = "/finance/budgets" + queryString({ period: budgetPeriod, year: budgetYear, month: budgetMonth, currency: "EUR" });
  const budgets = useResource<{ budgets: Array<Record<string, unknown>> }>(budgetUrl);
  const recurrences = useResource<{ recurrences: Array<Record<string, unknown>> }>("/finance/recurrences");
  const profitability = useResource<Record<string, unknown>>("/finance/profitability" + queryString({ from, to, currency: "EUR" }));

  function openForm(entry?: FinanceEntryDto) {
    setEditing(entry ?? null);
    setForm({
      entryType: getString(entry, "entryType", "expense"),
      occurredOn: getString(entry, "occurredOn").slice(0, 10) || todayDate(),
      amount: entry ? (Number(getString(entry, "amountCents")) / 100).toFixed(2) : "",
      currency: getString(entry, "currency", "EUR"),
      category: getString(entry, "category"),
      description: getString(entry, "description"),
      animalId: getString(entry, "animalId"),
      documentId: getString(entry, "documentId"),
      reproductionCycleId: getString(entry, "reproductionCycleId"),
      clutchId: getString(entry, "clutchId"),
      offspringBatchId: getString(entry, "offspringBatchId")
    });
    setError(""); setFormDirty(false); setModal(true);
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try {
      const body = {
        entryType: form.entryType,
        occurredOn: form.occurredOn,
        amountCents: amountToCents(form.amount),
        currency: form.currency.toUpperCase(),
        category: form.category,
        description: form.description,
        animalId: form.animalId || null,
        documentId: form.documentId || null,
        reproductionCycleId: form.reproductionCycleId || null,
        clutchId: form.clutchId || null,
        offspringBatchId: form.offspringBatchId || null
      };
      if (editing) await api.patch(`/finance/entries/${getString(editing, "id")}`, body);
      else await api.post("/finance/entries", body);
      setModal(false); setFormDirty(false); resource.reload(); summary.reload(); show(t("saveSuccess"));
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : reason instanceof Error ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  async function remove(entry: FinanceEntryDto) {
    if (!window.confirm(t("confirmDelete"))) return;
    try { await api.delete(`/finance/entries/${getString(entry, "id")}`); resource.reload(); summary.reload(); show(t("delete")); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }

  const periodStart = budgetPeriod === "month"
    ? `${budgetYear}-${String(budgetMonth).padStart(2, "0")}-01`
    : `${budgetYear}-01-01`;
  async function saveBudget() {
    try {
      await api.post("/finance/budgets", { period: budgetPeriod, periodStart, category: budgetCategory, amountCents: amountToCents(budgetAmount), currency: "EUR" });
      setBudgetAmount(""); budgets.reload(); show(locale === "it" ? "Budget salvato." : "Budget saved.");
    } catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }
  async function saveRecurrence(event: FormEvent) {
    event.preventDefault(); if (recurrenceBusy) return; setRecurrenceBusy(true); setRecurrenceError("");
    try {
      await api.post("/finance/recurrences", {
        ...recurrenceForm, amountCents: amountToCents(recurrenceForm.amount),
        nextOccurrenceOn: recurrenceForm.nextOccurrenceOn, endOn: recurrenceForm.endOn || null,
        animalId: recurrenceForm.animalId || null
      });
      setRecurrenceForm({ entryType: "expense", amount: "", currency: "EUR", category: "", description: "", frequency: "monthly", nextOccurrenceOn: todayDate(), endOn: "", animalId: "" });
      recurrences.reload(); show(locale === "it" ? "Ricorrenza creata." : "Recurring entry created.");
    } catch (reason) { setRecurrenceError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setRecurrenceBusy(false); }
  }
  async function generateRecurrence(id: string) {
    try {
      const result = await api.post<{ generated: number }>(`/finance/recurrences/${id}/generate`);
      resource.reload(); summary.reload(); recurrences.reload();
      show(locale === "it" ? `Registrate ${result.generated} occorrenze.` : `Generated ${result.generated} entries.`);
    } catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }
  async function deleteBudget(id: string) {
    try { await api.delete(`/finance/budgets/${id}`); budgets.reload(); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }
  async function updateRecurrence(id: string, isActive: boolean) {
    try { await api.patch(`/finance/recurrences/${id}`, { isActive }); recurrences.reload(); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }
  async function deleteRecurrence(id: string) {
    if (!window.confirm(locale === "it" ? "Eliminare questa regola ricorrente? Le registrazioni già create resteranno nel registro." : "Delete this recurring rule? Entries already generated will remain in the ledger.")) return;
    try { await api.delete(`/finance/recurrences/${id}`); recurrences.reload(); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }

  const categories = summary.data?.categories ?? [];
  const maxCategory = Math.max(1, ...categories.map((item) => Number(getString(item, "amountCents")) || 0));
  const rows = (resource.data?.entries ?? []).map((entry) => [
    formatDate(getString(entry, "occurredOn"), locale),
    <div><strong>{getString(entry, "description")}</strong><small>{getString(entry, "category")}</small></div>,
    <Badge tone={getString(entry, "entryType") === "income" ? "success" : "warning"}>{t(getString(entry, "entryType"))}</Badge>,
    <strong className="number-cell">{formatMoneyCents(getString(entry, "amountCents"), locale, getString(entry, "currency", "EUR"))}</strong>,
    <div className="row-actions"><IconButton label={t("edit")} onClick={() => openForm(entry)}><Icon name="edit" /></IconButton><IconButton label={t("delete")} onClick={() => void remove(entry)}><Icon name="trash" /></IconButton></div>
  ]);

  return <div className="page-stack">
    <PageHeader eyebrow={t("navAdmin")} title={t("financeTitle")} description={t("financeSubtitle")} action={<Button onClick={() => openForm()}><Icon name="plus" />{t("newEntry")}</Button>} />
    <div className="metric-grid finance-metrics">
      <FinanceMetric label={t("income")} value={summary.data?.incomeCents ?? "0"} locale={locale} tone="success" />
      <FinanceMetric label={t("expense")} value={summary.data?.expenseCents ?? "0"} locale={locale} tone="warning" />
      <FinanceMetric label={t("balance")} value={summary.data?.balanceCents ?? "0"} locale={locale} tone="primary" />
    </div>
    <Panel className="filters-panel"><div className="filter-row">
      <label className="search-control"><Icon name="search" /><input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder={t("search")} /></label>
      <Select aria-label={t("type")} value={entryType} onChange={(e) => { setEntryType(e.target.value); setPage(1); }}><option value="">{t("all")}</option><option value="income">{t("income")}</option><option value="expense">{t("expense")}</option></Select>
      <Input placeholder={t("category")} value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} />
      <Input aria-label={t("from")} type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
      <Input aria-label={t("to")} type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
    </div></Panel>
    <div className="finance-grid">
      <Panel><div className="list-meta"><span>{resource.data?.pagination.total ?? 0} {t("rows")}</span><Button size="sm" variant="ghost" onClick={resource.reload}><Icon name="refresh" />{t("refresh")}</Button></div>
        {resource.loading && !resource.data ? <LoadingState /> : resource.error ? <ErrorState message={resource.error.message} retry={resource.reload} /> : <DataTable headers={[t("date"), t("description"), t("type"), t("amount"), t("actions")]} rows={rows} empty={t("noFinance")} />}
        {resource.data?.pagination && <Pagination page={page} totalPages={resource.data.pagination.totalPages} onChange={setPage} label={t("page")} />}
      </Panel>
      <Panel><PanelHeader title={locale === "it" ? "Ripartizione per categoria" : "Category breakdown"} />
        {summary.loading && !summary.data ? <LoadingState /> : categories.length ? <div className="category-breakdown">{categories.map((item, index) => {
          const cents = Number(getString(item, "amountCents")) || 0;
          return <div className="category-bar-row" key={`${getString(item, "entryType")}-${getString(item, "category")}-${index}`}><div><span>{getString(item, "category")}</span><strong>{formatMoneyCents(cents, locale)}</strong></div><div className="bar-track"><span style={{ width: `${Math.max(3, cents / maxCategory * 100)}%` }} /></div></div>;
        })}</div> : <EmptyState title={t("noRecords")} />}
      </Panel>
    </div>

    <div className="finance-management-grid">
      <Panel>
        <PanelHeader title={locale === "it" ? "Budget" : "Budgets"} />
        <div className="filter-row">
          <Select aria-label={locale === "it" ? "Periodo budget" : "Budget period"} value={budgetPeriod} onChange={(e) => setBudgetPeriod(e.target.value as "month" | "year")}>
            <option value="month">{locale === "it" ? "Mensile corrente" : "Current month"}</option>
            <option value="year">{locale === "it" ? "Annuale corrente" : "Current year"}</option>
          </Select>
          <Input aria-label={locale === "it" ? "Anno budget" : "Budget year"} type="number" min="2000" max="2200" value={budgetYear} onChange={(e) => setBudgetYear(Number(e.target.value) || currentDate.getFullYear())} />
          {budgetPeriod === "month" && <Select aria-label={locale === "it" ? "Mese budget" : "Budget month"} value={String(budgetMonth)} onChange={(e) => setBudgetMonth(Number(e.target.value))}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date(2026, index, 1))}</option>)}</Select>}
          <Input aria-label={locale === "it" ? "Categoria budget" : "Budget category"} value={budgetCategory} onChange={(e) => setBudgetCategory(e.target.value)} placeholder={locale === "it" ? "Categoria (o all)" : "Category (or all)"} />
          <Input aria-label={locale === "it" ? "Importo budget" : "Budget amount"} inputMode="decimal" value={budgetAmount} onChange={(e) => setBudgetAmount(e.target.value)} placeholder="0,00 €" />
          <Button disabled={!budgetAmount || !Number.isFinite(Number(budgetAmount.replace(",", "."))) || Number(budgetAmount.replace(",", ".")) <= 0} onClick={() => void saveBudget()}>{locale === "it" ? "Salva budget" : "Save budget"}</Button>
        </div>
        <div className="finance-detail-list">
          {(budgets.data?.budgets ?? []).map((budget) => {
            const spent = Number(getString(budget, "spentCents")) || 0;
            const limit = Number(getString(budget, "amountCents")) || 0;
            const pct = limit > 0 ? Math.min(100, spent / limit * 100) : 0;
            return <div className="finance-detail-row" key={getString(budget, "id")}>
              <div><strong>{getString(budget, "category") === "all" ? (locale === "it" ? "Tutte le categorie" : "All categories") : getString(budget, "category")}</strong><small>{formatMoneyCents(String(spent), locale)} / {formatMoneyCents(String(limit), locale)}</small></div>
              <div className="bar-track"><span className={pct >= 100 ? "budget-over" : ""} style={{ width: `${pct}%` }} /></div>
              <IconButton label={t("delete")} onClick={() => void deleteBudget(getString(budget, "id"))}><Icon name="trash" /></IconButton>
            </div>;
          })}
          {!budgets.loading && !(budgets.data?.budgets?.length) && <EmptyState title={locale === "it" ? "Nessun budget per questo periodo" : "No budgets for this period"} />}
        </div>
      </Panel>
      <Panel>
        <PanelHeader title={locale === "it" ? "Entrate e uscite ricorrenti" : "Recurring income and expenses"} />
        <form className="form-stack" onSubmit={saveRecurrence}>
          {recurrenceError && <Alert tone="danger">{recurrenceError}</Alert>}
          <div className="form-grid">
            <Field label={t("type")}><Select value={recurrenceForm.entryType} onChange={(e) => setRecurrenceForm({ ...recurrenceForm, entryType: e.target.value })}><option value="expense">{t("expense")}</option><option value="income">{t("income")}</option></Select></Field>
            <Field label={t("amount")}><Input required inputMode="decimal" value={recurrenceForm.amount} onChange={(e) => setRecurrenceForm({ ...recurrenceForm, amount: e.target.value })} /></Field>
            <Field label={t("category")}><Input required maxLength={80} value={recurrenceForm.category} onChange={(e) => setRecurrenceForm({ ...recurrenceForm, category: e.target.value })} /></Field>
            <Field label={t("descriptionFinance")}><Input required maxLength={240} value={recurrenceForm.description} onChange={(e) => setRecurrenceForm({ ...recurrenceForm, description: e.target.value })} /></Field>
            <Field label={locale === "it" ? "Frequenza" : "Frequency"}><Select value={recurrenceForm.frequency} onChange={(e) => setRecurrenceForm({ ...recurrenceForm, frequency: e.target.value })}><option value="monthly">{locale === "it" ? "Mensile" : "Monthly"}</option><option value="yearly">{locale === "it" ? "Annuale" : "Yearly"}</option></Select></Field>
            <Field label={locale === "it" ? "Prossima scadenza" : "Next due date"}><Input required type="date" value={recurrenceForm.nextOccurrenceOn} onChange={(e) => setRecurrenceForm({ ...recurrenceForm, nextOccurrenceOn: e.target.value })} /></Field>
            <Field label={locale === "it" ? "Fine (opzionale)" : "End date (optional)"}><Input type="date" value={recurrenceForm.endOn} onChange={(e) => setRecurrenceForm({ ...recurrenceForm, endOn: e.target.value })} /></Field>
            <RemoteSelect label={t("animalDetail")} value={recurrenceForm.animalId} onChange={(animalId) => setRecurrenceForm({ ...recurrenceForm, animalId })} endpoint="/animals" responseKey="animals" filters={{ status: "all", sort: "name" }} detailEndpoint={(id) => `/animals/${encodeURIComponent(id)}`} detailKey="animal" locale={locale} />
          </div>
          <Button type="submit" disabled={recurrenceBusy}>{locale === "it" ? "Crea ricorrenza" : "Create recurrence"}</Button>
        </form>
        <div className="finance-detail-list">
          {(recurrences.data?.recurrences ?? []).map((item) => <div className="finance-detail-row" key={getString(item, "id")}>
            <div><strong>{getString(item, "description")}</strong><small>{getString(item, "frequency") === "monthly" ? (locale === "it" ? "Mensile" : "Monthly") : (locale === "it" ? "Annuale" : "Yearly")} · {formatMoneyCents(getString(item, "amountCents"), locale)} · {formatDate(getString(item, "nextOccurrenceOn"), locale)}</small></div>
            <Badge tone={item.isActive ? "success" : "neutral"}>{item.isActive ? (locale === "it" ? "Attiva" : "Active") : (locale === "it" ? "Sospesa" : "Paused")}</Badge>
            <Button size="sm" variant="secondary" onClick={() => void generateRecurrence(getString(item, "id"))}>{locale === "it" ? "Registra scadenze" : "Generate due"}</Button>
            <Button size="sm" variant="ghost" onClick={() => void updateRecurrence(getString(item, "id"), !Boolean(item.isActive))}>{item.isActive ? (locale === "it" ? "Sospendi" : "Pause") : (locale === "it" ? "Riattiva" : "Resume")}</Button><IconButton label={t("delete")} onClick={() => void deleteRecurrence(getString(item, "id"))}><Icon name="trash" /></IconButton>
          </div>)}
        </div>
      </Panel>
    </div>
    <Panel>
      <PanelHeader title={locale === "it" ? "Redditività e costi" : "Profitability and costs"} action={<a className="button button-secondary button-sm" href={"/api/v1/finance/export.csv" + queryString({ from, to, currency: "EUR" })}>{locale === "it" ? "Esporta CSV" : "Export CSV"}</a>} />
      <div className="metric-grid finance-metrics">
        <FinanceMetric label={locale === "it" ? "Ricavi" : "Revenue"} value={getString(profitability.data, "incomeCents", "0")} locale={locale} tone="success" />
        <FinanceMetric label={locale === "it" ? "Costi" : "Costs"} value={getString(profitability.data, "expenseCents", "0")} locale={locale} tone="warning" />
        <FinanceMetric label={locale === "it" ? "Margine" : "Margin"} value={getString(profitability.data, "marginCents", "0")} locale={locale} tone="primary" />
      </div>
      <div className="finance-profit-columns">
        {(["animals", "reproductionCycles", "clutches", "offspringBatches"] as const).map((key) => {
          const values = Array.isArray(profitability.data?.[key]) ? profitability.data[key] as Array<Record<string, unknown>> : [];
          const title = key === "animals" ? (locale === "it" ? "Per animale" : "By animal") : key === "reproductionCycles" ? (locale === "it" ? "Per ciclo" : "By cycle") : key === "clutches" ? (locale === "it" ? "Per covata" : "By clutch") : (locale === "it" ? "Per gruppo di piccoli" : "By offspring batch");
          return <div key={key}><strong>{title}</strong>{values.length ? values.map((item) => <div className="finance-detail-row" key={getString(item, "id")}><span>{getString(item, "label") || getString(item, "id").slice(0, 8)}</span><strong>{formatMoneyCents(getString(item, "marginCents"), locale)}</strong></div>) : <p className="muted-note">{locale === "it" ? "Nessun costo o ricavo collegato" : "No linked costs or revenue"}</p>}</div>;
        })}
      </div>
    </Panel>

    {modal && <Modal title={editing ? t("edit") : t("newEntry")} onClose={() => { setModal(false); setFormDirty(false); }} hasUnsavedChanges={formDirty} discardMessage={locale === "en" ? "Discard unsaved financial entry?" : "Scartare la registrazione finanziaria non salvata?"} wide>
      <form className="form-stack" onSubmit={save}>{error && <Alert tone="danger">{error}</Alert>}
        <div className="form-grid"><Field label={t("type")}><Select value={form.entryType} onChange={(e) => { setForm({ ...form, entryType: e.target.value }); setFormDirty(true); }}><option value="expense">{t("expense")}</option><option value="income">{t("income")}</option></Select></Field><Field label={t("date")}><Input required type="date" value={form.occurredOn} onChange={(e) => { setForm({ ...form, occurredOn: e.target.value }); setFormDirty(true); }} /></Field>
        <Field label={t("amount")}><Input required inputMode="decimal" placeholder="0,00" value={form.amount} onChange={(e) => { setForm({ ...form, amount: e.target.value }); setFormDirty(true); }} /></Field><Field label={t("currency")}><Input required minLength={3} maxLength={3} value={form.currency} onChange={(e) => { setForm({ ...form, currency: e.target.value.toUpperCase() }); setFormDirty(true); }} /></Field></div>
        <Field label={t("category")}><Input aria-label={t("category")} required maxLength={80} value={form.category} onChange={(e) => { setForm({ ...form, category: e.target.value }); setFormDirty(true); }} /></Field>
        <Field label={t("descriptionFinance")}><Input required maxLength={240} value={form.description} onChange={(e) => { setForm({ ...form, description: e.target.value }); setFormDirty(true); }} /></Field>
        <div className="form-grid">
          <RemoteSelect label={t("animalDetail")} value={form.animalId} onChange={(animalId) => { setForm({ ...form, animalId }); setFormDirty(true); }} endpoint="/animals" responseKey="animals" filters={{ status: "all", sort: "name" }} detailEndpoint={(id) => `/animals/${encodeURIComponent(id)}`} detailKey="animal" locale={locale} />
          <RemoteSelect label={t("documentsTab")} value={form.documentId} onChange={(documentId) => { setForm({ ...form, documentId }); setFormDirty(true); }} endpoint="/documents" responseKey="documents" labelKey="originalFilename" locale={locale} />
          <RemoteSelect label={locale === "it" ? "Ciclo riproduttivo" : "Reproduction cycle"} value={form.reproductionCycleId} onChange={(reproductionCycleId) => { setForm({ ...form, reproductionCycleId, clutchId: "", offspringBatchId: "" }); setFormDirty(true); }} endpoint="/reproduction-cycles" responseKey="cycles" locale={locale} filters={{ status: "all" }} />
          {form.reproductionCycleId && <RemoteSelect label={locale === "it" ? "Covata" : "Clutch"} value={form.clutchId} onChange={(clutchId) => { setForm({ ...form, clutchId, offspringBatchId: "" }); setFormDirty(true); }} endpoint={`/reproduction-cycles/${encodeURIComponent(form.reproductionCycleId)}/clutches`} responseKey="clutches" locale={locale} detailEndpoint={(id) => `/clutches/${encodeURIComponent(id)}`} detailKey="clutch" />}
          {form.reproductionCycleId && <RemoteSelect label={locale === "it" ? "Gruppo di piccoli" : "Offspring batch"} value={form.offspringBatchId} onChange={(offspringBatchId) => { setForm({ ...form, offspringBatchId }); setFormDirty(true); }} endpoint="/offspring-batches" responseKey="offspringBatches" locale={locale} filters={{ cycleId: form.reproductionCycleId }} />}
        </div>
        <p className="muted-note">{locale === "it" ? "Gli importi vengono inviati al backend come centesimi interi. Questo registro è gestionale e non sostituisce la contabilità fiscale." : "Amounts are sent to the API as integer cents. This log is for management and is not a tax accounting system."}</p>
        <div className="modal-actions"><Button variant="secondary" type="button" onClick={() => { if (!formDirty || window.confirm(locale === "en" ? "Discard unsaved financial entry?" : "Scartare la registrazione finanziaria non salvata?")) { setModal(false); setFormDirty(false); } }}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("save")}</Button></div>
      </form>
    </Modal>}
    {toast}
  </div>;
}

function FinanceMetric({ label, value, locale, tone }: { label: string; value: string; locale: Locale; tone: string }) {
  return <div className="metric-card"><span className={`metric-icon metric-${tone}`}><Icon name="wallet" /></span><div><span className="metric-label">{label}</span><strong>{formatMoneyCents(value, locale)}</strong></div></div>;
}