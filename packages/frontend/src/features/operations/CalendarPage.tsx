import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "../../lib/api";
import { formatDate, formatDateTime, getArray, getString, localDateTimeValue, queryString, todayDate } from "../../lib/domain";
import type { Locale } from "../../lib/domain";
import type { CalendarItemDto, ReminderRuleDto, TaskDto } from "@vivarqo/contracts/operations";
import { dateString, eventDayInTimezone, shiftDate, weekStart } from "./date-utils";
import { translate } from "../../lib/i18n";
import { useResource } from "../../hooks/useResource";
import { RemoteSelect } from "../../components/RemoteSelect";
import { Alert, Badge, Button, EmptyState, ErrorState, Field, Icon, IconButton, Input, LoadingState, Modal, PageHeader, Pagination, Panel, PanelHeader, Select, Textarea, useToast } from "../../components/ui";
export function CalendarPage({ locale, timezone, navigate }: { locale: Locale; timezone: string; navigate: (path: string) => void }) {
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
  const resource = useResource<{ items: CalendarItemDto[]; truncated?: boolean }>(url);
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
  function itemClick(item: CalendarItemDto) {
    const target = getString(item, "targetPath");
    if (target) navigate(target);
  }
  return <div className="page-stack">
    <PageHeader eyebrow={t("navWorkspace")} title={t("calendarTitle")} description={locale === "it" ? "Attività e appuntamenti riproduttivi in un'unica vista." : "Tasks and breeding events in one shared view."} action={<Button onClick={() => navigate("/tasks?create=1")}><Icon name="plus" />{t("addTask")}</Button>} />
    <Panel className="calendar-toolbar"><div className="calendar-nav"><Button variant="secondary" size="sm" aria-label={locale === "it" ? (view === "month" ? "Mese precedente" : view === "week" ? "Settimana precedente" : "Periodo precedente") : (view === "month" ? "Previous month" : view === "week" ? "Previous week" : "Previous period")} onClick={() => move(-1)}><Icon name="chevron" size={15} /></Button><Button variant="secondary" size="sm" onClick={() => setFocus(new Date())}>{t("today")}</Button><Button variant="secondary" size="sm" aria-label={locale === "it" ? (view === "month" ? "Mese successivo" : view === "week" ? "Settimana successiva" : "Periodo successivo") : (view === "month" ? "Next month" : view === "week" ? "Next week" : "Next period")} onClick={() => move(1)}><Icon name="chevron" size={15} /></Button><strong>{title}</strong></div><div className="segmented">{(["month", "week", "list"] as const).map((value) => <button className={view === value ? "selected" : ""} onClick={() => setView(value)} key={value}>{t(value)}</button>)}</div></Panel>
    {resource.loading && !resource.data ? <LoadingState /> : resource.error ? <ErrorState message={resource.error.message} retry={resource.reload} /> : view === "list" ? <Panel>
      {items.length ? <div className="calendar-list">{items.map((item) => <button className="calendar-list-row" key={getString(item, "id")} onClick={() => itemClick(item)}><span className="calendar-date-block"><strong>{formatDate(getString(item, "start"), locale, { day: "2-digit" }).replace(/[^d]/g, "")}</strong><small>{new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", { month: "short" }).format(new Date(getString(item, "start")))}</small></span><span className="calendar-item-copy"><strong>{getString(item, "title")}</strong><small>{getString(item, "type")} · {formatDateTime(getString(item, "start"), locale, timezone)}</small></span><Badge>{getString(item, "status")}</Badge><Icon name="chevron" /></button>)}</div> : <EmptyState title={t("noCalendarEvents")} />}</Panel> : <Panel className="calendar-panel">
      {view === "month" && <div className="calendar-weekday-row">{weekDays.map((day) => <span key={day}>{day}</span>)}</div>}
      <div className={view === "month" ? "calendar-grid month-grid" : "calendar-grid week-grid"}>
        {days.map((day) => {
          const date = dateString(day);
          const dayItems = items.filter((item) => eventDayInTimezone(getString(item, "start"), timezone) === date);
          const inMonth = day.getMonth() === focus.getMonth();
          return <div className={`calendar-day ${inMonth || view === "week" ? "" : "out-month"}`} key={date}>
            <button className={`calendar-day-number ${date === todayDate() ? "today" : ""}`} aria-label={(locale === "it" ? "Vai al " : "Go to ") + day.toLocaleDateString(locale === "it" ? "it-IT" : "en-GB", { dateStyle: "full" })} aria-current={date === todayDate() ? "date" : undefined} onClick={() => { setFocus(day); setView("list"); }}>{day.getDate()}</button>
            <div className="calendar-day-items">{dayItems.slice(0, view === "month" ? 3 : 12).map((item) => <button className={`calendar-event event-${getString(item, "type")}`} key={getString(item, "id")} onClick={() => itemClick(item)}><span>{getString(item, "title")}</span></button>)}{dayItems.length > (view === "month" ? 3 : 12) && <small>+{dayItems.length - (view === "month" ? 3 : 12)}</small>}</div>
          </div>;
        })}
      </div>
      {resource.data?.truncated && <p className="muted-note">{t("truncatedNotice")}</p>}
    </Panel>}
    <div className="calendar-legend"><span><i className="legend-dot task" />{t("tasksTitle")}</span><span><i className="legend-dot reproduction" />{t("navBreeding")}</span><span><i className="legend-dot clutch" />{t("clutches")}</span></div>
  </div>;
}