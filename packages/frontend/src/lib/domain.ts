export type Locale = "it" | "en";
export type WeightUnit = "g" | "kg" | "oz" | "lb";
export type TemperatureUnit = "c" | "f";
export type DateFormat = "locale" | "dd/MM/yyyy" | "yyyy-MM-dd";
export type DisplayPreferences = { weightUnit: WeightUnit; temperatureUnit: TemperatureUnit; dateFormat: DateFormat; compactTables: boolean; timezone: string };
type RecordValue = Record<string, unknown>;
let activeDisplayPreferences: DisplayPreferences = { weightUnit: "g", temperatureUnit: "c", dateFormat: "locale", compactTables: false, timezone: "Europe/Rome" };
export function setDisplayPreferences(value: Partial<DisplayPreferences>): void { activeDisplayPreferences = { ...activeDisplayPreferences, ...value }; }
export function getDisplayPreferences(): DisplayPreferences { return { ...activeDisplayPreferences }; }
export function weightToGrams(value: number | string, unit = activeDisplayPreferences.weightUnit): number {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error("Invalid weight");
  const factor: Record<WeightUnit, number> = { g: 1, kg: 1000, oz: 28.349523125, lb: 453.59237 };
  const grams = amount * factor[unit];
  if (!Number.isFinite(grams) || grams < 0) throw new Error("Invalid weight");
  return grams;
}
export function gramsToWeight(value: number | string, unit = activeDisplayPreferences.weightUnit): number {
  const grams = Number(value);
  if (!Number.isFinite(grams)) return 0;
  const factor: Record<WeightUnit, number> = { g: 1, kg: 1000, oz: 28.349523125, lb: 453.59237 };
  return grams / factor[unit];
}
export function formatWeight(value: number | string, locale: Locale, unit = activeDisplayPreferences.weightUnit): string {
  const digits = unit === "g" ? 0 : unit === "kg" ? 3 : 2;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(gramsToWeight(value, unit)) + " " + unit;
}
export function temperatureToCelsius(value: number | string, unit = activeDisplayPreferences.temperatureUnit): number {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error("Invalid temperature");
  return unit === "f" ? (amount - 32) * 5 / 9 : amount;
}
export function celsiusToTemperature(value: number | string, unit = activeDisplayPreferences.temperatureUnit): number {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return unit === "f" ? amount * 9 / 5 + 32 : amount;
}
export function formatTemperature(valueC: number | string, locale: Locale, unit = activeDisplayPreferences.temperatureUnit): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(celsiusToTemperature(valueC, unit)) + (unit === "f" ? " °F" : " °C");
}
export function temperatureUnitLabel(): string { return activeDisplayPreferences.temperatureUnit === "f" ? "°F" : "°C"; }
export function weightUnitLabel(): string { return activeDisplayPreferences.weightUnit; }

export function getString(value: unknown, key: string, fallback = ""): string {
  if (typeof value !== "object" || value === null) return fallback;
  const field = (value as RecordValue)[key];
  if (typeof field === "string") return field;
  if (typeof field === "number" || typeof field === "bigint") return String(field);
  if (field instanceof Date && !Number.isNaN(field.getTime())) return field.toISOString();
  return fallback;
}
export function getNumber(value: unknown, key: string, fallback = 0): number {
  if (typeof value !== "object" || value === null) return fallback;
  const field = (value as RecordValue)[key];
  if (typeof field === "number" && Number.isFinite(field)) return field;
  if (typeof field === "string" && field.trim() && Number.isFinite(Number(field))) return Number(field);
  return fallback;
}
export function getArray<T>(value: unknown, key: string): T[] {
  if (typeof value !== "object" || value === null) return [];
  const field = (value as RecordValue)[key];
  return Array.isArray(field) ? field as T[] : [];
}
export function queryString(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const result = search.toString();
  return result ? "?" + result : "";
}
function validDateParts(value: string): [number, number, number] | null {
  // Date-only values are deliberately strict. An ISO timestamp must be
  // interpreted as an instant in the account timezone, never as YYYY-MM-DD.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day ? [year, month, day] : null;
}
type ZonedDateParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };
function datePartsInTimezone(date: Date, timezone: string): ZonedDateParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  return {
    year: values.year!, month: values.month!, day: values.day!,
    hour: values.hour!, minute: values.minute!, second: values.second!
  };
}
function pad2(value: number): string { return String(value).padStart(2, "0"); }
function dateOnlyString(parts: Pick<ZonedDateParts, "year" | "month" | "day">): string {
  return String(parts.year).padStart(4, "0") + "-" + pad2(parts.month) + "-" + pad2(parts.day);
}
export function formatDate(value: string | Date | null | undefined, locale: Locale, options: Intl.DateTimeFormatOptions = {}): string {
  if (!value) return "—";
  const parts = typeof value === "string" ? validDateParts(value) : null;
  const date = parts ? new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12)) : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const timezone = parts ? "UTC" : activeDisplayPreferences.timezone;
  if (!Object.keys(options).length && activeDisplayPreferences.dateFormat !== "locale") {
    const values = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(date);
    const pick = (type: string) => values.find((part) => part.type === type)?.value ?? "";
    const year = pick("year"), month = pick("month"), day = pick("day");
    return activeDisplayPreferences.dateFormat === "dd/MM/yyyy" ? day + "/" + month + "/" + year : year + "-" + month + "-" + day;
  }
  const formatterOptions: Intl.DateTimeFormatOptions = {
    ...(Object.keys(options).length > 0 ? options : { dateStyle: "medium" }),
    timeZone: options.timeZone ?? timezone
  };
  return new Intl.DateTimeFormat(locale, formatterOptions).format(date);
}
export function formatDateTime(value: string | null | undefined, locale: Locale, timezone = activeDisplayPreferences.timezone): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(date);
}
/** Formats a stored instant for a datetime-local control in the account timezone. */
export function dateTimeInputValue(value: string | Date | null | undefined, timezone = activeDisplayPreferences.timezone): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = datePartsInTimezone(date, timezone);
  return dateOnlyString(parts) + "T" + pad2(parts.hour) + ":" + pad2(parts.minute);
}
/**
 * Converts an account-local datetime-local value to an ISO UTC instant.
 * Non-existent wall-clock times during the spring DST transition are rejected.
 * For the repeated hour in autumn, the same later/standard-time occurrence as
 * the backend's zonedDateTimeToUtc implementation is selected deterministically.
 */
export function dateTimeInputToUtc(value: string, timezone = activeDisplayPreferences.timezone): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new RangeError("Enter a valid local date and time");
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part ?? 0));
  const calendarCheck = new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!, second!));
  if (
    calendarCheck.getUTCFullYear() !== year || calendarCheck.getUTCMonth() !== month! - 1 ||
    calendarCheck.getUTCDate() !== day || hour! > 23 || minute! > 59 || second! > 59
  ) throw new RangeError("Enter a valid local date and time");

  const wallClockAsUtc = Date.UTC(year!, month! - 1, day!, hour!, minute!, second!);
  let candidate = wallClockAsUtc;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const represented = datePartsInTimezone(new Date(candidate), timezone);
    const representedAsUtc = Date.UTC(
      represented.year, represented.month - 1, represented.day,
      represented.hour, represented.minute, represented.second
    );
    const correction = representedAsUtc - wallClockAsUtc;
    if (correction === 0) break;
    candidate -= correction;
  }

  const resolved = datePartsInTimezone(new Date(candidate), timezone);
  if (
    resolved.year !== year || resolved.month !== month || resolved.day !== day ||
    resolved.hour !== hour || resolved.minute !== minute || resolved.second !== second
  ) throw new RangeError("This local time does not exist because the account timezone changes clocks");
  return new Date(candidate).toISOString();
}
export function dateForInput(value: string | null | undefined): string {
  if (!value) return "";
  const parts = validDateParts(value);
  if (parts) return dateOnlyString({ year: parts[0], month: parts[1], day: parts[2] });
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return dateOnlyString(datePartsInTimezone(date, activeDisplayPreferences.timezone));
}
export function todayDate(now = new Date(), timezone = activeDisplayPreferences.timezone): string {
  return dateOnlyString(datePartsInTimezone(now, timezone));
}
/** Formats an instant as the account-local value expected by datetime-local. */
export function localDateTimeValue(date = new Date(), timezone = activeDisplayPreferences.timezone): string {
  return dateTimeInputValue(date, timezone);
}
export function amountToCents(value: string): number {
  const normalized = value.trim().replace(",", ".");
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) throw new Error("Enter an amount with up to two decimal places");
  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error("Amount must be greater than zero and safely representable");
  return cents;
}
export function centsToAmount(cents: string | number | bigint): number {
  const value = typeof cents === "bigint" ? cents : BigInt(String(cents));
  const sign = value < 0n ? -1 : 1;
  const absolute = value < 0n ? -value : value;
  const whole = absolute / 100n;
  const fraction = Number(absolute % 100n);
  const result = Number(whole) + fraction / 100;
  return sign * result;
}
export function formatMoneyCents(cents: string | number | bigint, locale: Locale, currency = "EUR"): string {
  const amount = centsToAmount(cents);
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}
export function formatNumber(value: string | number, locale: Locale, maximumFractionDigits = 2): string {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat(locale, { maximumFractionDigits }).format(number) : "—";
}
