import type { Locale } from "../lib/domain";
import { TasksPage } from "./operations/TasksPage";
import { CalendarPage } from "./operations/CalendarPage";

export function OperationsPage({ locale, path, timezone, navigate }: { locale: Locale; path: string; timezone: string; navigate: (path: string) => void }) {
  if (path.startsWith("/calendar")) return <CalendarPage locale={locale} timezone={timezone} navigate={navigate} />;
  return <TasksPage locale={locale} path={path} timezone={timezone} navigate={navigate} />;
}
