import type { Locale, WeightUnit, TemperatureUnit, DateFormat } from "../lib/domain";
import type { SettingsUserDto } from "@vivarqo/contracts/settings";
import { AccountSettingsPage } from "./settings/AccountSettingsPage";
import { NotificationsPage } from "./settings/NotificationsPage";
import { NotificationSettingsPage } from "./settings/NotificationSettingsPage";
import { BillingPage } from "./settings/BillingPage";

export function SettingsPage({ locale, path, user, onLocaleChange, onUserUpdated, onThemeChange, onDisplayPreferencesChange, navigate }: {
  locale: Locale; path: string; user: SettingsUserDto; onLocaleChange: (locale: Locale) => void; onUserUpdated: (user: SettingsUserDto) => void;
  onThemeChange: (theme: "system" | "light" | "dark") => void;
  onDisplayPreferencesChange: (preferences: { weightUnit: WeightUnit; temperatureUnit: TemperatureUnit; dateFormat: DateFormat; compactTables: boolean }) => void;
  navigate: (path: string) => void;
}) {
  if (path.startsWith("/notifications")) return <NotificationsPage locale={locale} navigate={navigate} />;
  if (path.startsWith("/settings/notifications")) return <NotificationSettingsPage locale={locale} />;
  if (path.startsWith("/billing")) return <BillingPage locale={locale} />;
  return <AccountSettingsPage locale={locale} user={user} onLocaleChange={onLocaleChange} onUserUpdated={onUserUpdated}
    onThemeChange={onThemeChange} onDisplayPreferencesChange={onDisplayPreferencesChange} navigate={navigate} />;
}
