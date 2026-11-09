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
