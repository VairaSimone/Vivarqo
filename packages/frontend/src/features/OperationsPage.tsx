import { useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { formatDate, formatDateTime, getArray, getString, localDateTimeValue, queryString, todayDate } from "../lib/domain";
import type { Locale } from "../lib/domain";
import { translate } from "../lib/i18n";
import { useResource } from "../hooks/useResource";
import { RemoteSelect } from "../components/RemoteSelect";
import { Alert, Badge, Button, EmptyState, ErrorState, Field, Icon, IconButton, Input, LoadingState, Modal, PageHeader, Pagination, Panel, PanelHeader, Select, Textarea, useToast } from "../components/ui";

type Item = Record<string, unknown>;
const categories = ["feeding", "weighing", "shed_check", "cleaning", "reproduction", "document", "inventory", "custom"];

function dateString(date: Date): string {
  const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, "0"); const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function eventDayInTimezone(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return read("year") + "-" + read("month") + "-" + read("day");
}
function shiftDate(date: Date, days: number): Date { const value = new Date(date); value.setDate(value.getDate() + days); return value; }
function weekStart(date: Date): Date { const value = new Date(date); value.setHours(0, 0, 0, 0); value.setDate(value.getDate() - ((value.getDay() + 6) % 7)); return value; }

export function OperationsPage({ locale, path, timezone, navigate }: { locale: Locale; path: string; timezone: string; navigate: (path: string) => void }) {
  if (path.startsWith("/calendar")) return <CalendarPage locale={locale} timezone={timezone} navigate={navigate} />;
  return <TasksPage locale={locale} path={path} timezone={timezone} navigate={navigate} />;
}

function TasksPage({ locale, path, timezone, navigate }: { locale: Locale; path: string; timezone: string; navigate: (path: string) => void }) {
  const t = (key: string) => translate(locale, key);
  const params = new URLSearchParams(path.includes("?") ? path.slice(path.indexOf("?")) : "");
  const taskId = path.match(/^\/tasks\/([^/?]+)/)?.[1] ?? params.get("open");
  const tab = params.get("tab") === "reminders" ? "reminders" : "tasks";
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("open");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState(params.get("q") ?? "");
  const [modal, setModal] = useState(Boolean(params.get("create")));
  const [editing, setEditing] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ title: "", description: "", category: "custom", dueAt: "", animalId: "" });
  const [reminderForm, setReminderForm] = useState({ title: "", category: "custom", intervalDays: "7", nextDueAt: "", animalId: "" });
  const [reminderModal, setReminderModal] = useState(false);
  const [reminderEdit, setReminderEdit] = useState<Item | null>(null);
  const taskUrl = "/tasks" + queryString({ page, pageSize: 25, status, category, q });
  const tasks = useResource<{ tasks: Item[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>(tab === "tasks" ? taskUrl : null);
  const reminders = useResource<{ reminderRules: Item[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>("/tasks/reminder-rules?page=1&pageSize=100&enabled=all");
  const detail = useResource<{ task: Item }>(taskId ? `/tasks/${encodeURIComponent(taskId)}` : null);
  const { toast, show } = useToast();

  function openCreate() { setEditing(null); setForm({ title: "", description: "", category: "custom", dueAt: localDateTimeValue(), animalId: "" }); setError(""); setModal(true); }
  function openEdit(task: Item) {
    setEditing(task);
    const due = new Date(getString(task, "dueAt"));
    setForm({ title: getString(task, "title"), description: getString(task, "description"), category: getString(task, "category", "custom"), dueAt: Number.isNaN(due.getTime()) ? "" : `${dateString(due)}T${String(due.getHours()).padStart(2, "0")}:${String(due.getMinutes()).padStart(2, "0")}`, animalId: getString(task, "animalId") });
    setError(""); setModal(true);
  }
  async function saveTask(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const body = { title: form.title, description: form.description || null, category: form.category, dueAt: new Date(form.dueAt).toISOString(), animalId: form.animalId || null };
      if (editing) await api.patch(`/tasks/${getString(editing, "id")}`, body); else await api.post("/tasks", body);
      setModal(false); tasks.reload(); detail.reload(); show(t("saveSuccess"));
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  async function updateTask(task: Item, action: "complete" | "dismiss" | "delete") {
    const id = getString(task, "id");
    try {
      if (action === "complete") await api.post(`/tasks/${id}/complete`);
      else if (action === "dismiss") await api.patch(`/tasks/${id}`, { status: "dismissed" });
      else { if (!window.confirm(t("confirmDelete"))) return; await api.delete(`/tasks/${id}`); }
      tasks.reload(); detail.reload(); show(action === "complete" ? t("taskCompleted") : t("saveSuccess"));
    } catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }
  function openReminder(rule?: Item) {
    setReminderEdit(rule ?? null);
    setReminderForm({
      title: getString(rule, "title"), category: getString(rule, "category", "custom"),
      intervalDays: getString(rule, "intervalDays", "7"),
      nextDueAt: rule ? localDateTimeValue(new Date(getString(rule, "nextDueAt"))) : localDateTimeValue(),
      animalId: getString(rule, "animalId")
    });
    setError(""); setReminderModal(true);
  }
  async function saveReminder(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const body = { ...reminderForm, intervalDays: Number(reminderForm.intervalDays), nextDueAt: new Date(reminderForm.nextDueAt).toISOString(), animalId: reminderForm.animalId || null, isEnabled: true };
      if (reminderEdit) await api.patch(`/tasks/reminder-rules/${getString(reminderEdit, "id")}`, body);
      else await api.post("/tasks/reminder-rules", body);
      setReminderModal(false); reminders.reload(); tasks.reload(); show(t("saveSuccess"));
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  async function toggleReminder(rule: Item) {
    try { await api.patch(`/tasks/reminder-rules/${getString(rule, "id")}`, { isEnabled: !Boolean(rule.isEnabled) }); reminders.reload(); tasks.reload(); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }

  if (taskId && detail.loading && !detail.data) return <LoadingState />;
  if (taskId && (detail.error || !detail.data?.task)) return <ErrorState message={detail.error?.message ?? t("noRecords")} retry={detail.reload} />;

  const list = tasks.data?.tasks ?? [];
  return <div className="page-stack">
    <PageHeader eyebrow={t("navWorkspace")} title={t("tasksTitle")} description={t("tasksSubtitle")} action={<div className="inline-actions"><Button variant="secondary" onClick={() => navigate("/calendar")}><Icon name="calendar" />{t("calendarTitle")}</Button><Button onClick={tab === "reminders" ? () => openReminder() : openCreate}><Icon name="plus" size={15} />{tab === "reminders" ? t("createReminder") : t("addTask")}</Button></div>} />
    <div className="tabs-line"><button className={tab === "tasks" ? "selected" : ""} onClick={() => navigate("/tasks")}>{t("tasksTitle")}</button><button className={tab === "reminders" ? "selected" : ""} onClick={() => navigate("/tasks?tab=reminders")}>{t("reminders")}</button></div>
    {tab === "tasks" ? <>
      <Panel className="filters-panel"><div className="filter-row">
        <label className="search-control"><Icon name="search" /><input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder={t("search")} /></label>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="open">{t("open")}</option><option value="all">{t("all")}</option><option value="completed">{t("completed")}</option><option value="dismissed">{t("dismissed")}</option></Select>
        <Select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}><option value="">{t("category")} · {t("all")}</option>{categories.map((value) => <option value={value} key={value}>{t(`category${value[0]!.toUpperCase()}${value.slice(1)}`)}</option>)}</Select>
      </div></Panel>
      {tasks.loading && !tasks.data ? <LoadingState /> : tasks.error ? <ErrorState message={tasks.error.message} retry={tasks.reload} /> :
        <Panel><div className="list-meta"><span>{tasks.data?.pagination.total ?? 0} {t("rows")}</span><Button size="sm" variant="ghost" onClick={tasks.reload}><Icon name="refresh" />{t("refresh")}</Button></div>
          {list.length ? <div className="task-list">{list.map((task) => <TaskRow key={getString(task, "id")} task={task} locale={locale} timezone={timezone} onComplete={() => void updateTask(task, "complete")} onDismiss={() => void updateTask(task, "dismiss")} onEdit={() => openEdit(task)} onDelete={() => void updateTask(task, "delete")} onOpen={() => navigate(`/tasks/${getString(task, "id")}`)} t={t} />)}</div> : <EmptyState title={t("noTasksList")} description={t("emptyHint")} action={<Button onClick={openCreate}>{t("addTask")}</Button>} />}
          {tasks.data?.pagination && <Pagination page={tasks.data.pagination.page} totalPages={tasks.data.pagination.totalPages} onChange={setPage} label={t("page")} />}
        </Panel>}
    </> : <Panel><PanelHeader title={t("reminders")} action={<Button onClick={() => openReminder()}><Icon name="plus" />{t("createReminder")}</Button>} />
      {reminders.loading && !reminders.data ? <LoadingState /> : reminders.error ? <ErrorState message={reminders.error.message} retry={reminders.reload} /> : reminders.data?.reminderRules.length ? <div className="task-list">{reminders.data.reminderRules.map((rule) => <div className="task-row reminder-row" key={getString(rule, "id")}><span className="task-check muted"><Icon name="clock" /></span><div className="task-main"><strong>{getString(rule, "title")}</strong><small>{formatDateTime(getString(rule, "nextDueAt"), locale, timezone)} · {getString(rule, "intervalDays")} {locale === "it" ? "giorni" : "days"}</small></div><Badge tone={Boolean(rule.isEnabled) ? "success" : "neutral"}>{Boolean(rule.isEnabled) ? t("enabled") : t("disabled")}</Badge><div className="row-actions"><IconButton label={t("edit")} onClick={() => openReminder(rule)}><Icon name="edit" /></IconButton><Button size="sm" variant="secondary" onClick={() => void toggleReminder(rule)}>{Boolean(rule.isEnabled) ? t("disabled") : t("enabled")}</Button></div></div>)}</div> : <EmptyState title={t("noTasksList")} />}
    </Panel>}

    {modal && <Modal title={editing ? t("edit") : t("addTask")} onClose={() => setModal(false)}>
      <form className="form-stack" onSubmit={saveTask}>{error && <Alert tone="danger">{error}</Alert>}
        <Field label={t("taskTitle")}><Input required maxLength={160} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <div className="form-grid"><Field label={t("category")}><Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{categories.map((value) => <option key={value} value={value}>{t(`category${value[0]!.toUpperCase()}${value.slice(1)}`)}</option>)}</Select></Field>
          <Field label={t("dueAt")}><Input required type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} /></Field></div>
        <RemoteSelect label={t("animalDetail")} value={form.animalId} onChange={(animalId) => setForm({ ...form, animalId })} endpoint="/animals" responseKey="animals" filters={{ status: "active", sort: "name" }} detailEndpoint={(id) => `/animals/${encodeURIComponent(id)}`} detailKey="animal" locale={locale} />
        <Field label={t("description")}><Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setModal(false)}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("save")}</Button></div>
      </form>
    </Modal>}
    {reminderModal && <Modal title={reminderEdit ? t("edit") : t("createReminder")} onClose={() => setReminderModal(false)}>
      <form className="form-stack" onSubmit={saveReminder}>{error && <Alert tone="danger">{error}</Alert>}
        <Field label={t("taskTitle")}><Input required value={reminderForm.title} onChange={(e) => setReminderForm({ ...reminderForm, title: e.target.value })} /></Field>
        <div className="form-grid"><Field label={t("category")}><Select value={reminderForm.category} onChange={(e) => setReminderForm({ ...reminderForm, category: e.target.value })}>{categories.map((value) => <option value={value} key={value}>{t(`category${value[0]!.toUpperCase()}${value.slice(1)}`)}</option>)}</Select></Field>
        <Field label={t("intervalDays")}><Input required type="number" min="1" max="3650" value={reminderForm.intervalDays} onChange={(e) => setReminderForm({ ...reminderForm, intervalDays: e.target.value })} /></Field>
        <Field label={t("nextDueAt")}><Input required type="datetime-local" value={reminderForm.nextDueAt} onChange={(e) => setReminderForm({ ...reminderForm, nextDueAt: e.target.value })} /></Field></div>
        <RemoteSelect label={t("animalDetail")} value={reminderForm.animalId} onChange={(animalId) => setReminderForm({ ...reminderForm, animalId })} endpoint="/animals" responseKey="animals" filters={{ status: "active", sort: "name" }} detailEndpoint={(id) => `/animals/${encodeURIComponent(id)}`} detailKey="animal" locale={locale} />
        <div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setReminderModal(false)}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("save")}</Button></div>
      </form>
    </Modal>}
    {taskId && detail.data?.task && <Modal title={getString(detail.data.task, "title")} onClose={() => navigate("/tasks")}>
      <div className="detail-fields"><div className="detail-field"><span>{t("category")}</span><strong>{getString(detail.data.task, "category")}</strong></div><div className="detail-field"><span>{t("dueAt")}</span><strong>{formatDateTime(getString(detail.data.task, "dueAt"), locale, timezone)}</strong></div><div className="detail-field"><span>{t("status")}</span><strong>{t(getString(detail.data.task, "status"))}</strong></div></div>
      <p className="detail-copy">{getString(detail.data.task, "description")}</p>
      <div className="modal-actions"><Button variant="secondary" onClick={() => openEdit(detail.data!.task)}>{t("edit")}</Button><Button onClick={() => void updateTask(detail.data!.task, "complete")}>{t("completed")}</Button></div>
    </Modal>}
    {toast}
  </div>;
}

function TaskRow({ task, locale, timezone, onComplete, onDismiss, onEdit, onDelete, onOpen, t }: { task: Item; locale: Locale; timezone: string; onComplete: () => void; onDismiss: () => void; onEdit: () => void; onDelete: () => void; onOpen: () => void; t: (key: string) => string }) {
  const status = getString(task, "status");
  const animal = task.animal as Item | undefined;
  return <div className="task-row">
    <button className="task-check" disabled={status !== "open"} aria-label={t("completed")} onClick={onComplete}>{status === "completed" ? <Icon name="checkCircle" /> : <Icon name="check" size={14} />}</button>
    <button className="task-main" onClick={onOpen}><strong>{getString(task, "title")}</strong><small>{getString(animal, "name") || getString(task, "category")} · {formatDateTime(getString(task, "dueAt"), locale, timezone)}</small></button>
    <Badge tone={status === "open" ? "info" : status === "completed" ? "success" : "neutral"}>{t(status)}</Badge>
    <div className="row-actions"><IconButton label={t("edit")} onClick={onEdit}><Icon name="edit" /></IconButton>{status === "open" && <IconButton label={t("dismissed")} onClick={onDismiss}><Icon name="close" /></IconButton>}<IconButton label={t("delete")} onClick={onDelete}><Icon name="trash" /></IconButton></div>
  </div>;
}

function CalendarPage({ locale, timezone, navigate }: { locale: Locale; timezone: string; navigate: (path: string) => void }) {
  const t = (key: string) => translate(locale, key);
  const [view, setView] = useState<"month" | "week" | "list">("month");
  const [focus, setFocus] = useState(() => new Date());
  const start = useMemo(() => {
    if (view === "month") {
      const first = new Date(focus.getFullYear(), focus.getMonth(), 1);
      return weekStart(first);
    }
    if (view === "week") return weekStart(focus);
    return new Date(focus.getFullYear(), focus.getMonth(), 1);
  }, [focus, view]);
  const end = useMemo(() => view === "month" ? shiftDate(start, 41) : view === "week" ? shiftDate(start, 6) : new Date(focus.getFullYear(), focus.getMonth() + 1, 0), [start, view, focus]);
  const url = "/calendar" + queryString({ from: dateString(start), to: dateString(end), view });
  const resource = useResource<{ items: Item[]; truncated?: boolean }>(url);
  const items = resource.data?.items ?? [];
  const days = useMemo(() => Array.from({ length: Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1 }, (_, index) => shiftDate(start, index)), [start, end]);
  function move(offset: number) {
    const next = new Date(focus);
    if (view === "month") next.setMonth(next.getMonth() + offset);
    else next.setDate(next.getDate() + offset * (view === "week" ? 7 : 30));
    setFocus(next);
  }
  const title = view === "month" ? new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", { month: "long", year: "numeric" }).format(focus)
    : view === "week" ? `${formatDate(start, locale)} – ${formatDate(end, locale)}` : new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", { month: "long", year: "numeric" }).format(focus);
  const weekDays = locale === "it" ? ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"] : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  function itemClick(item: Item) {
    const target = getString(item, "targetPath");
    if (target) navigate(target);
  }
  return <div className="page-stack">
    <PageHeader eyebrow={t("navWorkspace")} title={t("calendarTitle")} description={locale === "it" ? "Attività e appuntamenti riproduttivi in un'unica vista." : "Tasks and breeding events in one shared view."} action={<Button onClick={() => navigate("/tasks?create=1")}><Icon name="plus" />{t("addTask")}</Button>} />
    <Panel className="calendar-toolbar"><div className="calendar-nav"><Button variant="secondary" size="sm" onClick={() => move(-1)}><Icon name="chevron" size={15} /></Button><Button variant="secondary" size="sm" onClick={() => setFocus(new Date())}>{t("today")}</Button><Button variant="secondary" size="sm" onClick={() => move(1)}><Icon name="chevron" size={15} /></Button><strong>{title}</strong></div><div className="segmented">{(["month", "week", "list"] as const).map((value) => <button className={view === value ? "selected" : ""} onClick={() => setView(value)} key={value}>{t(value)}</button>)}</div></Panel>
    {resource.loading && !resource.data ? <LoadingState /> : resource.error ? <ErrorState message={resource.error.message} retry={resource.reload} /> : view === "list" ? <Panel>
      {items.length ? <div className="calendar-list">{items.map((item) => <button className="calendar-list-row" key={getString(item, "id")} onClick={() => itemClick(item)}><span className="calendar-date-block"><strong>{formatDate(getString(item, "start"), locale, { day: "2-digit" }).replace(/[^d]/g, "")}</strong><small>{new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", { month: "short" }).format(new Date(getString(item, "start")))}</small></span><span className="calendar-item-copy"><strong>{getString(item, "title")}</strong><small>{getString(item, "type")} · {formatDateTime(getString(item, "start"), locale, timezone)}</small></span><Badge>{getString(item, "status")}</Badge><Icon name="chevron" /></button>)}</div> : <EmptyState title={t("noCalendarEvents")} />}</Panel> : <Panel className="calendar-panel">
      {view === "month" && <div className="calendar-weekday-row">{weekDays.map((day) => <span key={day}>{day}</span>)}</div>}
      <div className={view === "month" ? "calendar-grid month-grid" : "calendar-grid week-grid"}>
        {days.map((day) => {
          const date = dateString(day);
          const dayItems = items.filter((item) => eventDayInTimezone(getString(item, "start"), timezone) === date);
          const inMonth = day.getMonth() === focus.getMonth();
          return <div className={`calendar-day ${inMonth || view === "week" ? "" : "out-month"}`} key={date}>
            <button className={`calendar-day-number ${date === todayDate() ? "today" : ""}`} onClick={() => { setFocus(day); setView("list"); }}>{day.getDate()}</button>
            <div className="calendar-day-items">{dayItems.slice(0, view === "month" ? 3 : 12).map((item) => <button className={`calendar-event event-${getString(item, "type")}`} key={getString(item, "id")} onClick={() => itemClick(item)}><span>{getString(item, "title")}</span></button>)}{dayItems.length > (view === "month" ? 3 : 12) && <small>+{dayItems.length - (view === "month" ? 3 : 12)}</small>}</div>
          </div>;
        })}
      </div>
      {resource.data?.truncated && <p className="muted-note">{t("truncatedNotice")}</p>}
    </Panel>}
    <div className="calendar-legend"><span><i className="legend-dot task" />{t("tasksTitle")}</span><span><i className="legend-dot reproduction" />{t("navBreeding")}</span><span><i className="legend-dot clutch" />{t("clutches")}</span></div>
  </div>;
}

