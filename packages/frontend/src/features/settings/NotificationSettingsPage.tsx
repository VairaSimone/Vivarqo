import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { formatDate, formatDateTime, getArray, getString } from "../lib/domain";
import type { DateFormat, Locale, TemperatureUnit, WeightUnit } from "../lib/domain";
import type { AccountPreferencesDto, BillingEntitlementsDto, BillingSubscriptionDto, NotificationDto, NotificationPreferencesDto, PushSubscriptionDto, SettingsUserDto } from "@vivarqo/contracts/settings";

import { translate } from "../lib/i18n";
import { useResource } from "../hooks/useResource";
import { Alert, Badge, Button, EmptyState, ErrorState, Field, Icon, IconButton, Input, LoadingState, Modal, PageHeader, Panel, PanelHeader, Select, Textarea, useToast } from "../components/ui";
export function NotificationSettingsPage({ locale }: { locale: Locale }) {
  const t = (key: string) => translate(locale, key);
  const prefs = useResource<{ preferences: NotificationPreferencesDto }>("/notification-preferences");
  const subscriptions = useResource<{ subscriptions: PushSubscriptionDto[] }>("/push-subscriptions");
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
      const key = await api.get<{ publicKey: string | null }>("/push/public-key");
      if (!key.publicKey) throw new Error(locale === "it" ? "Web Push non è configurato sul server." : "Web Push is not configured on the server.");
      const registration = currentRegistration.active ? currentRegistration : await navigator.serviceWorker.ready;
      const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (permission !== "granted") throw new Error(locale === "it" ? "Permesso notifiche non concesso." : "Notification permission was not granted.");
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeVapidKey(key.publicKey) as unknown as BufferSource });
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error("Invalid browser push subscription");
      await api.post("/push-subscriptions", { endpoint: json.endpoint, keys: json.keys, userAgent: navigator.userAgent });
      await api.patch("/notification-preferences", { pushEnabled: true });
      setValues((current) => ({ ...current, pushEnabled: true }));
      prefs.reload(); subscriptions.reload(); show(t("saveSuccess"));
    } catch (reason) {
      const message = reason instanceof ApiError && reason.code === "WEB_PUSH_NOT_CONFIGURED"
        ? t("pushNotConfigured")
        : reason instanceof Error ? reason.message : t("operationFailed");
      setError(message);
    }
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
  async function removeSubscription(item: PushSubscriptionDto) {
    if (!window.confirm(t("confirmDelete"))) return;
    try {
      await api.delete(`/push-subscriptions/${getString(item, "id")}`);
      subscriptions.reload();
      const endpoint = getString(item, "endpoint");
      if (endpoint && "serviceWorker" in navigator) {
        try {
          const registration = await navigator.serviceWorker.getRegistration();
          const localSubscription = await registration?.pushManager.getSubscription();
          if (localSubscription?.endpoint === endpoint && !(await localSubscription.unsubscribe())) {
            show(t("deviceRemovedLocalPending"));
            return;
          }
        } catch {
          show(t("deviceRemovedLocalPending"));
          return;
        }
      }
      show(t("deviceRemoved"));
    } catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }
  async function testPush() {
    setBusy(true); setError("");
    try { await api.post("/notifications/test-push"); show(t("pushTestQueued")); }
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