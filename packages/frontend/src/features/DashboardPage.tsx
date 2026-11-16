import { useState } from "react";
import type { DashboardTaskDto, DashboardTodayDto } from "@vivarqo/contracts/operations";
import { parseDashboardTodayResponse } from "@vivarqo/contracts/operations";
import { api, ApiError } from "../lib/api";
import { formatDateTime, getNumber, getString } from "../lib/domain";
import type { Locale } from "../lib/domain";
import { translate } from "../lib/i18n";
import { useResource } from "../hooks/useResource";
import { OnboardingChecklist } from "../components/OnboardingChecklist";
import { PlanUsageSummary } from "../components/PlanUsageSummary";
import { Badge, Button, EmptyState, ErrorState, Icon, LoadingState, PageHeader, Panel, PanelHeader, useToast } from "../components/ui";

export function DashboardPage({ locale, timezone, navigate }: { locale: Locale; timezone: string; navigate: (path: string) => void }) {
  const t = (key: string) => translate(locale, key);
  const resource = useResource<DashboardTodayDto>("/home/today", parseDashboardTodayResponse);
  const { toast, show } = useToast();
  const [completing, setCompleting] = useState<string | null>(null);
  const [feedingWidgetVisible, setFeedingWidgetVisible] = useState(() => {
    try { return window.localStorage.getItem("vivarqo.dashboard.feeding-alerts") !== "hidden"; } catch { return true; }
  });
  const [widgetVisibility, setWidgetVisibility] = useState<Record<string, boolean>>(() => {
    const defaults = { priorities: true, plan: true, quickActions: true, feedingAlerts: true, reminders: true, recent: true, summary: true };
    try { const saved = JSON.parse(window.localStorage.getItem("vivarqo.dashboard.widgets") || "{}") as Record<string, unknown>; return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, typeof saved[key] === "boolean" ? saved[key] : value])); } catch { return defaults; }
  });
  const [widgetSettingsOpen, setWidgetSettingsOpen] = useState(false);
  function toggleWidget(key: string, visible: boolean) { setWidgetVisibility((current) => { const next = { ...current, [key]: visible }; try { window.localStorage.setItem("vivarqo.dashboard.widgets", JSON.stringify(next)); } catch { /* Session-only preference. */ } return next; }); }
  const data = resource.data;
  const due = data?.tasks.dueToday ?? [];
  const overdue = data?.tasks.overdue ?? [];
  const upcoming = data?.tasks.upcoming ?? [];
  const completed = data?.tasks.completedToday ?? [];
  const reminders = data?.imminentReminders ?? [];
  const feedingAlerts = data?.feedingAlerts ?? [];
  const recent = data?.recentEvents ?? [];
  const counts = data?.counts;
  const truncated = data?.truncated;

  async function complete(id: string) {
    setCompleting(id);
    try {
      await api.post(`/tasks/${id}/complete`);
      show(t("taskCompleted"));
      resource.reload();
    } catch (error) {
      show(error instanceof ApiError ? error.message : t("operationFailed"));
    } finally {
      setCompleting(null);
    }
  }

  const taskCard = (task: DashboardTaskDto, late = false, isComplete = false) => {
    const id = task.id;
    const animal = task.animal;
    return <div className={`task-row dashboard-task-row${late ? " task-row-overdue" : ""}`} key={id}>
      <button className={`task-check${isComplete ? " muted" : ""}`} aria-label={t("completeTask")} disabled={isComplete || completing === id} onClick={() => void complete(id)}><Icon name="check" size={14} /></button>
      <button className="task-main" aria-label={`${t("openTask")}: ${task.title}`} onClick={() => navigate(`/tasks/${encodeURIComponent(id)}`)}>
        <strong>{task.title}</strong>
        <small>{getString(animal, "name") || t("noAnimalLinked")} · {formatDateTime(task.dueAt, locale, timezone)}</small>
      </button>
      {late && <Badge tone="danger">{t("overdue")}</Badge>}
      {isComplete && <Badge tone="success">{t("completed")}</Badge>}
      {!isComplete && <button className="dashboard-row-open" aria-label={t("openTask")} onClick={() => navigate(`/tasks/${encodeURIComponent(id)}`)}><Icon name="chevron" size={16} /></button>}
    </div>;
  };

  if (resource.loading && !resource.data) return <LoadingState />;
  if (resource.error) return <ErrorState message={resource.error.message} retry={resource.reload} />;

  return <div className="page-stack dashboard-page">
    <PageHeader eyebrow={formatDate(new Date(), locale)} title={t("dashboardTitle")} description={t("dashboardSubtitle")} action={<Button onClick={() => navigate("/calendar")} variant="secondary"><Icon name="calendar" size={16} />{t("openCalendar")}</Button>} />

    <div className="dashboard-intro">
      <div>
        <span className="eyebrow">{locale === "it" ? "PRIORITÀ DELL'ALLEVAMENTO" : "COLLECTION PRIORITIES"}</span>
        <h2>{t("dashboardPrompt")}</h2>
        <p>{t("dashboardPromptHint")}</p>
      </div>
      <div className="intro-mark"><Icon name="leaf" size={34} /></div>
    </div>

    <OnboardingChecklist locale={locale} onNavigate={navigate} />

    <div className="dashboard-grid">\n      <div className="dashboard-side"><Panel><PanelHeader title={locale === "it" ? "Personalizza dashboard" : "Customize dashboard"} action={<Button size="sm" variant="ghost" onClick={() => setWidgetSettingsOpen((open) => !open)}>{widgetSettingsOpen ? "Chiudi" : "Configura"}</Button>} />{widgetSettingsOpen && <div>{([["priorities", "Attività e priorità"], ["plan", "Piano e utilizzo"], ["quickActions", "Azioni rapide"], ["feedingAlerts", "Avvisi alimentazione"], ["reminders", "Promemoria"], ["recent", "Attività recenti"], ["summary", "Riepilogo"]] as const).map(([key, label]) => <label key={key} style={{display:"flex",gap:8,alignItems:"center",padding:"6px 0"}}><input type="checkbox" checked={widgetVisibility[key]} onChange={(event) => toggleWidget(key, event.target.checked)} />{label}</label>)}</div>}</Panel></div>
      {widgetVisibility.priorities && <Panel className="dashboard-tasks dashboard-priorities">
        <section className="dashboard-task-section dashboard-overdue-section">
          <PanelHeader title={t("overdue")} action={overdue.length > 0 ? <Badge tone="danger">{counts?.overdue ?? overdue.length}</Badge> : undefined} />
          {overdue.length
            ? overdue.slice(0, 6).map((task) => taskCard(task, true))
            : <EmptyState title={t("overdueClear")} description={t("overdueClearHint")} />}
          {Boolean(truncated?.overdue) && <p className="muted-note">{t("truncatedNotice")}</p>}
        </section>

        <div className="panel-separator" />
        <section className="dashboard-task-section">
          <PanelHeader title={t("dueToday")} action={due.length > 0 ? <Badge tone="warning">{counts?.dueToday ?? due.length}</Badge> : undefined} />
          {due.length
            ? due.slice(0, 8).map((task) => taskCard(task))
            : <EmptyState title={t("todayClear")} description={t("todayClearHint")} action={<Button size="sm" variant="secondary" onClick={() => navigate("/tasks?create=1")}><Icon name="plus" size={14} />{t("addTask")}</Button>} />}
          {Boolean(truncated?.dueToday) && <p className="muted-note">{t("truncatedNotice")}</p>}
        </section>

        <div className="panel-separator" />
        <section className="dashboard-task-section">
          <PanelHeader title={t("upcomingTasks")} action={upcoming.length > 0 ? <Button variant="ghost" size="sm" onClick={() => navigate("/tasks")}>{t("viewAll")} <Icon name="arrow" size={14} /></Button> : undefined} />
          {upcoming.length
            ? upcoming.slice(0, 6).map((task) => taskCard(task))
            : <EmptyState title={t("upcomingEmpty")} description={t("upcomingEmptyHint")} action={<Button size="sm" variant="secondary" onClick={() => navigate("/calendar")}><Icon name="calendar" size={14} />{t("openCalendar")}</Button>} />}
          {Boolean(truncated?.upcoming) && <p className="muted-note">{t("truncatedNotice")}</p>}
        </section>

        {completed.length > 0 && <>
          <div className="panel-separator" />
          <section className="dashboard-task-section">
            <PanelHeader title={t("completedToday")} action={<Badge tone="success">{counts?.completedToday ?? completed.length}</Badge>} />
            {completed.slice(0, 4).map((task) => taskCard(task, false, true))}
            {Boolean(truncated?.completedToday) && <p className="muted-note">{t("truncatedNotice")}</p>}
          </section>
        </>}
      </Panel>

      <div className="dashboard-side">
        <PlanUsageSummary locale={locale} compact onNavigate={navigate} />
        <Panel>
          <PanelHeader title={t("quickActions")} />
          <div className="quick-action-grid">
            <QuickAction icon="feed" label={t("newFeeding")} onClick={() => navigate("/feeding?create=1")} />
            <QuickAction icon="weight" label={t("addWeight")} onClick={() => navigate("/animals?weigh=1")} />
            <QuickAction icon="calendar" label={t("addTask")} onClick={() => navigate("/tasks?create=1")} />
            <QuickAction icon="snake" label={t("addAnimal")} onClick={() => navigate("/animals?create=1")} />
          </div>
        </Panel>

        {feedingWidgetVisible && <Panel>
          <PanelHeader title={locale === "it" ? "Animali senza pasto" : "Animals overdue for a meal"} action={<Badge tone={feedingAlerts.length ? "danger" : "success"}>{feedingAlerts.length}</Badge>} />
          <p className="muted-note">{locale === "it" ? "Avvisi basati sull'intervallo di alimentazione configurato per ciascun animale." : "Alerts use each animal's configured feeding interval."}</p>
          {feedingAlerts.length ? feedingAlerts.slice(0, 8).map((animal) => <button className="simple-row dashboard-reminder-row dashboard-reminder-overdue" key={animal.id} onClick={() => navigate(`/animals/${encodeURIComponent(animal.id)}`)}>
            <span className="simple-row-icon"><Icon name="alert" size={16} /></span>
            <span className="dashboard-reminder-copy"><strong>{animal.name}</strong><small>{animal.species} · {locale === "it" ? `${animal.daysSinceLastMeal} giorni senza pasto (intervallo ${animal.feedingIntervalDays} gg)` : `${animal.daysSinceLastMeal} days without a meal (interval ${animal.feedingIntervalDays} days)`}</small></span>
            <Icon name="chevron" size={15} />
          </button>) : <EmptyState title={locale === "it" ? "Nessun animale in ritardo" : "No animals overdue"} description={locale === "it" ? "Gli animali con intervallo di alimentazione configurato sono in regola." : "Animals with a configured feeding interval are up to date."} />}
          <Button size="sm" variant="ghost" onClick={() => {
            setFeedingWidgetVisible(false);
            try { window.localStorage.setItem("vivarqo.dashboard.feeding-alerts", "hidden"); } catch { /* Storage can be unavailable in private browsing. */ }
          }}>{locale === "it" ? "Nascondi widget" : "Hide widget"}</Button>
        </Panel>}
        {!feedingWidgetVisible && <Button size="sm" variant="secondary" onClick={() => {
          setFeedingWidgetVisible(true);
          try { window.localStorage.setItem("vivarqo.dashboard.feeding-alerts", "visible"); } catch { /* Storage can be unavailable in private browsing. */ }
        }}>{locale === "it" ? "Mostra widget alimentazioni" : "Show feeding alerts widget"}</Button>}
        <Panel>
          <PanelHeader title={t("upcomingReminders")} action={<Button variant="ghost" size="sm" onClick={() => navigate("/tasks?tab=reminders")}>{t("viewAll")} <Icon name="arrow" size={14} /></Button>} />
          {reminders.length
            ? reminders.slice(0, 5).map((rule) => {
                const reminderOverdue = Date.parse(getString(rule, "nextDueAt")) < Date.now();
                return <button className={`simple-row dashboard-reminder-row${reminderOverdue ? " dashboard-reminder-overdue" : ""}`} key={getString(rule, "id")} onClick={() => navigate("/tasks?tab=reminders")}>
                  <span className="simple-row-icon"><Icon name="clock" size={16} /></span>
                  <span className="dashboard-reminder-copy"><strong>{getString(rule, "title")}</strong><small>{getString(getObject(rule, "animal"), "name") || t("noAnimalLinked")} · {formatDateTime(getString(rule, "nextDueAt"), locale, timezone)}</small></span>
                  {reminderOverdue && <Badge tone="danger">{t("overdue")}</Badge>}
                  <Icon name="chevron" size={15} />
                </button>;
              })
            : <EmptyState title={t("remindersEmpty")} description={t("remindersEmptyHint")} action={<Button size="sm" variant="secondary" onClick={() => navigate("/tasks?tab=reminders&create=1")}>{t("createReminder")}</Button>} />}
          {Boolean(truncated?.imminentReminders) && <p className="muted-note">{t("truncatedNotice")}</p>}
        </Panel>
      </div>

      <Panel className="dashboard-recent">
        <PanelHeader title={t("recentActivity")} action={<Button variant="ghost" size="sm" onClick={() => navigate("/animals")}>{t("viewAll")}</Button>} />
        {recent.length
          ? <div className="activity-list">{recent.slice(0, 8).map((event, index) => {
              const target = getString(event, "targetPath");
              const eventType = getString(event, "type");
              return <button className="activity-row" key={`${eventType}-${index}`} onClick={() => navigate(target || "/animals")}>
                <span className="activity-dot"><Icon name={eventType === "feeding" ? "feed" : eventType === "weight" ? "weight" : eventType === "reproduction" ? "egg" : "leaf"} size={15} /></span>
                <span className="activity-copy"><strong>{getString(event, "title")}</strong><small>{formatDateTime(getString(event, "occurredAt"), locale, timezone)}</small></span>
                <Icon name="chevron" size={15} />
              </button>;
            })}</div>
          : <EmptyState title={t("noRecentActivity")} description={t("recentActivityEmptyHint")} action={<Button size="sm" variant="secondary" onClick={() => navigate("/animals")}>{t("navAnimals")}</Button>} />}
      </Panel>
    </div>

    <Panel className="dashboard-summary">
      <PanelHeader title={t("dashboardSummary")} />
      <div className="dashboard-summary-grid">
        <Metric label={t("overdue")} value={getNumber(counts, "overdue")} tone="danger" icon="alert" />
        <Metric label={t("dueToday")} value={getNumber(counts, "dueToday")} tone="primary" icon="calendar" />
        <Metric label={t("completedToday")} value={getNumber(counts, "completedToday")} tone="success" icon="checkCircle" />
        <Metric label={t("upcomingReminders")} value={getNumber(counts, "imminentReminders")} tone="neutral" icon="clock" />
      </div>
    </Panel>
    {toast}
  </div>;
}

function getObject(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return null;
  return (value as Record<string, unknown>)[key] ?? null;
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
