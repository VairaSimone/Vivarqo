import { AppError } from "../../errors/app-error.js";

function dateParts(date: Date, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
}

export function localDateFor(date: Date, timeZone: string): string {
  const parts = dateParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const moved = new Date(Date.UTC(year!, month! - 1, day! + days));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, "0")}-${String(moved.getUTCDate()).padStart(2, "0")}`;
}

export function assertValidLocalDate(date: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new AppError(400, "VALIDATION_ERROR", "Dates must use YYYY-MM-DD");
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (parsed.toISOString().slice(0, 10) !== date) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid calendar date");
  }
}

export function zonedDateTimeToUtc(date: string, time: string, timeZone: string): Date {
  assertValidLocalDate(date);
  let candidate = Date.parse(`${date}T${time}Z`);
  if (!Number.isFinite(candidate)) throw new AppError(400, "VALIDATION_ERROR", "Invalid date/time");
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = dateParts(new Date(candidate), timeZone);
      const represented = Date.UTC(
        parts.year!,
        parts.month! - 1,
        parts.day!,
        parts.hour!,
        parts.minute!,
        parts.second!,
      );
      const correction = represented - candidate;
      if (correction === 0) break;
      candidate -= correction;
    }
  } catch {
    throw new AppError(400, "INVALID_TIMEZONE", "The account timezone is invalid");
  }
  return new Date(candidate);
}

export function localDayBounds(date: string, timeZone: string): { start: Date; end: Date; nextDate: string } {
  assertValidLocalDate(date);
  const nextDate = addCalendarDays(date, 1);
  return {
    start: zonedDateTimeToUtc(date, "00:00:00", timeZone),
    end: zonedDateTimeToUtc(nextDate, "00:00:00", timeZone),
    nextDate,
  };
}

export function addDaysAtLocalTime(date: Date, days: number, timeZone: string): Date {
  const parts = dateParts(date, timeZone);
  const dateString = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  const nextDate = addCalendarDays(dateString, days);
  const time = `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")}`;
  return zonedDateTimeToUtc(nextDate, time, timeZone);
}

export function parseDateBound(value: string | undefined, timeZone: string, endExclusive = false): Date | undefined {
  if (value === undefined) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const bounds = localDayBounds(value, timeZone);
    return endExclusive ? bounds.end : bounds.start;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AppError(400, "VALIDATION_ERROR", "Invalid date filter");
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
    throw new AppError(400, "VALIDATION_ERROR", "Date-time filters must include a timezone offset");
  }
  return date;
}
