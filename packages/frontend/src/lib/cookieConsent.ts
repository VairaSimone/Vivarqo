export type OptionalCookieCategory = "analytics" | "marketing";
export type OptionalCookieService = { id: string; name: string; purpose: string; category: OptionalCookieCategory };

/** Keep empty until optional technologies are audited and documented. */
export const OPTIONAL_COOKIE_SERVICES: readonly OptionalCookieService[] = [];
export const COOKIE_POLICY_VERSION = "2026-11-14.1";
const STORAGE_KEY = "vivarqo:cookie-preferences";
export const OPEN_COOKIE_PREFERENCES_EVENT = "vivarqo:open-cookie-preferences";
export type CookiePreferenceRecord = { version: string; updatedAt: string; noticeAcknowledged: boolean; services: Record<string, boolean> };

export function readCookiePreferences(): CookiePreferenceRecord | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const record = value as Partial<CookiePreferenceRecord>;
    if (typeof record.version !== "string" || typeof record.updatedAt !== "string" || typeof record.noticeAcknowledged !== "boolean" || !record.services || typeof record.services !== "object" || Array.isArray(record.services)) return null;
    return { version: record.version, updatedAt: record.updatedAt, noticeAcknowledged: record.noticeAcknowledged, services: record.services as Record<string, boolean> };
  } catch { return null; }
}

export function saveCookiePreferences(services: Record<string, boolean>, noticeAcknowledged = true): CookiePreferenceRecord {
  const record: CookiePreferenceRecord = {
    version: COOKIE_POLICY_VERSION,
    updatedAt: new Date().toISOString(),
    noticeAcknowledged,
    services: Object.fromEntries(OPTIONAL_COOKIE_SERVICES.map((service) => [service.id, services[service.id] === true]))
  };
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record)); }
  catch { /* Storage can be unavailable; current page state still applies for this visit. */ }
  return record;
}

export function hasOptionalCookieConsent(serviceId: string): boolean {
  if (!OPTIONAL_COOKIE_SERVICES.some((service) => service.id === serviceId)) return false;
  const record = readCookiePreferences();
  return record?.version === COOKIE_POLICY_VERSION && record.services[serviceId] === true;
}

export function cookiePreferencesAreComplete(record: CookiePreferenceRecord | null): boolean {
  if (!record || record.version !== COOKIE_POLICY_VERSION) return false;
  if (OPTIONAL_COOKIE_SERVICES.length === 0) return record.noticeAcknowledged;
  return OPTIONAL_COOKIE_SERVICES.every((service) => typeof record.services[service.id] === "boolean");
}

export function openCookiePreferences(): void {
  window.dispatchEvent(new Event(OPEN_COOKIE_PREFERENCES_EVENT));
}
