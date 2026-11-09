import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { formatDate, formatDateTime, getArray, getString } from "../lib/domain";
import type { DateFormat, Locale, TemperatureUnit, WeightUnit } from "../lib/domain";
import { translate } from "../lib/i18n";
import { useResource } from "../hooks/useResource";
import { Alert, Badge, Button, EmptyState, ErrorState, Field, Icon, IconButton, Input, LoadingState, Modal, PageHeader, Panel, PanelHeader, Select, Textarea, useToast } from "../components/ui";
export function AccountSettingsPage({ locale, user, onLocaleChange, onUserUpdated, onThemeChange, onDisplayPreferencesChange, navigate }: {
  locale: Locale; user: SettingsUserDto; onLocaleChange: (locale: Locale) => void; onUserUpdated: (user: User) => void;
  onThemeChange: (theme: "system" | "light" | "dark") => void;
  onDisplayPreferencesChange: (preferences: { weightUnit: WeightUnit; temperatureUnit: TemperatureUnit; dateFormat: DateFormat; compactTables: boolean }) => void;
  navigate: (path: string) => void;
}) {
  const t = (key: string) => translate(locale, key);
  const prefs = useResource<{ preferences: AccountPreferencesDto }>("/account/preferences");
  const [profile, setProfile] = useState({ displayName: user.displayName, email: user.email, timezone: user.timezone || "Europe/Rome", currentPassword: "" });
  const [preferences, setPreferences] = useState({ weightUnit: "g", temperatureUnit: "c", dateFormat: "locale", defaultLandingPage: "today", compactTables: false, theme: "system" });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "" });
  const [deleteForm, setDeleteForm] = useState({ currentPassword: "", confirmation: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const { toast, show: showToast } = useToast();

  useEffect(() => {
    if (prefs.data?.preferences) {
      const value = prefs.data.preferences;
      setPreferences({
        weightUnit: getString(value, "weightUnit", "g"),
        temperatureUnit: getString(value, "temperatureUnit", "c"),
        dateFormat: getString(value, "dateFormat", "locale"),
        defaultLandingPage: getString(value, "defaultLandingPage", "today"),
        compactTables: Boolean(value.compactTables),
        theme: getString(value, "theme", "system")
      });
    }
  }, [prefs.data]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const emailChanged = profile.email !== user.email;
    try {
      const body: Record<string, string> = { displayName: profile.displayName, timezone: profile.timezone };
      if (emailChanged) { body.email = profile.email; body.currentPassword = profile.currentPassword; }
      const result = await api.patch<{ user?: User }>("/account", body);
      if (emailChanged) {
        showToast(locale === "it" ? "Richiesta inviata. Verifica il nuovo indirizzo email, poi accedi di nuovo." : "Request sent. Verify the new email address, then sign in again.");
        setProfile((current) => ({ ...current, currentPassword: "" }));
        navigate("/login");
        return;
      }
      if (result.user) onUserUpdated(result.user);
      else {
        const current = await api.get<{ user: User }>("/auth/me");
        onUserUpdated(current.user);
      }
      showToast(t("saveSuccess"));
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  async function savePreferences(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await api.patch("/account/preferences", preferences);
      const theme = preferences.theme === "dark" || preferences.theme === "light" ? preferences.theme : "system";
      onThemeChange(theme);
      onDisplayPreferencesChange({
        weightUnit: (["g", "kg", "oz", "lb"].includes(preferences.weightUnit) ? preferences.weightUnit : "g") as WeightUnit,
        temperatureUnit: (["c", "f"].includes(preferences.temperatureUnit) ? preferences.temperatureUnit : "c") as TemperatureUnit,
        dateFormat: (["locale", "dd/MM/yyyy", "yyyy-MM-dd"].includes(preferences.dateFormat) ? preferences.dateFormat : "locale") as DateFormat,
        compactTables: Boolean(preferences.compactTables)
      });
      showToast(t("saveSuccess"));
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  async function changePassword(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await api.patch("/account", passwordForm);
      navigate("/login");
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  async function revokeSessions() {
    if (!window.confirm(t("confirmDelete"))) return;
    setBusy(true);
    try { await api.post("/auth/sessions/revoke-all"); navigate("/login"); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  async function deleteAccount(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api.delete("/account", deleteForm); navigate("/login"); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }

  return <div className="page-stack">
    <PageHeader eyebrow={t("navPreferences")} title={t("settingsTitle")} description={t("settingsSubtitle")} action={<div className="inline-actions"><Button variant="secondary" onClick={() => navigate("/billing")}>{t("subscription")}</Button><Button variant="secondary" onClick={() => navigate("/settings/notifications")}>{t("notificationPreferences")}</Button></div>} />
    {error && <Alert tone="danger">{error}</Alert>}
    <div className="settings-grid">
      <Panel><PanelHeader title={t("accountProfile")} description={locale === "it" ? "Informazioni associate al tuo account." : "Information associated with your account."} />
        <form className="form-stack" onSubmit={saveProfile}>
          <Field label={t("displayName")}><Input required maxLength={120} value={profile.displayName} onChange={(e) => setProfile({ ...profile, displayName: e.target.value })} /></Field>
          <Field label={t("email")}><Input required type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} /></Field>
          {profile.email !== user.email && <Field label={t("currentPassword")}><Input required type="password" value={profile.currentPassword} onChange={(e) => setProfile({ ...profile, currentPassword: e.target.value })} /></Field>}
          <Field label={t("timezone")}><Input required value={profile.timezone} onChange={(e) => setProfile({ ...profile, timezone: e.target.value })} /></Field>
          <Button type="submit" disabled={busy}>{t("save")}</Button>
        </form>
      </Panel>
      <Panel><PanelHeader title={t("preferences")} />
        <form className="form-stack" onSubmit={savePreferences}>
          <Field label={t("language")}><Select value={locale} onChange={(e) => onLocaleChange(e.target.value as Locale)}><option value="it">{t("italian")}</option><option value="en">{t("english")}</option></Select></Field>
          <div className="form-grid">
            <Field label={t("theme")}><Select value={preferences.theme} onChange={(e) => setPreferences({ ...preferences, theme: e.target.value })}><option value="system">{t("system")}</option><option value="light">{t("light")}</option><option value="dark">{t("dark")}</option></Select></Field>
            <Field label={t("weightUnit")}><Select value={preferences.weightUnit} onChange={(e) => setPreferences({ ...preferences, weightUnit: e.target.value })}><option value="g">{t("units_g")}</option><option value="kg">{t("units_kg")}</option><option value="oz">{t("units_oz")}</option><option value="lb">{t("units_lb")}</option></Select></Field>
            <Field label={t("temperatureUnit")}><Select value={preferences.temperatureUnit} onChange={(e) => setPreferences({ ...preferences, temperatureUnit: e.target.value })}><option value="c">{t("temp_c")}</option><option value="f">{t("temp_f")}</option></Select></Field>
            <Field label={t("dateFormat")}><Select value={preferences.dateFormat} onChange={(e) => setPreferences({ ...preferences, dateFormat: e.target.value })}><option value="locale">Locale</option><option value="dd/MM/yyyy">dd/MM/yyyy</option><option value="yyyy-MM-dd">yyyy-MM-dd</option></Select></Field>
            <Field label={t("defaultLandingPage")}><Select value={preferences.defaultLandingPage} onChange={(e) => setPreferences({ ...preferences, defaultLandingPage: e.target.value })}><option value="today">{t("navToday")}</option><option value="animals">{t("navAnimals")}</option><option value="calendar">{t("navCalendar")}</option></Select></Field>
          </div>
          <label className="checkbox-field"><input type="checkbox" checked={preferences.compactTables} onChange={(e) => setPreferences({ ...preferences, compactTables: e.target.checked })} />{t("compactTables")}</label>
          <Button type="submit" disabled={busy}>{t("save")}</Button>
        </form>
      </Panel>
      <Panel><PanelHeader title={t("security")} />
        <form className="form-stack" onSubmit={changePassword}>
          <Field label={t("currentPassword")}><Input type="password" required value={passwordForm.currentPassword} onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })} /></Field>
          <Field label={t("newPassword")} hint={locale === "it" ? "Almeno 12 caratteri." : "At least 12 characters."}><Input type="password" minLength={12} required value={passwordForm.newPassword} onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })} /></Field>
          <Button type="submit" variant="secondary" disabled={busy}>{t("changePassword")}</Button>
        </form>
        <div className="panel-separator" /><p className="muted-note">{locale === "it" ? "La revoca chiude tutte le sessioni, compresa quella corrente." : "Revoking closes every session, including this one."}</p>
        <Button variant="secondary" onClick={() => void revokeSessions()} disabled={busy}>{t("revokeSessions")}</Button>
      </Panel>
      <Panel className="danger-panel"><PanelHeader title={t("dangerZone")} description={t("deleteAccountHint")} /><Button variant="danger" onClick={() => setShowDelete(true)}>{t("deleteAccount")}</Button></Panel>
    </div>
    {showDelete && <Modal title={t("deleteAccount")} onClose={() => setShowDelete(false)}><form className="form-stack" onSubmit={deleteAccount}>
      <Alert tone="danger">{t("deleteAccountHint")}</Alert>
      <Field label={t("currentPassword")}><Input type="password" required value={deleteForm.currentPassword} onChange={(e) => setDeleteForm({ ...deleteForm, currentPassword: e.target.value })} /></Field>
      <Field label={locale === "it" ? "Scrivi DELETE per confermare" : "Type DELETE to confirm"}><Input required value={deleteForm.confirmation} onChange={(e) => setDeleteForm({ ...deleteForm, confirmation: e.target.value })} /></Field>
      <div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setShowDelete(false)}>{t("cancel")}</Button><Button variant="danger" type="submit" disabled={busy || deleteForm.confirmation !== "DELETE"}>{t("deleteAccount")}</Button></div>
    </form></Modal>}
    {toast}
  </div>;
}