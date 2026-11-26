import { useEffect, useState } from "react";
import type { DashboardTaskDto } from "@vivarqo/contracts/operations";
import { api, ApiError } from "../lib/api";
import { formatDateTime, getString } from "../lib/domain";
import type { Locale } from "../lib/domain";
import { translate } from "../lib/i18n";
import { useResource } from "../hooks/useResource";
import { OnboardingChecklist } from "../components/OnboardingChecklist";
import { PlanUsageSummary } from "../components/PlanUsageSummary";
import { Badge, Button, EmptyState, ErrorState, Icon, PageHeader, Panel, PanelHeader, Skeleton, useToast } from "../components/ui";

export function DashboardPage({ locale, timezone, navigate }: { locale: Locale; timezone: string; navigate: (path: string) => void }) {
  const t = (key: string) => translate(locale, key);
  const tasksResource = useResource<{ tasks: { dueToday: DashboardTaskDto[]; overdue: DashboardTaskDto[]; completedToday: DashboardTaskDto[]; upcoming: DashboardTaskDto[] }; counts: { dueToday: number; overdue: number; completedToday: number; upcoming: number }; truncated: { dueToday: boolean; overdue: boolean; completedToday: boolean; upcoming: boolean } }>("/home/today/tasks");
  const remindersResource = useResource<{ items: Array<Record<string, unknown>>; count: number; truncated: boolean }>("/home/today/reminders");
  const feedingAlertsResource = useResource<{ items: Array<{ id: string; name: string; species: string; photoUrl?: string | null; lastMealAt: string | null; daysSinceLastMeal: number; feedingIntervalDays: number; feedingStatus: "no_history" | "overdue" | "due_soon" }> }>("/home/today/feeding-alerts");
  const overviewResource = useResource<{ activeAnimals: number; feedingsToday: number; lowStockItems: Array<{ id: string; name: string; quantityOnHand: string; minimumQuantity: string; unit: string }>; lowStockCount: number }>("/home/today/overview");
  const collectionResource = useResource<{ totals: { active: number; archived: number }; categories: Array<{ category: string; active: number; archived: number }>; upcoming: Array<{ id: string; title: string; dueAt: string; category: string; animal: { id: string; name: string; category: string } | null; targetPath: string }>; recentNotes: Array<{ id: string; title: string; occurredAt: string; animal: { id: string; name: string; category: string }; targetPath: string }> }>("/home/today/collection");
  const recentResource = useResource<{ events: Array<{ type: string; occurredAt: string; title: string; targetPath: string }>; smartSuggestions: Array<{ id: string; type: string; title: string; dueAt: string | null; targetPath: string }> }>("/home/today/recent");
  const { toast, show } = useToast();
  const accountPreferences = useResource<{ preferences: { dashboardLayout?: { order?: string[]; visibility?: Record<string, boolean> } } }>("/account/preferences");
  const [layoutReady, setLayoutReady] = useState(false);
  const [completing, setCompleting] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState<"all" | "overdue" | "today" | "upcoming" | "completed">("all");
  const [optimisticallyCompleted, setOptimisticallyCompleted] = useState<string[]>([]);
  const widgetKeys = ["priorities", "quickActions", "feedingAlerts", "reminders", "recent", "summary", "onboarding", "plan"] as const;
  type WidgetKey = typeof widgetKeys[number];
  const defaultVisibility: Record<WidgetKey, boolean> = { priorities: true, quickActions: true, feedingAlerts: true, reminders: true, recent: true, summary: true, onboarding: true, plan: false };
  const [widgetVisibility, setWidgetVisibility] = useState<Record<WidgetKey, boolean>>(defaultVisibility);
  const [widgetSettingsOpen, setWidgetSettingsOpen] = useState(false);
  const [widgetOrder, setWidgetOrder] = useState<WidgetKey[]>(["feedingAlerts", "priorities", "reminders", "summary", "quickActions", "recent", "onboarding", "plan"]);
  useEffect(() => {
    const layout = accountPreferences.data?.preferences.dashboardLayout;
    if (!layoutReady && accountPreferences.data) {
      const valid = Array.isArray(layout?.order) ? [...new Set(layout.order.filter((key): key is WidgetKey => widgetKeys.includes(key as WidgetKey)))] : [];
      setWidgetOrder(valid.length ? [...valid, ...widgetKeys.filter((key) => !valid.includes(key))] : ["feedingAlerts", "priorities", "reminders", "summary", "quickActions", "recent", "onboarding", "plan"]);
      setWidgetVisibility({ ...defaultVisibility, ...(layout?.visibility ?? {}) });
      setLayoutReady(true);
    }
  }, [accountPreferences.data, layoutReady]);
  useEffect(() => {
    if (!layoutReady) return;
    const timer = window.setTimeout(() => {
      void api.patch("/account/preferences", { dashboardLayout: { order: widgetOrder, visibility: widgetVisibility } }).then(() => accountPreferences.reload()).catch(() => {
        showLayoutSaveError();
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [layoutReady, widgetOrder, widgetVisibility]);
  const widgetLabels: Record<WidgetKey, string> = {
    priorities: locale === "it" ? "Attività e priorità" : "Tasks and priorities",
    plan: locale === "it" ? "Piano e utilizzo" : "Plan and usage",
    onboarding: locale === "it" ? "Primi passi e onboarding" : "Getting started",
    quickActions: locale === "it" ? "Azioni rapide" : "Quick actions",
    feedingAlerts: locale === "it" ? "Avvisi alimentazione" : "Feeding alerts",
    reminders: locale === "it" ? "Promemoria" : "Reminders",
    recent: locale === "it" ? "Attività recenti" : "Recent activity",
    summary: locale === "it" ? "Riepilogo" : "Summary",
  };
  function showLayoutSaveError() {
    show(locale === "it" ? "Impossibile salvare il layout della dashboard. Riprova dalle impostazioni." : "Couldn't save the dashboard layout. Please retry from settings.", "error");
  }
  function resetDashboardLayout() {
    setWidgetVisibility({ ...defaultVisibility });
    setWidgetOrder(["feedingAlerts", "priorities", "reminders", "summary", "quickActions", "recent", "onboarding", "plan"]);
  }
  function moveWidget(key: WidgetKey, direction: -1 | 1) {
    setWidgetOrder((current) => {
      const index = current.indexOf(key);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }
  function toggleWidget(key: WidgetKey, visible: boolean) {
    setWidgetVisibility((current) => ({ ...current, [key]: visible }));
  }
  const taskData = tasksResource.data;
  const due = taskData?.tasks.dueToday ?? [];
  const overdue = taskData?.tasks.overdue ?? [];
  const upcoming = taskData?.tasks.upcoming ?? [];
  const taskLookup = [...overdue, ...due, ...upcoming];
  const completed = [...(taskData?.tasks.completedToday ?? []), ...taskLookup.filter((task) => optimisticallyCompleted.includes(task.id) && !(taskData?.tasks.completedToday ?? []).some((done) => done.id === task.id))];
  const visibleOverdue = overdue.filter((task) => !optimisticallyCompleted.includes(task.id));
  const visibleDue = due.filter((task) => !optimisticallyCompleted.includes(task.id));
  const visibleUpcoming = upcoming.filter((task) => !optimisticallyCompleted.includes(task.id));
  const reminders = remindersResource.data?.items ?? [];
  const feedingAlerts = feedingAlertsResource.data?.items ?? [];
  const recent = recentResource.data?.events ?? [];
  const counts = taskData?.counts;
  const overview = overviewResource.data;
  const smartSuggestions = recentResource.data?.smartSuggestions ?? [];
  const truncated = taskData?.truncated;
  const dashboardTone = tasksResource.error || (tasksResource.loading && !taskData) ? "attention" : visibleOverdue.length > 0 ? "critical" : visibleDue.length > 0 ? "attention" : "normal";
  const greeting = getGreeting(timezone, locale);
  const dayStatus = tasksResource.error
    ? (locale === "it" ? "Impossibile caricare le priorità. Riprova dal widget attività." : "Could not load priorities. Retry from the tasks widget.")
    : tasksResource.loading && !taskData
      ? (locale === "it" ? "Caricamento delle attività della giornata..." : "Loading today’s tasks...")
      : visibleOverdue.length > 0
    ? (locale === "it" ? `${visibleOverdue.length} ${visibleOverdue.length === 1 ? "attività in ritardo" : "attività in ritardo"} da verificare` : `${visibleOverdue.length} overdue ${visibleOverdue.length === 1 ? "task" : "tasks"} to review`)
    : visibleDue.length > 0
      ? (locale === "it" ? `${visibleDue.length} attività da gestire oggi` : `${visibleDue.length} tasks to handle today`)
      : (locale === "it" ? "Nessuna urgenza: puoi dedicarti alla routine." : "No urgent items. You can focus on routine care.");

  async function complete(id: string) {
    setCompleting(id);
    try {
      setOptimisticallyCompleted((current) => current.includes(id) ? current : [...current, id]);
      const result = await api.post<{ nextTask: { dueAt: string } | null; nextDueAt: string | null }>(`/tasks/${id}/complete`);
      show(result.nextDueAt
        ? (locale === "it" ? `Attività completata. Prossima scadenza: ${formatDateTime(result.nextDueAt, locale, timezone)}` : `Task completed. Next due: ${formatDateTime(result.nextDueAt, locale, timezone)}`)
        : t("taskCompleted"));
      tasksResource.reload();
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
    const categoryIcon = category === "feeding" ? "feed" : category === "weighing" ? "weight" : category === "shed_check" ? "leaf" : category === "reproduction" || category === "incubation" ? "egg" : category === "inventory" ? "box" : category === "document" ? "file" : category === "health" ? "heart" : "calendar";
    const categoryLabel: Record<string, string> = { feeding: locale === "it" ? "Alimentazione" : "Feeding", weighing: locale === "it" ? "Peso" : "Weight", shed_check: locale === "it" ? "Muta" : "Shed", cleaning: locale === "it" ? "Pulizia" : "Cleaning", reproduction: locale === "it" ? "Riproduzione" : "Reproduction", incubation: locale === "it" ? "Incubazione" : "Incubation", document: locale === "it" ? "Documento" : "Document", inventory: locale === "it" ? "Scorte" : "Inventory", health: locale === "it" ? "Salute e veterinario" : "Health & veterinary", custom: locale === "it" ? "Personalizzata" : "Custom" };
    return <div className={`task-row dashboard-task-row${late ? " task-row-overdue" : ""}${isComplete ? " is-complete" : ""}`} key={id}>
      <button className={`task-check${isComplete ? " muted" : ""}`} aria-label={`${t("completeTask")}: ${task.title}`} disabled={isComplete || completing === id} onClick={() => void complete(id)}><Icon name="check" size={14} /></button>
      <div className="dashboard-task-content">
        <button className="task-main" aria-label={`${t("openTask")}: ${task.title}`} onClick={() => navigate(category === "health" ? "/companion-care" : `/tasks/${encodeURIComponent(id)}`)}>
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
      {!isComplete && <button className="dashboard-row-open" aria-label={t("openTask")} onClick={() => navigate(category === "health" ? "/companion-care" : `/tasks/${encodeURIComponent(id)}`)}><Icon name="chevron" size={16} /></button>}
    </div>;
  };


  return <div className="page-stack dashboard-page">
    <PageHeader eyebrow={formatDate(new Date(), locale, timezone)} title={t("dashboardTitle")} description={t("dashboardSubtitle")} action={<Button onClick={() => navigate("/calendar")} variant="secondary"><Icon name="calendar" size={16} />{t("openCalendar")}</Button>} />

    <div className={`dashboard-intro dashboard-intro-${dashboardTone}`} aria-live="polite">
      <div>
        <span className="eyebrow">{locale === "it" ? "PRIORITÀ DELL'ALLEVAMENTO" : "COLLECTION PRIORITIES"}</span>
        <h2>{greeting}</h2>
        <p>{dayStatus}</p>
      </div>
      <div className="intro-mark"><Icon name="leaf" size={34} /></div>
    </div>

    <div className="dashboard-mobile-actions" aria-label={locale === "it" ? "Azioni principali" : "Main actions"}>
      <Button onClick={() => navigate("/feeding?bulk=1")}><Icon name="feed" size={15} />{locale === "it" ? "Registra pasti" : "Record feedings"}</Button>
      <Button variant="secondary" onClick={() => navigate("/tasks?create=1")}><Icon name="calendar" size={15} />{t("addTask")}</Button>
      <Button variant="secondary" onClick={() => navigate("/animals?create=1")}><Icon name="snake" size={15} />{t("addAnimal")}</Button>
    </div>
    <div className="dashboard-first-steps">{widgetVisibility.onboarding && <OnboardingChecklist locale={locale} onNavigate={navigate} />}</div>
    <div className="dashboard-section-heading"><span className="eyebrow">{locale === "it" ? "01 — SITUAZIONE OPERATIVA" : "01 — DAILY OVERVIEW"}</span><p>{locale === "it" ? "Prima le scadenze, poi il resto." : "Deadlines first, everything else after."}</p></div>
    <div className="dashboard-grid">
      <div className="dashboard-widget-settings-panel"><Panel><PanelHeader title={locale === "it" ? "Personalizza dashboard" : "Customize dashboard"} action={<Button size="sm" variant="ghost" onClick={() => setWidgetSettingsOpen((open) => !open)}>{widgetSettingsOpen ? (locale === "it" ? "Chiudi" : "Close") : (locale === "it" ? "Configura" : "Configure")}</Button>} />{widgetSettingsOpen && <div className="dashboard-widget-settings"><Button size="sm" variant="secondary" onClick={resetDashboardLayout}>{locale === "it" ? "Ripristina layout" : "Reset layout"}</Button>{widgetOrder.map((key, index) => <div className="dashboard-widget-setting" key={key}><label><input type="checkbox" checked={widgetVisibility[key]} onChange={(event) => toggleWidget(key, event.target.checked)} />{widgetLabels[key]}</label><span><Button size="sm" variant="ghost" disabled={index === 0} onClick={() => moveWidget(key, -1)} aria-label={locale === "it" ? `Sposta ${widgetLabels[key]} su` : `Move ${widgetLabels[key]} up`}>↑</Button><Button size="sm" variant="ghost" disabled={index === widgetOrder.length - 1} onClick={() => moveWidget(key, 1)} aria-label={locale === "it" ? `Sposta ${widgetLabels[key]} giù` : `Move ${widgetLabels[key]} down`}>↓</Button></span></div>)}</div>}</Panel></div>
      {widgetVisibility.priorities && <div className="dashboard-widget dashboard-widget-priorities" style={{ order: 10 + widgetOrder.indexOf("priorities") * 10 }}>{tasksResource.loading && !taskData ? <Panel><Skeleton rows={7} /></Panel> : tasksResource.error ? <Panel><ErrorState message={tasksResource.error.message} retry={tasksResource.reload} /></Panel> : <Panel className="dashboard-tasks dashboard-priorities">
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
            <PanelHeader title={t("completedToday")} action={<Badge tone="success">{Math.max(counts?.completedToday ?? 0, completed.length)}</Badge>} />
            {completed.slice(0, 4).map((task) => taskCard(task, false, true))}
            {Boolean(truncated?.completedToday) && <p className="muted-note">{t("truncatedNotice")}</p>}
          </section>
        </>}
      </Panel>}</div>}

      <div className="dashboard-widget dashboard-collection-overview"><Panel>
        <PanelHeader title={locale === "it" ? "Panoramica di tutti gli animali" : "All animals overview"} action={<Button size="sm" variant="ghost" onClick={() => collectionResource.reload()}>{locale === "it" ? "Aggiorna" : "Refresh"}</Button>} />
        {collectionResource.loading && !collectionResource.data ? <Skeleton rows={3} /> : collectionResource.error ? <ErrorState message={collectionResource.error.message} retry={collectionResource.reload} /> : <>
          <div className="dashboard-overview-grid">
            <button className="dashboard-overview-item" onClick={() => navigate("/animals?status=active")}><strong>{collectionResource.data?.totals.active ?? 0}</strong><span>{locale === "it" ? "Attivi" : "Active"}</span></button>
            <button className="dashboard-overview-item" onClick={() => navigate("/animals?status=archived")}><strong>{collectionResource.data?.totals.archived ?? 0}</strong><span>{locale === "it" ? "Archiviati" : "Archived"}</span></button>
          </div>
          <div className="dashboard-collection-categories">{(collectionResource.data?.categories ?? []).map((item) => {
            const labels: Record<string, string> = { reptiles: locale === "it" ? "Rettili" : "Reptiles", fish: locale === "it" ? "Pesci" : "Fish", birds: locale === "it" ? "Uccelli" : "Birds", dogs_cats: locale === "it" ? "Cani e gatti" : "Dogs & cats" };
            return <button className="simple-row" key={item.category} onClick={() => navigate("/animals?category=" + encodeURIComponent(item.category))}><span><strong>{labels[item.category] ?? item.category}</strong><small>{item.active} {locale === "it" ? "attivi" : "active"} · {item.archived} {locale === "it" ? "archiviati" : "archived"}</small></span><Icon name="chevron" size={15} /></button>;
          })}</div>
          {(collectionResource.data?.upcoming.length ?? 0) > 0 && <><div className="panel-separator" /><h3>{locale === "it" ? "Scadenze nei prossimi 14 giorni" : "Due in the next 14 days"}</h3>{collectionResource.data?.upcoming.slice(0,5).map((item) => <button className="simple-row" key={item.id} onClick={() => navigate(item.targetPath)}><span><strong>{item.title}</strong><small>{item.animal?.name ?? (locale === "it" ? "Attività generale" : "General task")} · {formatDateTime(item.dueAt, locale, timezone)}</small></span><Icon name="calendar" size={15} /></button>)}</>}
          {(collectionResource.data?.recentNotes.length ?? 0) > 0 && <><div className="panel-separator" /><h3>{locale === "it" ? "Ultime note sugli animali" : "Latest animal notes"}</h3>{collectionResource.data?.recentNotes.slice(0,4).map((item) => <button className="simple-row" key={item.id} onClick={() => navigate(item.targetPath)}><span><strong>{item.title}</strong><small>{item.animal.name} · {formatDateTime(item.occurredAt, locale, timezone)}</small></span><Icon name="chevron" size={15} /></button>)}</>}
        </>}
      </Panel></div>
      <div className="dashboard-section-heading dashboard-section-heading-secondary dashboard-section-heading-operations"><span className="eyebrow">{locale === "it" ? "02 — OPERAZIONI" : "02 — OPERATIONS"}</span><p>{locale === "it" ? "Registra le attività di cura." : "Record routine care."}</p></div>
      <div className="dashboard-widget dashboard-bulk-feeding-widget"><Panel>
        <PanelHeader title={locale === "it" ? "Registrazione multipla delle alimentazioni" : "Bulk feeding registration"} />
        <p className="muted-note">{locale === "it" ? "Seleziona più animali, filtra per specie o rack, imposta data, alimento ed esito e registra tutto con un'unica operazione." : "Select multiple animals, filter by species or rack, set the date, food and outcome, then save everything in one operation."}</p>
        <Button onClick={() => navigate("/feeding?bulk=1")}><Icon name="feed" size={15} />{t("bulkFeeding")}</Button>
      </Panel></div>
      {widgetVisibility.quickActions && <div className="dashboard-widget" style={{ order: 10 + widgetOrder.indexOf("quickActions") * 10 }}><Panel>
          <PanelHeader title={t("quickActions")} />
          <div className="quick-action-grid">
            
            <QuickAction icon="weight" label={locale === "it" ? "Registra pesi" : "Record weights"} onClick={() => navigate("/animals")} />
            <QuickAction icon="leaf" label={locale === "it" ? "Registra mute" : "Record sheds"} onClick={() => navigate("/animals")} />
            <QuickAction icon="egg" label={locale === "it" ? "Riproduzione" : "Reproduction"} onClick={() => navigate("/reproduction-cycles")} />
            <QuickAction icon="calendar" label={t("addTask")} onClick={() => navigate("/tasks?create=1")} />
            <QuickAction icon="snake" label={t("addAnimal")} onClick={() => navigate("/animals?create=1")} />
          </div>
      </Panel></div>}

      {widgetVisibility.feedingAlerts && <div className="dashboard-widget" style={{ order: 10 + widgetOrder.indexOf("feedingAlerts") * 10 }}><Panel>
          <PanelHeader title={locale === "it" ? "Animali da controllare" : "Animals to check"} action={<Badge tone={feedingAlerts.length ? "danger" : "success"}>{feedingAlerts.length}</Badge>} />
          <p className="muted-note">{locale === "it" ? "Avvisi basati sull'intervallo di alimentazione configurato per ciascun animale." : "Alerts use each animal's configured feeding interval."}</p>
          {feedingAlertsResource.loading && !feedingAlertsResource.data ? <Skeleton rows={4} /> : feedingAlertsResource.error ? <ErrorState message={feedingAlertsResource.error.message} retry={feedingAlertsResource.reload} /> : feedingAlerts.length ? feedingAlerts.slice(0, 8).map((animal) => {
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
      {widgetVisibility.reminders && <div className="dashboard-widget" style={{ order: 10 + widgetOrder.indexOf("reminders") * 10 }}><Panel>
          <PanelHeader title={t("upcomingReminders")} action={<Button variant="ghost" size="sm" onClick={() => navigate("/tasks?tab=reminders")}>{t("viewAll")} <Icon name="arrow" size={14} /></Button>} />
          {remindersResource.loading && !remindersResource.data ? <Skeleton rows={4} /> : remindersResource.error ? <ErrorState message={remindersResource.error.message} retry={remindersResource.reload} /> : reminders.length
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
          {Boolean(remindersResource.data?.truncated) && <p className="muted-note">{t("truncatedNotice")}</p>}
      </Panel></div>}

      <div className="dashboard-section-heading dashboard-section-heading-secondary dashboard-section-heading-monitoring"><span className="eyebrow">{locale === "it" ? "03 — MONITORAGGIO" : "03 — MONITORING"}</span><p>{locale === "it" ? "Controlli e andamento dell’allevamento." : "Checks and collection activity."}</p></div>
      {widgetVisibility.recent && <div className="dashboard-widget" style={{ order: 10 + widgetOrder.indexOf("recent") * 10 }}><Panel className="dashboard-recent">
        <PanelHeader title={t("recentActivity")} action={<Button variant="ghost" size="sm" onClick={() => navigate("/animals")}>{t("viewAll")}</Button>} />
        {recentResource.loading && !recentResource.data ? <Skeleton rows={5} /> : recentResource.error ? <ErrorState message={recentResource.error.message} retry={recentResource.reload} /> : recent.length
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
                : eventType === "aquarium_reading" ? (locale === "it" ? rawTitle : rawTitle.replace("Misurazione:", "Water reading:"))
                : eventType === "aviary_movement" ? (locale === "it" ? rawTitle : rawTitle.replace("Spostamento:", "Bird moved:"))
                : eventType === "aviary_note" ? (locale === "it" ? rawTitle : rawTitle.replace("Nota:", "Aviary note:"))
                : rawTitle;
              return <button className="activity-row" key={`${eventType}-${index}`} onClick={() => navigate(target || "/animals")}>
                <span className="activity-dot"><Icon name={eventType === "feeding" ? "feed" : eventType === "weight" ? "weight" : eventType === "reproduction" || eventType === "birth" ? "egg" : eventType === "incubation" ? "clock" : eventType === "animal_update" ? "edit" : eventType === "aquarium_reading" ? "droplet" : eventType === "aviary_movement" ? "bird" : eventType === "aviary_note" || eventType === "note" ? "file" : "leaf"} size={15} /></span>
                <span className="activity-copy"><strong>{eventTitle}</strong><small>{formatDateTime(getString(event, "occurredAt"), locale, timezone)}</small></span>
                <Icon name="chevron" size={15} />
              </button>;
            })}</div>
          : <EmptyState title={t("noRecentActivity")} description={t("recentActivityEmptyHint")} action={<Button size="sm" variant="secondary" onClick={() => navigate("/animals")}>{t("navAnimals")}</Button>} />}
      </Panel></div>}

      {widgetVisibility.summary && <div className="dashboard-widget dashboard-widget-summary" style={{ order: 10 + widgetOrder.indexOf("summary") * 10 }}>{overviewResource.loading && !overview ? <Panel><Skeleton rows={5} /></Panel> : overviewResource.error ? <Panel><ErrorState message={overviewResource.error.message} retry={overviewResource.reload} /></Panel> : <Panel className="dashboard-summary">
      <PanelHeader title={locale === "it" ? "Stato dell'allevamento" : "Collection overview"} />
      <div className="dashboard-overview-grid" aria-label={locale === "it" ? "Indicatori dell'allevamento" : "Collection indicators"}>
        <button className="dashboard-overview-item" onClick={() => navigate("/animals?status=active")}>
          <strong>{overview?.activeAnimals ?? 0}</strong><span>{locale === "it" ? "Animali attivi" : "Active animals"}</span>
        </button>
        <button className="dashboard-overview-item" onClick={() => navigate("/feeding")}>
          <strong>{overview?.feedingsToday ?? 0}</strong><span>{locale === "it" ? "Alimentazioni oggi" : "Feedings today"}</span>
        </button>
        <button className="dashboard-overview-item dashboard-overview-item-stock" onClick={() => navigate("/inventory?lowStock=true")}>
          <strong>{overview?.lowStockCount ?? 0}</strong><span>{locale === "it" ? "Scorte basse" : "Low stock"}</span>
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
      </Panel>}</div>}
    </div>
    <div className="dashboard-account-widgets">
      <div className="dashboard-section-heading"><span className="eyebrow">{locale === "it" ? "04 — ACCOUNT" : "04 — ACCOUNT"}</span><p>{locale === "it" ? "Piano e impostazioni, separati dal lavoro quotidiano." : "Plan and settings, separate from daily work."}</p></div>
      {widgetVisibility.plan && <div className="dashboard-account-widget" style={{ order: widgetOrder.indexOf("plan") }}><PlanUsageSummary locale={locale} compact onNavigate={navigate} /></div>}
    </div>
    {toast}
  </div>;
}

function getObject(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return null;
  return (value as Record<string, unknown>)[key] ?? null;
}

function formatDate(value: Date, locale: Locale, timezone: string): string {
  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: timezone }).format(value);
}

function getGreeting(timezone: string, locale: Locale): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: timezone }).format(new Date()));
  if (locale === "it") return hour < 12 ? "Buongiorno" : hour < 18 ? "Buon pomeriggio" : "Buonasera";
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function QuickAction({ label, icon, onClick }: { label: string; icon: "snake" | "feed" | "weight" | "calendar" | "leaf" | "egg"; onClick: () => void }) {
  return <button className="quick-action" onClick={onClick}><span><Icon name={icon} size={19} /></span><strong>{label}</strong><Icon name="arrow" size={14} /></button>;
}
