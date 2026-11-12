import { useState } from "react";
import type { DashboardTodayDto, TaskDto } from "@vivarqo/contracts/operations";
import { parseDashboardTodayResponse } from "@vivarqo/contracts/operations";
import { api, ApiError } from "../lib/api";
import { formatDateTime, getNumber, getString } from "../lib/domain";
import type { Locale } from "../lib/domain";
import { translate } from "../lib/i18n";
import { useResource } from "../hooks/useResource";
import { Badge, Button, EmptyState, ErrorState, Icon, LoadingState, PageHeader, Panel, PanelHeader, useToast } from "../components/ui";

export function DashboardPage({ locale, timezone, navigate }: { locale: Locale; timezone: string; navigate: (path: string) => void }) {
  const t = (key: string) => translate(locale, key);
  const resource = useResource<DashboardTodayDto>("/home/today", parseDashboardTodayResponse);
  const { toast, show } = useToast();
  const [completing, setCompleting] = useState<string | null>(null);
  const data = resource.data;
  const due = data?.tasks.dueToday ?? [];
  const overdue = data?.tasks.overdue ?? [];
  const completed = data?.tasks.completedToday ?? [];
  const reminders = data?.imminentReminders ?? [];
  const recent = data?.recentEvents ?? [];
  const counts = data?.counts;
  const truncated = data?.truncated;

  async function complete(id: string) {
    setCompleting(id);
    try { await api.post(`/tasks/${id}/complete`); show(t("taskCompleted")); resource.reload(); }
    catch (error) { show(error instanceof ApiError ? error.message : t("operationFailed")); }
    finally { setCompleting(null); }
  }

  const taskCard = (task: TaskDto, late = false, isComplete = false) => {
    const id = task.id;
    const animal = task.animal;
    return <div className="task-row" key={id}>
      <button className="task-check" aria-label={t("taskCompleted")} disabled={isComplete || completing === id} onClick={() => void complete(id)}><Icon name="check" size={14} /></button>
      <button className="task-main" onClick={() => navigate(`/tasks`)}><strong>{task.title}</strong><small>{getString(animal, "name") || t("noRecords")} · {formatDateTime(task.dueAt, locale, timezone)}</small></button>
      {late && <Badge tone="danger">{t("overdue")}</Badge>}
    </div>;
  };

  if (resource.loading && !resource.data) return <LoadingState />;
  if (resource.error) return <ErrorState message={resource.error.message} retry={resource.reload} />;

  return <div className="page-stack">
    <PageHeader eyebrow={formatDate(new Date(), locale)} title={t("dashboardTitle")} description={t("dashboardSubtitle")} action={<Button onClick={() => navigate("/calendar")} variant="secondary"><Icon name="calendar" size={16} />{t("openCalendar")}</Button>} />
    <div className="dashboard-intro">
      <div><span className="eyebrow">{locale === "it" ? "IL TUO WORKSPACE" : "YOUR WORKSPACE"}</span><h2>{locale === "it" ? "Buon lavoro." : "Good to see you."}</h2><p>{locale === "it" ? "Ecco le priorità da tenere d'occhio." : "Here are the priorities to keep in view."}</p></div>
      <div className="intro-mark"><Icon name="leaf" size={34} /></div>
    </div>
    <div className="metric-grid">
      <Metric label={t("overdue")} value={getNumber(counts, "overdue")} tone="danger" icon="alert" />
      <Metric label={t("dueToday")} value={getNumber(counts, "dueToday")} tone="primary" icon="calendar" />
      <Metric label={t("completedToday")} value={getNumber(counts, "completedToday")} tone="success" icon="checkCircle" />
      <Metric label={t("upcomingReminders")} value={getNumber(counts, "imminentReminders")} tone="neutral" icon="clock" />
    </div>
    <div className="dashboard-grid">
      <Panel className="dashboard-tasks">
        <PanelHeader title={t("overdue")} action={<Button variant="ghost" size="sm" onClick={() => navigate("/tasks")}>{t("viewAll")} <Icon name="arrow" size={14} /></Button>} />
        {overdue.length ? overdue.slice(0, 5).map((task) => taskCard(task, true)) : <EmptyState title={t("noTasks")} />}
        {Boolean(truncated?.overdue) && <p className="muted-note">{t("truncatedNotice")}</p>}
        <div className="panel-separator" />
        <PanelHeader title={t("dueToday")} />
        {due.length ? due.slice(0, 8).map((task) => taskCard(task)) : <EmptyState title={t("noTasks")} />}
        {Boolean(truncated?.dueToday) && <p className="muted-note">{t("truncatedNotice")}</p>}
        {completed.length > 0 && <><div className="panel-separator" /><PanelHeader title={t("completedToday")} />{completed.slice(0, 4).map((task) => taskCard(task, false, true))}{Boolean(truncated?.completedToday) && <p className="muted-note">{t("truncatedNotice")}</p>}</>}
        {Boolean(truncated.dueToday) && <p className="muted-note">{t("truncatedNotice")}</p>}
      </Panel>
      <div className="dashboard-side">
        <Panel>
          <PanelHeader title={t("quickActions")} />
          <div className="quick-action-grid">
            <QuickAction icon="snake" label={t("addAnimal")} onClick={() => navigate("/animals?create=1")} />
            <QuickAction icon="feed" label={t("newFeeding")} onClick={() => navigate("/feeding?create=1")} />
            <QuickAction icon="weight" label={t("addWeight")} onClick={() => navigate("/animals?weigh=1")} />
            <QuickAction icon="calendar" label={t("addTask")} onClick={() => navigate("/tasks?create=1")} />
          </div>
        </Panel>
        <Panel>
          <PanelHeader title={t("upcomingReminders")} action={<Button variant="ghost" size="sm" onClick={() => navigate("/tasks?tab=reminders")}>{t("viewAll")}</Button>} />
          {reminders.length ? reminders.slice(0, 4).map((rule) => <div className="simple-row" key={getString(rule, "id")}><span className="simple-row-icon"><Icon name="clock" size={16} /></span><div><strong>{getString(rule, "title")}</strong><small>{formatDateTime(getString(rule, "nextDueAt"), locale, timezone)}</small></div></div>) : <p className="muted-note">{t("emptyHint")}</p>}
        </Panel>
      </div>
      <Panel className="dashboard-recent">
        <PanelHeader title={t("recentActivity")} action={<Button variant="ghost" size="sm" onClick={() => navigate("/animals")}>{t("viewAll")}</Button>} />
        {recent.length ? <div className="activity-list">{recent.slice(0, 8).map((event, index) => {
          const target = getString(event, "targetPath");
          const eventType = getString(event, "type");
          return <button className="activity-row" key={`${eventType}-${index}`} onClick={() => navigate(target || "/animals")}>
            <span className="activity-dot"><Icon name={eventType === "feeding" ? "feed" : eventType === "weight" ? "weight" : eventType === "reproduction" ? "egg" : "leaf"} size={15} /></span>
            <span className="activity-copy"><strong>{getString(event, "title")}</strong><small>{formatDateTime(getString(event, "occurredAt"), locale, timezone)}</small></span>
            <Icon name="chevron" size={15} />
          </button>;
        })}</div> : <EmptyState title={t("noRecentActivity")} />}
      </Panel>
    </div>
    {toast}
  </div>;
}

function formatDate(value: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(value);
}

function Metric({ label, value, tone, icon }: { label: string; value: number; tone: string; icon: "alert" | "calendar" | "checkCircle" | "clock" }) {
  return <div className="metric-card"><span className={`metric-icon metric-${tone}`}><Icon name={icon} size={18} /></span><div><span className="metric-label">{label}</span><strong>{value}</strong></div></div>;
}
function QuickAction({ label, icon, onClick }: { label: string; icon: "snake" | "feed" | "weight" | "calendar"; onClick: () => void }) {
  return <button className="quick-action" onClick={onClick}><span><Icon name={icon} size={19} /></span><strong>{label}</strong><Icon name="arrow" size={14} /></button>;
}