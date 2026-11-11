import { useEffect, useMemo, useState } from "react";
import { formatDate, formatDateTime, getString, queryString, todayDate } from "../../lib/domain";
import type { Locale } from "../../lib/domain";
import type { CalendarItemDto } from "@vivarqo/contracts/operations";
import { dateFromDateString, dateString, eventDayInTimezone, shiftDate, weekStart } from "./date-utils";
import { translate } from "../../lib/i18n";
import { useResource } from "../../hooks/useResource";
import { Badge, Button, EmptyState, ErrorState, Icon, LoadingState, PageHeader, Panel } from "../../components/ui";

export function CalendarPage({ locale, timezone, navigate }: { locale: Locale; timezone: string; navigate: (path: string) => void }) {
  const t = (key: string) => translate(locale, key);
  const today = todayDate(new Date(), timezone);
  const [view, setView] = useState<"month" | "week" | "list">("month");
  const [focus, setFocus] = useState(() => dateFromDateString(todayDate(new Date(), timezone)));

  // A timezone change can move the account into a different calendar day.
  useEffect(() => {
    setFocus(dateFromDateString(todayDate(new Date(), timezone)));
  }, [timezone]);

  const start = useMemo(() => {
    const year = focus.getUTCFullYear();
    const month = focus.getUTCMonth();
    if (view === "month") return weekStart(new Date(Date.UTC(year, month, 1, 12)));
    if (view === "week") return weekStart(focus);
    return new Date(Date.UTC(year, month, 1, 12));
  }, [focus, view]);
  const end = useMemo(() => {
    if (view === "month") return shiftDate(start, 41);
    if (view === "week") return shiftDate(start, 6);
    return new Date(Date.UTC(focus.getUTCFullYear(), focus.getUTCMonth() + 1, 0, 12));
  }, [start, view, focus]);
  const url = "/calendar" + queryString({ from: dateString(start), to: dateString(end), view });
  const resource = useResource<{ items: CalendarItemDto[]; truncated?: boolean }>(url);
  const items = resource.data?.items ?? [];
  const days = useMemo(
    () => Array.from({ length: Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1 }, (_, index) => shiftDate(start, index)),
    [start, end]
  );

  function move(offset: number) {
    const next = new Date(focus);
    if (view === "month") next.setUTCMonth(next.getUTCMonth() + offset);
    else next.setUTCDate(next.getUTCDate() + offset * (view === "week" ? 7 : 30));
    setFocus(next);
  }

  const monthFormatter = new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", {
    month: "long", year: "numeric", timeZone: "UTC"
  });
  const title = view === "month" || view === "list"
    ? monthFormatter.format(focus)
    : formatDate(dateString(start), locale) + " – " + formatDate(dateString(end), locale);
  const weekDays = locale === "it" ? ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"] : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  function itemClick(item: CalendarItemDto) {
    const target = getString(item, "targetPath");
    if (target) navigate(target);
  }

  return <div className="page-stack">
    <PageHeader eyebrow={t("navWorkspace")} title={t("calendarTitle")} description={locale === "it" ? "Attività e appuntamenti riproduttivi in un'unica vista." : "Tasks and breeding events in one shared view."} action={<Button onClick={() => navigate("/tasks?create=1")}><Icon name="plus" />{t("addTask")}</Button>} />
    <Panel className="calendar-toolbar">
      <div className="calendar-nav">
        <Button variant="secondary" size="sm" aria-label={locale === "it" ? (view === "month" ? "Mese precedente" : view === "week" ? "Settimana precedente" : "Periodo precedente") : (view === "month" ? "Previous month" : view === "week" ? "Previous week" : "Previous period")} onClick={() => move(-1)}><Icon name="chevron" size={15} /></Button>
        <Button variant="secondary" size="sm" onClick={() => setFocus(dateFromDateString(today))}>{t("today")}</Button>
        <Button variant="secondary" size="sm" aria-label={locale === "it" ? (view === "month" ? "Mese successivo" : view === "week" ? "Settimana successiva" : "Periodo successivo") : (view === "month" ? "Next month" : view === "week" ? "Next week" : "Next period")} onClick={() => move(1)}><Icon name="chevron" size={15} /></Button>
        <strong>{title}</strong>
      </div>
      <div className="segmented">{(["month", "week", "list"] as const).map((value) => <button className={view === value ? "selected" : ""} onClick={() => setView(value)} key={value}>{t(value)}</button>)}</div>
    </Panel>
    {resource.loading && !resource.data ? <LoadingState /> : resource.error ? <ErrorState message={resource.error.message} retry={resource.reload} /> : view === "list" ? <Panel>
      {items.length ? <div className="calendar-list">{items.map((item) => <button className="calendar-list-row" key={getString(item, "id")} onClick={() => itemClick(item)}>
        <span className="calendar-date-block"><strong>{formatDate(getString(item, "start"), locale, { day: "2-digit", timeZone: timezone }).replace(/\D/g, "")}</strong><small>{formatDate(getString(item, "start"), locale, { month: "short", timeZone: timezone })}</small></span>
        <span className="calendar-item-copy"><strong>{getString(item, "title")}</strong><small>{getString(item, "type")} · {formatDateTime(getString(item, "start"), locale, timezone)}</small></span>
        <Badge>{getString(item, "status")}</Badge><Icon name="chevron" />
      </button>)}</div> : <EmptyState title={t("noCalendarEvents")} />}
    </Panel> : <Panel className="calendar-panel">
      {view === "month" && <div className="calendar-weekday-row">{weekDays.map((day) => <span key={day}>{day}</span>)}</div>}
      <div className={view === "month" ? "calendar-grid month-grid" : "calendar-grid week-grid"}>
        {days.map((day) => {
          const date = dateString(day);
          const dayItems = items.filter((item) => eventDayInTimezone(getString(item, "start"), timezone) === date);
          const inMonth = day.getUTCMonth() === focus.getUTCMonth();
          const isToday = date === today;
          return <div className={"calendar-day " + (inMonth || view === "week" ? "" : "out-month")} key={date}>
            <button className={"calendar-day-number " + (isToday ? "today" : "")} aria-label={(locale === "it" ? "Vai al " : "Go to ") + formatDate(date, locale, { dateStyle: "full", timeZone: "UTC" })} aria-current={isToday ? "date" : undefined} onClick={() => { setFocus(day); setView("list"); }}>{day.getUTCDate()}</button>
            <div className="calendar-day-items">{dayItems.slice(0, view === "month" ? 3 : 12).map((item) => <button className={"calendar-event event-" + getString(item, "type")} key={getString(item, "id")} onClick={() => itemClick(item)}><span>{getString(item, "title")}</span></button>)}{dayItems.length > (view === "month" ? 3 : 12) && <small>+{dayItems.length - (view === "month" ? 3 : 12)}</small>}</div>
          </div>;
        })}
      </div>
      {resource.data?.truncated && <p className="muted-note">{t("truncatedNotice")}</p>}
    </Panel>}
    <div className="calendar-legend"><span><i className="legend-dot task" />{t("tasksTitle")}</span><span><i className="legend-dot reproduction" />{t("navBreeding")}</span><span><i className="legend-dot clutch" />{t("clutches")}</span></div>
  </div>;
}
