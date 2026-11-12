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
  const [form, setForm] = useState({ entryType: "expense", occurredOn: todayDate(), amount: "", currency: "EUR", category: "", description: "", animalId: "", documentId: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [formDirty, setFormDirty] = useState(false);
  const { toast, show } = useToast();
  const url = "/finance/entries" + queryString({ page, pageSize: 25, entryType, category, q, from, to });
  const resource = useResource<FinanceEntriesResponseDto>(url, parseFinanceEntriesResponse);
  const summary = useResource<FinanceSummaryDto>(
    "/finance/summary" + queryString({ from, to, currency: "EUR" }), parseFinanceSummaryResponse
  );

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
      documentId: getString(entry, "documentId")
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
        documentId: form.documentId || null
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
    {modal && <Modal title={editing ? t("edit") : t("newEntry")} onClose={() => { setModal(false); setFormDirty(false); }} hasUnsavedChanges={formDirty} discardMessage={locale === "en" ? "Discard unsaved financial entry?" : "Scartare la registrazione finanziaria non salvata?"} wide>
      <form className="form-stack" onSubmit={save}>{error && <Alert tone="danger">{error}</Alert>}
        <div className="form-grid"><Field label={t("type")}><Select value={form.entryType} onChange={(e) => { setForm({ ...form, entryType: e.target.value }); setFormDirty(true); }}><option value="expense">{t("expense")}</option><option value="income">{t("income")}</option></Select></Field><Field label={t("date")}><Input required type="date" value={form.occurredOn} onChange={(e) => { setForm({ ...form, occurredOn: e.target.value }); setFormDirty(true); }} /></Field>
        <Field label={t("amount")}><Input required inputMode="decimal" placeholder="0,00" value={form.amount} onChange={(e) => { setForm({ ...form, amount: e.target.value }); setFormDirty(true); }} /></Field><Field label={t("currency")}><Input required minLength={3} maxLength={3} value={form.currency} onChange={(e) => { setForm({ ...form, currency: e.target.value.toUpperCase() }); setFormDirty(true); }} /></Field></div>
        <Field label={t("category")}><Input required maxLength={80} value={form.category} onChange={(e) => { setForm({ ...form, category: e.target.value }); setFormDirty(true); }} /></Field>
        <Field label={t("descriptionFinance")}><Input required maxLength={240} value={form.description} onChange={(e) => { setForm({ ...form, description: e.target.value }); setFormDirty(true); }} /></Field>
        <div className="form-grid">
          <RemoteSelect label={t("animalDetail")} value={form.animalId} onChange={(animalId) => { setForm({ ...form, animalId }); setFormDirty(true); }} endpoint="/animals" responseKey="animals" filters={{ status: "all", sort: "name" }} detailEndpoint={(id) => `/animals/${encodeURIComponent(id)}`} detailKey="animal" locale={locale} />
          <RemoteSelect label={t("documentsTab")} value={form.documentId} onChange={(documentId) => { setForm({ ...form, documentId }); setFormDirty(true); }} endpoint="/documents" responseKey="documents" labelKey="originalFilename" locale={locale} />
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