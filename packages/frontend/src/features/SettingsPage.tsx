import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { formatDate, formatDateTime, getArray, getString } from "../lib/domain";
import type { Locale } from "../lib/domain";
import { translate } from "../lib/i18n";
import { useResource } from "../hooks/useResource";
import { Alert, Badge, Button, EmptyState, ErrorState, Field, Icon, IconButton, Input, LoadingState, Modal, PageHeader, Panel, PanelHeader, Select, Textarea, useToast } from "../components/ui";

type Item = Record<string, unknown>;
type User = { id: string; email: string; displayName: string; locale: Locale; timezone: string };

export function SettingsPage({ locale, path, user, onLocaleChange, onUserUpdated, navigate }: {
  locale: Locale; path: string; user: User; onLocaleChange: (locale: Locale) => void; onUserUpdated: (user: User) => void; navigate: (path: string) => void;
}) {
  if (path.startsWith("/notifications")) return <NotificationsPage locale={locale} navigate={navigate} />;
  if (path.startsWith("/settings/notifications")) return <NotificationSettingsPage locale={locale} />;
  if (path.startsWith("/billing")) return <BillingPage locale={locale} />;
  return <AccountSettingsPage locale={locale} user={user} onLocaleChange={onLocaleChange} onUserUpdated={onUserUpdated} navigate={navigate} />;
}

function AccountSettingsPage({ locale, user, onLocaleChange, onUserUpdated, navigate }: { locale: Locale; user: User; onLocaleChange: (locale: Locale) => void; onUserUpdated: (user: User) => void; navigate: (path: string) => void }) {
  const t = (key: string) => translate(locale, key);
  const prefs = useResource<{ preferences: Item }>("/account/preferences");
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
      document.documentElement.dataset.theme = preferences.theme;
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

export function NotificationsPage({ locale, navigate }: { locale: Locale; navigate: (path: string) => void }) {
  const t = (key: string) => translate(locale, key);
  const [page, setPage] = useState(1);
  const resource = useResource<{ notifications: Item[]; unreadCount: number; pagination: { page: number; totalPages: number; total: number } }>(`/notifications?page=${page}&pageSize=25`);
  const { toast, show } = useToast();
  async function markRead(item: Item) {
    try { await api.patch(`/notifications/${getString(item, "id")}/read`, {}); resource.reload(); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }
  async function readAll() {
    try { await api.post("/notifications/read-all"); resource.reload(); show(t("saveSuccess")); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }
  return <div className="page-stack">
    <PageHeader eyebrow={t("navWorkspace")} title={t("notificationsTitle")} description={`${resource.data?.unreadCount ?? 0} ${t("unread")}`} action={<div className="inline-actions"><Button variant="secondary" onClick={() => navigate("/settings/notifications")}>{t("notificationPreferences")}</Button><Button onClick={() => void readAll()}><Icon name="checkCircle" />{t("markAllRead")}</Button></div>} />
    <Panel>{resource.loading && !resource.data ? <LoadingState /> : resource.error ? <ErrorState message={resource.error.message} retry={resource.reload} /> : resource.data?.notifications.length ? <div className="notification-list">
      {resource.data.notifications.map((item) => <div className={`notification-row ${item.readAt ? "is-read" : "is-unread"}`} key={getString(item, "id")}><span className="notification-symbol"><Icon name="bell" /></span><button className="notification-copy" onClick={() => { const target = getString(item, "targetPath"); if (target) navigate(target); if (!item.readAt) void markRead(item); }}><strong>{getString(item, "title")}</strong><p>{getString(item, "body")}</p><small>{formatDateTime(getString(item, "createdAt"), locale)}</small></button>{!item.readAt && <Button variant="ghost" size="sm" onClick={() => void markRead(item)}>{t("markRead")}</Button>}</div>)}
    </div> : <EmptyState title={t("noNotifications")} />}
      {resource.data?.pagination && <div className="pagination"><span>{t("page")} {page} / {resource.data.pagination.totalPages}</span><div><Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>←</Button><Button variant="secondary" size="sm" disabled={page >= resource.data!.pagination.totalPages} onClick={() => setPage(page + 1)}>→</Button></div></div>}
    </Panel>
    {toast}
  </div>;
}

function NotificationSettingsPage({ locale }: { locale: Locale }) {
  const t = (key: string) => translate(locale, key);
  const prefs = useResource<{ preferences: Item }>("/notification-preferences");
  const subscriptions = useResource<{ subscriptions: Item[] }>("/push-subscriptions");
  const [values, setValues] = useState<{ inAppEnabled: boolean; pushEnabled: boolean; quietHoursStart: string; quietHoursEnd: string; categories: Record<string, boolean> }>({ inAppEnabled: true, pushEnabled: false, quietHoursStart: "", quietHoursEnd: "", categories: {} });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { toast, show } = useToast();
  useEffect(() => {
    if (prefs.data?.preferences) {
      const value = prefs.data.preferences;
      const categories = typeof value.categories === "object" && value.categories !== null ? value.categories as Record<string, boolean> : {};
      setValues({ inAppEnabled: Boolean(value.inAppEnabled), pushEnabled: Boolean(value.pushEnabled), quietHoursStart: getString(value, "quietHoursStart"), quietHoursEnd: getString(value, "quietHoursEnd"), categories });
    }
  }, [prefs.data]);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { const { pushEnabled: _pushEnabled, ...inAppPreferences } = values;
      await api.patch("/notification-preferences", inAppPreferences); prefs.reload(); show(t("saveSuccess")); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  async function enablePush() {
    setBusy(true); setError("");
    try {
      if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error(locale === "it" ? "Questo browser non supporta Web Push." : "This browser does not support Web Push.");
      const currentRegistration = await navigator.serviceWorker.getRegistration();
      if (!currentRegistration) throw new Error(locale === "it" ? "Il service worker non è ancora installato. Apri la versione pubblicata della PWA e riprova." : "The service worker is not installed yet. Open the deployed PWA and try again.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error(locale === "it" ? "Permesso notifiche non concesso." : "Notification permission was not granted.");
      const registration = currentRegistration.active ? currentRegistration : await navigator.serviceWorker.ready;
      const key = await api.get<{ publicKey: string | null }>("/push/public-key");
      if (!key.publicKey) throw new Error(locale === "it" ? "Web Push non è configurato sul server." : "Web Push is not configured on the server.");
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeVapidKey(key.publicKey) as unknown as BufferSource });
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error("Invalid browser push subscription");
      await api.post("/push-subscriptions", { endpoint: json.endpoint, keys: json.keys, userAgent: navigator.userAgent });
      await api.patch("/notification-preferences", { pushEnabled: true });
      setValues((current) => ({ ...current, pushEnabled: true }));
      prefs.reload(); subscriptions.reload(); show(t("saveSuccess"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  async function disablePush() {
    setBusy(true); setError("");
    try {
      await api.patch("/notification-preferences", { pushEnabled: false });
      setValues((current) => ({ ...current, pushEnabled: false }));
      prefs.reload(); subscriptions.reload(); show(t("saveSuccess"));
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  async function removeSubscription(item: Item) {
    if (!window.confirm(t("confirmDelete"))) return;
    try { await api.delete(`/push-subscriptions/${getString(item, "id")}`); subscriptions.reload(); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }
  async function testPush() {
    setBusy(true); setError("");
    try { await api.post("/notifications/test-push"); show(t("testPush")); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); }
    finally { setBusy(false); }
  }
  const categories = Object.keys(values.categories);
  return <div className="page-stack">
    <PageHeader eyebrow={t("navPreferences")} title={t("notificationPreferences")} description={t("pushExplanation")} />
    {prefs.error && <ErrorState message={prefs.error.message} retry={prefs.reload} />}{error && <Alert tone="danger">{error}</Alert>}
    <Panel><PanelHeader title={t("notificationPreferences")} />
      <form className="form-stack" onSubmit={save}>
        <label className="toggle-row"><span><strong>{t("inApp")}</strong><small>{locale === "it" ? "Centro notifiche interno all'applicazione." : "The in-app notification centre."}</small></span><input type="checkbox" checked={values.inAppEnabled} onChange={(e) => setValues({ ...values, inAppEnabled: e.target.checked })} /></label>
        <div className="toggle-row"><span><strong>{t("webPush")}</strong><small>{t("pushExplanation")}</small></span><Badge tone={values.pushEnabled ? "success" : "neutral"}>{values.pushEnabled ? t("enabled") : t("disabled")}</Badge></div>
        <div className="form-grid"><Field label={`${t("quietHours")} · ${t("from")}`}><Input type="time" value={values.quietHoursStart} onChange={(e) => setValues({ ...values, quietHoursStart: e.target.value })} /></Field><Field label={t("to")}><Input type="time" value={values.quietHoursEnd} onChange={(e) => setValues({ ...values, quietHoursEnd: e.target.value })} /></Field></div>
        {categories.length > 0 && <div className="field"><span className="field-label">{t("categories")}</span><div className="checkbox-grid">{categories.map((category) => <label className="checkbox-field" key={category}><input type="checkbox" checked={Boolean(values.categories[category])} onChange={(e) => setValues({ ...values, categories: { ...values.categories, [category]: e.target.checked } })} />{category}</label>)}</div></div>}
        <Button type="submit" disabled={busy}>{t("save")}</Button>
      </form>
    </Panel>
    <Panel><PanelHeader title={t("webPush")} description={t("pushExplanation")} />
      <div className="inline-actions">{values.pushEnabled ? <Button variant="secondary" onClick={() => void disablePush()} disabled={busy}>{t("disablePush")}</Button> : <Button onClick={() => void enablePush()} disabled={busy}><Icon name="bell" />{t("enablePush")}</Button>}<Button variant="secondary" onClick={() => void testPush()} disabled={busy || !values.pushEnabled}>{t("testPush")}</Button></div>
      <div className="panel-separator" /><PanelHeader title={locale === "it" ? "Browser registrati" : "Registered browsers"} />
      {subscriptions.loading && !subscriptions.data ? <LoadingState /> : subscriptions.error ? <ErrorState message={subscriptions.error.message} retry={subscriptions.reload} /> : subscriptions.data?.subscriptions.length ? <div className="record-list">{subscriptions.data.subscriptions.map((item) => <div className="record-row" key={getString(item, "id")}><div><strong>{getString(item, "userAgent") || "Browser"}</strong><small>{formatDateTime(getString(item, "createdAt"), locale)}</small></div><IconButton label={t("delete")} onClick={() => void removeSubscription(item)}><Icon name="trash" /></IconButton></div>)}</div> : <EmptyState title={t("emptyHint")} />}
    </Panel>
    {toast}
  </div>;
}

function decodeVapidKey(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function BillingPage({ locale }: { locale: Locale }) {
  const t = (key: string) => translate(locale, key);
  const resource = useResource<{ configured: boolean; subscription: Item | null; entitlements: Item }>("/billing/subscription");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const checkout = new URLSearchParams(window.location.search).get("checkout");
  const { toast, show } = useToast();
  async function redirect(action: "checkout" | "portal") {
    setBusy(true); setError("");
    try { const result = await api.post<{ url: string }>(`/billing/${action}`, {}); window.location.assign(result.url); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : t("operationFailed")); setBusy(false); }
  }
  const subscription = resource.data?.subscription;
  const rawStatus = getString(subscription, "status", "none");
  const status = subscription?.cancelAtPeriodEnd ? "pending_cancellation" : rawStatus;
  const periodEnd = getString(subscription, "currentPeriodEnd");
  const labels: Record<string, string> = {
    active: locale === "it" ? "Attivo" : "Active", trialing: locale === "it" ? "Prova" : "Trial",
    incomplete: locale === "it" ? "Pagamento incompleto" : "Payment incomplete",
    incomplete_expired: locale === "it" ? "Scaduto" : "Expired",
    processing: locale === "it" ? "In elaborazione" : "Processing",
    pending_cancellation: locale === "it" ? "Cancellazione programmata" : "Cancellation scheduled",
    canceled: locale === "it" ? "Annullato" : "Canceled", paused: locale === "it" ? "In pausa" : "Paused",
    past_due: locale === "it" ? "Pagamento scaduto" : "Past due", unpaid: locale === "it" ? "Non pagato" : "Unpaid",
    none: locale === "it" ? "Nessun abbonamento" : "No subscription"
  };
  return <div className="page-stack">
    <PageHeader eyebrow={t("navPreferences")} title={t("subscription")} description={locale === "it" ? "Piano e pagamenti gestiti in modo sicuro tramite Stripe." : "Plans and payments are securely managed by Stripe."} />
    {checkout === "success" && <Alert tone="info">{locale === "it" ? "Checkout terminato. Lo stato effettivo si aggiorna dopo il webhook Stripe: il ritorno dal checkout non prova che il pagamento sia completato." : "Checkout returned. The effective state updates after the Stripe webhook; returning from checkout is not proof of payment."}</Alert>}
    {checkout === "cancelled" && <Alert tone="info">{locale === "it" ? "Checkout annullato. Non è stato confermato alcun nuovo abbonamento." : "Checkout canceled. No new subscription was confirmed."}</Alert>}
    {error && <Alert tone="danger">{error}</Alert>}
    <Panel><div className="billing-card"><div><span className="eyebrow">{t("currentPlan")}</span><h2>{getString(subscription, "stripePriceId") || (locale === "it" ? "Piano non attivo" : "No active plan")}</h2><p>{t("status")}: <Badge tone={status === "active" || status === "trialing" ? "success" : status === "past_due" || status === "unpaid" ? "warning" : "neutral"}>{labels[status] ?? status}</Badge></p>{periodEnd && <small>{locale === "it" ? "Periodo fino al" : "Period until"} {formatDate(periodEnd, locale)}</small>}</div>
      <div className="billing-actions">{subscription && <Button variant="secondary" onClick={() => void redirect("portal")} disabled={busy}>{t("portal")}</Button>}{status !== "active" && status !== "trialing" && <Button onClick={() => void redirect("checkout")} disabled={busy || !resource.data?.configured}>{t("checkout")}</Button>}</div>
    </div>
    {resource.error ? <ErrorState message={resource.error.message} retry={resource.reload} /> : !resource.data?.configured ? <p className="muted-note">{t("billingUnavailable")}</p> : null}</Panel>
    <Panel><PanelHeader title={locale === "it" ? "Stato del pagamento" : "Payment status"} /><p className="detail-copy">{locale === "it" ? "Lo stato mostrato proviene dal backend, aggiornato dagli eventi Stripe verificati. Vivarqo non raccoglie né memorizza i dati della carta." : "The displayed state comes from the backend and is updated by verified Stripe events. Vivarqo does not collect or store card details."}</p></Panel>
    {toast}
  </div>;
}
