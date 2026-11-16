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
  const [taskFilter, setTaskFilter] = useState<"all" | "overdue" | "today" | "upcoming" | "completed">("all");
  const [optimisticallyCompleted, setOptimisticallyCompleted] = useState<string[]>([]);
  const [widgetVisibility, setWidgetVisibility] = useState<Record<string, boolean>>(() => {
    const defaults = { priorities: true, plan: true, quickActions: true, feedingAlerts: true, reminders: true, recent: true, summary: true };
    try { const saved = JSON.parse(window.localStorage.getItem("vivarqo.dashboard.widgets") || "{}") as Record<string, unknown>; return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, typeof saved[key] === "boolean" ? saved[key] : value])); } catch { return defaults; }
  });
  const [widgetSettingsOpen, setWidgetSettingsOpen] = useState(false);
  const widgetKeys = ["priorities", "plan", "quickActions", "feedingAlerts", "reminders", "recent", "summary"] as const;
  type WidgetKey = typeof widgetKeys[number];
  const widgetLabels: Record<WidgetKey, string> = {
    priorities: locale === "it" ? "Attività e priorità" : "Tasks and priorities",
    plan: locale === "it" ? "Piano e utilizzo" : "Plan and usage",
    quickActions: locale === "it" ? "Azioni rapide" : "Quick actions",
    feedingAlerts: locale === "it" ? "Avvisi alimentazione" : "Feeding alerts",
    reminders: locale === "it" ? "Promemoria" : "Reminders",
    recent: locale === "it" ? "Attività recenti" : "Recent activity",
    summary: locale === "it" ? "Riepilogo" : "Summary",
  };
  const [widgetOrder, setWidgetOrder] = useState<WidgetKey[]>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("vivarqo.dashboard.order") || "[]") as unknown[];
      const valid = [...new Set(saved.filter((key): key is WidgetKey => widgetKeys.includes(key as WidgetKey)))];
      return [...valid, ...widgetKeys.filter((key) => !valid.includes(key))];
    } catch { return [...widgetKeys]; }
  });
  function resetDashboardLayout() {
    const nextVisibility = { priorities: true, plan: true, quickActions: true, feedingAlerts: true, reminders: true, recent: true, summary: true };
    setWidgetVisibility(nextVisibility);
    setWidgetOrder([...widgetKeys]);
    try {
      window.localStorage.setItem("vivarqo.dashboard.widgets", JSON.stringify(nextVisibility));
      window.localStorage.setItem("vivarqo.dashboard.order", JSON.stringify(widgetKeys));
    } catch { /* Reset still applies for this session. */ }
  }
  function moveWidget(key: WidgetKey, direction: -1 | 1) {
    setWidgetOrder((current) => {
      const index = current.indexOf(key);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      try { window.localStorage.setItem("vivarqo.dashboard.order", JSON.stringify(next)); } catch { /* Session-only preference. */ }
      return next;
    });
  }

  function toggleWidget(key: string, visible: boolean) { setWidgetVisibility((current) => { const next = { ...current, [key]: visible }; try { window.localStorage.setItem("vivarqo.dashboard.widgets", JSON.stringify(next)); } catch { /* Session-only preference. */ } return next; }); }
  const data = resource.data;
  const due = data?.tasks.dueToday ?? [];
  const overdue = data?.tasks.overdue ?? [];
  const upcoming = data?.tasks.upcoming ?? [];
  const taskLookup = [...overdue, ...due, ...upcoming];
  const completed = [...(data?.tasks.completedToday ?? []), ...taskLookup.filter((task) => optimisticallyCompleted.includes(task.id) && !(data?.tasks.completedToday ?? []).some((done) => done.id === task.id))];
  const visibleOverdue = overdue.filter((task) => !optimisticallyCompleted.includes(task.id));
  const visibleDue = due.filter((task) => !optimisticallyCompleted.includes(task.id));
  const visibleUpcoming = upcoming.filter((task) => !optimisticallyCompleted.includes(task.id));
  const reminders = data?.imminentReminders ?? [];
  const feedingAlerts = data?.feedingAlerts ?? [];
  const recent = data?.recentEvents ?? [];
  const counts = data?.counts;
  const overview = data?.overview;
  const smartSuggestions = data?.smartSuggestions ?? [];
  const truncated = data?.truncated;

  async function complete(id: string) {
    setCompleting(id);
    try {
      const result = await api.post<{ nextTask: { dueAt: string } | null; nextDueAt: string | null }>(`/tasks/${id}/complete`);
      setOptimisticallyCompleted((current) => current.includes(id) ? current : [...current, id]);
      show(result.nextDueAt
        ? (locale === "it" ? `Attività completata. Prossima scadenza: ${formatDateTime(result.nextDueAt, locale, timezone)}` : `Task completed. Next due: ${formatDateTime(result.nextDueAt, locale, timezone)}`)
        : t("taskCompleted"));
      resource.reload();
    } catch (error) {
      setOptimisticallyCompleted((current) => current.filter((taskId) => taskId !== id));
      show(error instanceof ApiError ? error.message : t("operationFailed"));
    } finally {
      setCompleting(null);
    }
  }

  const taskCard = (task: DashboardTaskDto, late = false, isComplete = false) => {
    const id = task.id;
    const animal = task.animal;
    const category = task.category || "custom";
    const categoryIcon = category === "feeding" ? "feed" : category === "weighing" ? "weight" : category === "shed_check" ? "leaf" : category === "reproduction" || category === "incubation" ? "egg" : category === "inventory" ? "box" : category === "document" ? "file" : "calendar";
    const categoryLabel: Record<string, string> = { feeding: locale === "it" ? "Alimentazione" : "Feeding", weighing: locale === "it" ? "Peso" : "Weight", shed_check: locale === "it" ? "Muta" : "Shed", cleaning: locale === "it" ? "Pulizia" : "Cleaning", reproduction: locale === "it" ? "Riproduzione" : "Reproduction", incubation: locale === "it" ? "Incubazione" : "Incubation", document: locale === "it" ? "Documento" : "Document", inventory: locale === "it" ? "Scorte" : "Inventory", custom: locale === "it" ? "Personalizzata" : "Custom" };
    return <div className={`task-row dashboard-task-row${late ? " task-row-overdue" : ""}`} key={id}>
      <button className={`task-check${isComplete ? " muted" : ""}`} aria-label={t("completeTask")} disabled={isComplete || completing === id} onClick={() => void complete(id)}><Icon name="check" size={14} /></button>
      <div className="dashboard-task-content">
        <button className="task-main" aria-label={`${t("openTask")}: ${task.title}`} onClick={() => navigate(`/tasks/${encodeURIComponent(id)}`)}>
          <strong>{task.title}</strong>
          <small>{formatDateTime(task.dueAt, locale, timezone)}</small>
        </button>
        <div className="dashboard-task-meta"><span className="dashboard-task-category"><Icon name={categoryIcon} size={13} />{categoryLabel[category] ?? categoryLabel.custom}</span>
          {animal && <button className="dashboard-task-animal" onClick={() => navigate(`/animals/${encodeURIComponent(getString(animal, "id"))}`)}>{getString(animal, "name")}</button>}
          {task.recurrence?.enabled && <span className="dashboard-task-recurrence" title={locale === "it" ? `Ricorrente ogni ${task.recurrence.intervalDays} giorni` : `Repeats every ${task.recurrence.intervalDays} days`}>{isComplete ? (locale === "it" ? `Prossima scadenza: ${formatDateTime(task.recurrence.nextDueAt, locale, timezone)}` : `Next due: ${formatDateTime(task.recurrence.nextDueAt, locale, timezone)}`) : (locale === "it" ? `Ricorrente ogni ${task.recurrence.intervalDays} gg` : `Repeats every ${task.recurrence.intervalDays} days`)}</span>}
        </div>
      </div>
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

    <div className="dashboard-section-heading"><span className="eyebrow">{locale === "it" ? "01 — SITUAZIONE OPERATIVA" : "01 — DAILY OVERVIEW"}</span><p>{locale === "it" ? "Prima le scadenze, poi il resto." : "Deadlines first, everything else after."}</p></div>
    <div className="dashboard-grid">
      <div className="dashboard-widget-settings-panel"><Panel><PanelHeader title={locale === "it" ? "Personalizza dashboard" : "Customize dashboard"} action={<Button size="sm" variant="ghost" onClick={() => setWidgetSettingsOpen((open) => !open)}>{widgetSettingsOpen ? (locale === "it" ? "Chiudi" : "Close") : (locale === "it" ? "Configura" : "Configure")}</Button>} />{widgetSettingsOpen && <div className="dashboard-widget-settings"><Button size="sm" variant="secondary" onClick={resetDashboardLayout}>{locale === "it" ? "Ripristina layout" : "Reset layout"}</Button>{widgetOrder.map((key, index) => <div className="dashboard-widget-setting" key={key}><label><input type="checkbox" checked={widgetVisibility[key]} onChange={(event) => toggleWidget(key, event.target.checked)} />{widgetLabels[key]}</label><span><Button size="sm" variant="ghost" disabled={index === 0} onClick={() => moveWidget(key, -1)} aria-label={locale === "it" ? "Sposta su" : "Move up"}>↑</Button><Button size="sm" variant="ghost" disabled={index === widgetOrder.length - 1} onClick={() => moveWidget(key, 1)} aria-label={locale === "it" ? "Sposta giù" : "Move down"}>↓</Button></span></div>)}</div>}</Panel></div>
      {widgetVisibility.priorities && <div className="dashboard-widget dashboard-widget-priorities" style={{ order: widgetOrder.indexOf("priorities") }}><Panel className="dashboard-tasks dashboard-priorities">
        <section className="dashboard-task-section dashboard-overdue-section" style={{ display: taskFilter === "all" || taskFilter === "overdue" ? undefined : "none" }}>
          <PanelHeader title={t("overdue")} action={visibleOverdue.length > 0 ? <Badge tone="danger">{visibleOverdue.length}</Badge> : undefined} />
          <div className="dashboard-task-filters" role="group" aria-label={locale === "it" ? "Filtra attività" : "Filter tasks"}>
            {(["all", "overdue", "today", "upcoming", "completed"] as const).map((key) => <button key={key} type="button" className={taskFilter === key ? "dashboard-task-filter is-active" : "dashboard-task-filter"} aria-pressed={taskFilter === key} onClick={() => setTaskFilter(key)}>{({ all: locale === "it" ? "Tutte" : "All", overdue: locale === "it" ? "Scadute" : "Overdue", today: locale === "it" ? "Oggi" : "Today", upcoming: locale === "it" ? "Prossimi 7 giorni" : "Next 7 days", completed: locale === "it" ? "Completate" : "Completed" })[key]}</button>)}
          </div>
          {(taskFilter === "all" || taskFilter === "overdue") && (visibleOverdue.length
            ? visibleOverdue.slice(0, 6).map((task) => taskCard(task, true))
            : <EmptyState title={t("overdueClear")} description={t("overdueClearHint")} />)}
          {Boolean(truncated?.overdue) && <p className="muted-note">{t("truncatedNotice")}</p>}
        </section>

        <div className="panel-separator" />
        <section className="dashboard-task-section" style={{ display: taskFilter === "all" || taskFilter === "today" ? undefined : "none" }}>
          <PanelHeader title={t("dueToday")} action={visibleDue.length > 0 ? <Badge tone="warning">{visibleDue.length}</Badge> : undefined} />
          {(taskFilter === "all" || taskFilter === "today") && (visibleDue.length
            ? visibleDue.slice(0, 8).map((task) => taskCard(task))
            : <EmptyState title={t("todayClear")} description={t("todayClearHint")} action={<Button size="sm" variant="secondary" onClick={() => navigate("/tasks?create=1")}><Icon name="plus" size={14} />{t("addTask")}</Button>} />)}
          {Boolean(truncated?.dueToday) && <p className="muted-note">{t("truncatedNotice")}</p>}
        </section>

        <div className="panel-separator" />
        <section className="dashboard-task-section" style={{ display: taskFilter === "all" || taskFilter === "upcoming" ? undefined : "none" }}>
          <PanelHeader title={t("upcomingTasks")} action={visibleUpcoming.length > 0 ? <Button variant="ghost" size="sm" onClick={() => navigate("/tasks")}>{t("viewAll")} <Icon name="arrow" size={14} /></Button> : undefined} />
          {(taskFilter === "all" || taskFilter === "upcoming") && (visibleUpcoming.length
            ? visibleUpcoming.slice(0, 6).map((task) => taskCard(task))
            : <EmptyState title={t("upcomingEmpty")} description={t("upcomingEmptyHint")} action={<Button size="sm" variant="secondary" onClick={() => navigate("/calendar")}><Icon name="calendar" size={14} />{t("openCalendar")}</Button>} />)}
          {Boolean(truncated?.upcoming) && <p className="muted-note">{t("truncatedNotice")}</p>}
        </section>

        {(taskFilter === "all" || taskFilter === "completed") && completed.length > 0 && <>
          <div className="panel-separator" />
          <section className="dashboard-task-section">
            <PanelHeader title={t("completedToday")} action={<Badge tone="success">{counts?.completedToday ?? completed.length}</Badge>} />
            {completed.slice(0, 4).map((task) => taskCard(task, false, true))}
            {Boolean(truncated?.completedToday) && <p className="muted-note">{t("truncatedNotice")}</p>}
          </section>
        </>}
      </Panel></div>}

      <div className="dashboard-section-heading dashboard-section-heading-secondary"><span className="eyebrow">{locale === "it" ? "02 — OPERAZIONI" : "02 — OPERATIONS"}</span><p>{locale === "it" ? "Registra le attività di cura." : "Record routine care."}</p></div>
      {widgetVisibility.plan && <div className="dashboard-widget" style={{ order: widgetOrder.indexOf("plan") }}><PlanUsageSummary locale={locale} compact onNavigate={navigate} /></div>}
      {widgetVisibility.quickActions && <div className="dashboard-widget" style={{ order: widgetOrder.indexOf("quickActions") }}><Panel>
          <PanelHeader title={t("quickActions")} />
          <div className="quick-action-grid">
            <QuickAction icon="feed" label={t("bulkFeeding")} onClick={() => navigate("/feeding?bulk=1")} />
            <QuickAction icon="weight" label={locale === "it" ? "Registra pesi" : "Record weights"} onClick={() => navigate("/animals")} />
            <QuickAction icon="leaf" label={locale === "it" ? "Registra mute" : "Record sheds"} onClick={() => navigate("/animals")} />
            <QuickAction icon="egg" label={locale === "it" ? "Riproduzione" : "Reproduction"} onClick={() => navigate("/reproduction-cycles")} />
            <QuickAction icon="calendar" label={t("addTask")} onClick={() => navigate("/tasks?create=1")} />
            <QuickAction icon="snake" label={t("addAnimal")} onClick={() => navigate("/animals?create=1")} />
          </div>
      </Panel></div>}

      {widgetVisibility.feedingAlerts && <div className="dashboard-widget" style={{ order: widgetOrder.indexOf("feedingAlerts") }}><Panel>
          <PanelHeader title={locale === "it" ? "Animali da controllare" : "Animals to check"} action={<Badge tone={feedingAlerts.length ? "danger" : "success"}>{feedingAlerts.length}</Badge>} />
          <p className="muted-note">{locale === "it" ? "Avvisi basati sull'intervallo di alimentazione configurato per ciascun animale." : "Alerts use each animal's configured feeding interval."}</p>
          {feedingAlerts.length ? feedingAlerts.slice(0, 8).map((animal) => {
            const noHistory = animal.feedingStatus === "no_history";
            const overdueMeal = animal.feedingStatus === "overdue";
            const nearDue = animal.feedingStatus === "due_soon";
            const status = noHistory ? (locale === "it" ? "Nessuna alimentazione registrata" : "No feeding history") : overdueMeal ? (locale === "it" ? "Alimentazione in ritardo" : "Feeding overdue") : (locale === "it" ? "In prossimità della scadenza" : "Due soon");
            return <button className={`simple-row dashboard-reminder-row dashboard-animal-alert${overdueMeal ? " dashboard-reminder-overdue" : ""}`} key={animal.id} onClick={() => navigate(`/animals/${encodeURIComponent(animal.id)}`)}>
              {animal.photoUrl ? <img className="dashboard-animal-photo" src={animal.photoUrl} alt="" loading="lazy" /> : <span className="simple-row-icon"><Icon name={noHistory ? "info" : overdueMeal ? "alert" : "clock"} size={16} /></span>}
              <span className="dashboard-reminder-copy"><strong>{animal.name}</strong><small>{animal.species} · {noHistory ? (locale === "it" ? "Nessun pasto nello storico" : "No meal in history") : (locale === "it" ? `Ultimo pasto: ${formatDateTime(animal.lastMealAt, locale, timezone)} · ${animal.daysSinceLastMeal} gg / intervallo ${animal.feedingIntervalDays} gg` : `Last meal: ${formatDateTime(animal.lastMealAt, locale, timezone)} · ${animal.daysSinceLastMeal}d / interval ${animal.feedingIntervalDays}d`)}</small><span className={`dashboard-animal-status ${overdueMeal ? "is-overdue" : nearDue ? "is-near" : ""}`}>{status}</span></span>
              <Icon name="chevron" size={15} />
            </button>;
          }) : <EmptyState title={locale === "it" ? "Nessun controllo alimentazione" : "No feeding checks"} description={locale === "it" ? "Non risultano animali da controllare in base agli intervalli configurati." : "No animals currently need a feeding check based on their configured intervals."} />}
          <Button size="sm" variant="ghost" onClick={() => toggleWidget("feedingAlerts", false)}>{locale === "it" ? "Nascondi widget" : "Hide widget"}</Button>
        </Panel></div>}
      {widgetVisibility.reminders && <div className="dashboard-widget" style={{ order: widgetOrder.indexOf("reminders") }}><Panel>
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
      </Panel></div>}

      <div className="dashboard-section-heading dashboard-section-heading-secondary"><span className="eyebrow">{locale === "it" ? "03 — MONITORAGGIO" : "03 — MONITORING"}</span><p>{locale === "it" ? "Controlli e andamento dell’allevamento." : "Checks and collection activity."}</p></div>
      {widgetVisibility.recent && <div className="dashboard-widget" style={{ order: widgetOrder.indexOf("recent") }}><Panel className="dashboard-recent">
        <PanelHeader title={t("recentActivity")} action={<Button variant="ghost" size="sm" onClick={() => navigate("/animals")}>{t("viewAll")}</Button>} />
        {recent.length
          ? <div className="activity-list">{recent.slice(0, 8).map((event, index) => {
              const target = getString(event, "targetPath");
              const eventType = getString(event, "type");
              const rawTitle = getString(event, "title");
              const eventTitle = eventType === "feeding" ? (locale === "it" ? "Alimentazione registrata" : "Feeding recorded")
                : eventType === "weight" ? (locale === "it" ? "Peso registrato" : "Weight recorded")
                : eventType === "shed" ? (locale === "it" ? "Muta registrata" : "Shed recorded")
                : eventType === "reproduction" ? ({ mating: locale === "it" ? "Accoppiamento registrato" : "Mating recorded", laying: locale === "it" ? "Deposizione registrata" : "Egg laying recorded" } as Record<string, string>)[rawTitle] ?? rawTitle
                : eventType === "birth" ? (locale === "it" ? rawTitle.replace("Nascita:", "Nascita registrata:") : rawTitle.replace("Nascita:", "Birth recorded:"))
                : eventType === "incubation" ? (locale === "it" ? rawTitle : rawTitle.replace("Manutenzione incubatrice:", "Incubator maintenance:"))
                : eventType === "animal_update" ? (locale === "it" ? rawTitle : rawTitle.replace("Scheda aggiornata:", "Animal profile updated:"))
                : rawTitle;
              return <button className="activity-row" key={`${eventType}-${index}`} onClick={() => navigate(target || "/animals")}>
                <span className="activity-dot"><Icon name={eventType === "feeding" ? "feed" : eventType === "weight" ? "weight" : eventType === "reproduction" || eventType === "birth" ? "egg" : eventType === "incubation" ? "clock" : eventType === "animal_update" ? "edit" : eventType === "note" ? "file" : "leaf"} size={15} /></span>
                <span className="activity-copy"><strong>{eventTitle}</strong><small>{formatDateTime(getString(event, "occurredAt"), locale, timezone)}</small></span>
                <Icon name="chevron" size={15} />
              </button>;
            })}</div>
          : <EmptyState title={t("noRecentActivity")} description={t("recentActivityEmptyHint")} action={<Button size="sm" variant="secondary" onClick={() => navigate("/animals")}>{t("navAnimals")}</Button>} />}
      </Panel></div>}

      {widgetVisibility.summary && <div className="dashboard-widget dashboard-widget-summary" style={{ order: widgetOrder.indexOf("summary") }}><Panel className="dashboard-summary">
      <PanelHeader title={locale === "it" ? "Stato dell'allevamento" : "Collection overview"} />
      <div className="dashboard-overview-grid">
        <button className="dashboard-overview-card" onClick={() => navigate("/animals?status=active")}>
          <span>{locale === "it" ? "Animali attivi" : "Active animals"}</span><strong>{overview?.activeAnimals ?? 0}</strong><small>{locale === "it" ? "Totale allevamento" : "Collection total"}</small>
        </button>
        <button className="dashboard-overview-card" onClick={() => navigate("/feeding")}>
          <span>{locale === "it" ? "Alimentazioni oggi" : "Feedings today"}</span><strong>{overview?.feedingsToday ?? 0}</strong><small>{locale === "it" ? "Registrate" : "Recorded"}</small>
        </button>
        <button className="dashboard-overview-card" onClick={() => navigate("/inventory?lowStock=true")}>
          <span>{locale === "it" ? "Scorte basse" : "Low stock"}</span><strong>{overview?.lowStockCount ?? 0}</strong><small>{locale === "it" ? "Articoli sotto soglia" : "Items below threshold"}</small>
        </button>
      </div>
      {(overview?.lowStockItems.length ?? 0) > 0 && <div className="dashboard-low-stock-list">
        {overview?.lowStockItems.slice(0, 4).map((item) => <button key={item.id} onClick={() => navigate(`/inventory?item=${encodeURIComponent(item.id)}`)}>
          <span>{item.name}</span><small>{item.quantityOnHand} / {item.minimumQuantity} {item.unit}</small>
        </button>)}
      </div>}
      {smartSuggestions.length > 0 && <div className="dashboard-smart-suggestions">
        <strong>{locale === "it" ? "Da tenere d'occhio" : "Worth checking"}</strong>
        {smartSuggestions.slice(0, 5).map((item) => <button key={item.id} onClick={() => navigate(item.targetPath)}>
          <Icon name={item.type === "expected_hatch" ? "egg" : item.type === "incubator_maintenance" ? "clock" : "calendar"} size={15} />
          <span>{item.title}</span><small>{item.dueAt ? formatDateTime(item.dueAt, locale, timezone) : ""}</small>
        </button>)}
      </div>}
      <PanelHeader title={t("dashboardSummary")} />
      <div className="dashboard-summary-grid">
        <Metric label={t("overdue")} value={Math.max(0, getNumber(counts, "overdue") - optimisticallyCompleted.filter((id) => overdue.some((task) => task.id === id)).length)} tone="danger" icon="alert" />
        <Metric label={t("dueToday")} value={Math.max(0, getNumber(counts, "dueToday") - optimisticallyCompleted.filter((id) => due.some((task) => task.id === id)).length)} tone="primary" icon="calendar" />
        <Metric label={t("completedToday")} value={getNumber(counts, "completedToday") + optimisticallyCompleted.filter((id) => taskLookup.some((task) => task.id === id)).length} tone="success" icon="checkCircle" />
        <Metric label={t("upcomingReminders")} value={getNumber(counts, "imminentReminders")} tone="neutral" icon="clock" />
      </div>
      </Panel></div>}
    </div>
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
