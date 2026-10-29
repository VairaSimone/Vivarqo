import React, { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api/api.js";
import { useConfirmDialog } from "./ui/ConfirmDialog.jsx";

const categories = [
  ["task_due", "Scadenze attività"], ["system", "Sistema e test push"]
];
const arrayOf = value => Array.isArray(value) ? value : Object.values(value || {}).find(Array.isArray) || [];
const dateTime = value => value ? new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
function Button({ children, variant = "secondary", ...props }) { return <button className={"button " + variant} {...props}>{children}</button>; }
function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}
function isSupported() {
  return typeof window !== "undefined" && window.isSecureContext && "serviceWorker" in navigator &&
    "Notification" in window && "PushManager" in window;
}

export function NotificationsHub({ onNotice = () => {}, owner }) {
  const confirmAction = useConfirmDialog();
  const [notifications, setNotifications] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
  const [unreadCount, setUnreadCount] = useState(0);
  const [preferences, setPreferences] = useState({ inAppEnabled: true, pushEnabled: false, categories: {}, quietHoursStart: "", quietHoursEnd: "" });
  const [devices, setDevices] = useState([]);
  const [busy, setBusy] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [notices, pref, subs] = await Promise.all([
      apiRequest("notifications?page=" + page + "&pageSize=50"),
      apiRequest("notification-preferences"),
      apiRequest("push-subscriptions")
    ]);
    setNotifications(arrayOf(notices.notifications ?? notices));
    setPagination(notices.pagination || { page, pageSize: 50, total: arrayOf(notices.notifications ?? notices).length, totalPages: 1 });
    setUnreadCount(Number(notices.unreadCount || 0));
    const p = pref.preferences || {};
    const merged = Object.fromEntries(categories.map(([key]) => [key, p.categories?.[key] !== false]));
    for (const [key, value] of Object.entries(p.categories || {})) merged[key] = value !== false;
    setPreferences({
      inAppEnabled: p.inAppEnabled !== false, pushEnabled: p.pushEnabled === true, categories: merged,
      quietHoursStart: p.quietHoursStart || "", quietHoursEnd: p.quietHoursEnd || ""
    });
    setDevices(arrayOf(subs.subscriptions ?? subs));
  }, [page]);

  useEffect(() => { let live = true; void load().catch(e => setError(e.message)).finally(() => { if (live) setInitialLoading(false); }); return () => { live = false; }; }, [load]);

  const savePreferences = async patch => {
    setBusy(true);
    try {
      const next = { ...preferences, ...patch };
      if (next.quietHoursStart && !next.quietHoursEnd || !next.quietHoursStart && next.quietHoursEnd) {
        throw new Error("Per le ore di silenzio imposta sia l'inizio sia la fine, oppure lascia entrambi vuoti.");
      }
      const response = await apiRequest("notification-preferences", { method: "PATCH", body: {
        inAppEnabled: next.inAppEnabled,
        pushEnabled: next.pushEnabled,
        categories: next.categories,
        quietHoursStart: next.quietHoursStart || null,
        quietHoursEnd: next.quietHoursEnd || null
      } });
      const saved = response.preferences || {};
      setPreferences({
        inAppEnabled: saved.inAppEnabled !== false, pushEnabled: saved.pushEnabled === true,
        categories: { ...next.categories, ...(saved.categories || {}) },
        quietHoursStart: saved.quietHoursStart || "", quietHoursEnd: saved.quietHoursEnd || ""
      });
      onNotice("Preferenze di notifica salvate.");
    } catch (e) { onNotice(e.message, "error"); }
    finally { setBusy(false); }
  };

  const activatePush = async () => {
    setBusy(true);
    try {
      if (!isSupported()) throw new Error("Le notifiche push richiedono un browser compatibile, un service worker attivo e HTTPS.");
      let permission = Notification.permission;
      if (permission === "default") permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Il browser non ha concesso il permesso per le notifiche.");
      const keyResponse = await apiRequest("push/public-key");
      if (!keyResponse.publicKey) throw new Error("Il server non ha configurato la chiave VAPID pubblica.");
      if ((await navigator.serviceWorker.getRegistrations()).length === 0) throw new Error("Apri o ricarica Vivarqo in un contesto HTTPS prima di attivare le notifiche push.");
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(keyResponse.publicKey) });
      const created = await apiRequest("push-subscriptions", { method: "POST", body: {
        ...subscription.toJSON(), userAgent: navigator.userAgent
      } });
      const id = created.subscription?.id;
      if (id) localStorage.setItem("vivarqo.pushSubscriptionId:" + String(owner || "account"), id);
      await apiRequest("notification-preferences", { method: "PATCH", body: { pushEnabled: true } });
      setPreferences(prev => ({ ...prev, pushEnabled: true }));
      onNotice("Notifiche push abilitate per questo browser.");
      await load();
    } catch (e) { onNotice(e.message, "error"); }
    finally { setBusy(false); }
  };

  const deactivatePush = async () => {
    setBusy(true);
    try {
      await apiRequest("notification-preferences", { method: "PATCH", body: { pushEnabled: false } });
      if (isSupported()) {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) await subscription.unsubscribe().catch(() => false);
      }
      const key = "vivarqo.pushSubscriptionId:" + String(owner || "account");
      const id = localStorage.getItem(key);
      if (id) {
        await apiRequest("push-subscriptions/" + encodeURIComponent(id), { method: "DELETE" }).catch(() => {});
        localStorage.removeItem(key);
      }
      setPreferences(prev => ({ ...prev, pushEnabled: false }));
      onNotice("Notifiche push disattivate.");
      await load();
    } catch (e) { onNotice(e.message, "error"); }
    finally { setBusy(false); }
  };
  const markRead = async item => {
    try { await apiRequest("notifications/" + item.id + "/read", { method: "PATCH", body: {} }); await load(); }
    catch (e) { onNotice(e.message, "error"); }
  };
  const markAll = async () => {
    try { await apiRequest("notifications/read-all", { method: "POST", body: {} }); await load(); onNotice("Notifiche segnate come lette."); }
    catch (e) { onNotice(e.message, "error"); }
  };
  const testPush = async () => {
    setBusy(true);
    try { const result = await apiRequest("notifications/test-push", { method: "POST", body: {} }); onNotice("Test push richiesto. Esito: " + JSON.stringify(result.delivery || {})); await load(); }
    catch (e) { onNotice(e.message, "error"); }
    finally { setBusy(false); }
  };
  const removeDevice = async item => {
    if (!(await confirmAction({ title: "Rimuovere questo dispositivo?", message: "Il browser non riceverà più notifiche push da Vivarqo su questo dispositivo.", confirmLabel: "Rimuovi dispositivo", danger: true }))) return;
    try {
      await apiRequest("push-subscriptions/" + encodeURIComponent(item.id), { method: "DELETE" });
      const key = "vivarqo.pushSubscriptionId:" + String(owner || "account");
      if (localStorage.getItem(key) === item.id) {
        const registration = (await navigator.serviceWorker.getRegistrations())[0] || null;
        const subscription = await registration?.pushManager?.getSubscription();
        await subscription?.unsubscribe().catch(() => false);
        localStorage.removeItem(key);
      }
      await load(); onNotice("Dispositivo rimosso.");
    } catch (e) { onNotice(e.message, "error"); }
  };

  return <div className="advanced-stack">
    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">CENTRO NOTIFICHE</p><h2>Avvisi e lettura</h2><p className="subheading">{unreadCount} non lette · le preferenze si applicano al tuo account.</p></div><div className="inline-actions"><Button onClick={() => load().catch(e => setError(e.message))}>↻ Aggiorna</Button><Button disabled={!unreadCount} onClick={markAll}>Segna tutte come lette</Button></div></div>
      {error && <p className="form-message" role="alert">{error}</p>}
      {initialLoading ? <p className="loading" role="status">Caricamento notifiche…</p> : notifications.length === 0 ? <div className="empty-state"><h3>Nessuna notifica</h3><p>Gli avvisi generati dal server appariranno in questa sezione.</p></div> :
        <div className="notice-list">{notifications.map(item => <article className={"notification-row " + (item.readAt ? "is-read" : "is-unread")} key={item.id}><span className="notification-dot">{item.readAt ? "✓" : "•"}</span><div className="notification-copy"><strong>{item.title}</strong><p>{item.body}</p><small>{item.category} · {dateTime(item.createdAt)}</small></div><div className="notification-actions">{item.targetPath && <a href={item.targetPath} className="text-link">Apri</a>}{!item.readAt && <Button onClick={() => markRead(item)}>Segna letta</Button>}</div></article>)}</div>}
      {pagination.totalPages > 1 && <div className="pagination-bar"><span className="muted">Pagina {pagination.page || page} di {pagination.totalPages} · {pagination.total} notifiche</span><div className="inline-actions"><Button disabled={page <= 1 || busy} onClick={() => setPage(p => p - 1)}>← Precedente</Button><Button disabled={page >= pagination.totalPages || busy} onClick={() => setPage(p => p + 1)}>Successiva →</Button></div></div>}
    </section>
    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">PREFERENZE AVANZATE</p><h2>Come e quando ricevere avvisi</h2></div></div>
      <div className="preference-switches">
        <label className="preference-row"><span><strong>Notifiche nell'app</strong><small>Mostra gli avvisi nel centro notifiche Vivarqo.</small></span><input type="checkbox" checked={preferences.inAppEnabled} onChange={e => setPreferences(p => ({ ...p, inAppEnabled: e.target.checked }))}/></label>
        <label className="preference-row"><span><strong>Notifiche push</strong><small>Richiede il consenso del browser e una configurazione VAPID valida sul server.</small></span><input type="checkbox" checked={preferences.pushEnabled} onChange={e => e.target.checked ? void activatePush() : void deactivatePush()} disabled={busy}/></label>
      </div>
      <h3>Tipi di notifica</h3><p className="muted">Il server genera attualmente le scadenze delle attività e le notifiche di sistema. Queste preferenze usano le stesse categorie del backend.</p>
      <div className="category-grid">{categories.map(([key, label]) => <label className="preference-row category-toggle" key={key}><span>{label}</span><input type="checkbox" checked={preferences.categories[key] !== false} onChange={e => setPreferences(p => ({ ...p, categories: { ...p.categories, [key]: e.target.checked } }))}/></label>)}</div>
      <h3>Orari di silenzio</h3>
      <p className="muted">Durante la fascia indicata le notifiche push vengono sospese; gli avvisi in-app restano consultabili nel centro notifiche. Lascia entrambi i campi vuoti per disattivarla.</p>
      <div className="form-grid"><label className="field"><span>Dalle</span><input type="time" value={preferences.quietHoursStart} onChange={e => setPreferences(p => ({ ...p, quietHoursStart: e.target.value }))}/></label><label className="field"><span>Alle</span><input type="time" value={preferences.quietHoursEnd} onChange={e => setPreferences(p => ({ ...p, quietHoursEnd: e.target.value }))}/></label></div>
      <div className="inline-actions preference-save"><Button variant="primary" disabled={busy} onClick={() => savePreferences({})}>Salva preferenze</Button><Button disabled={busy || !preferences.pushEnabled} onClick={testPush}>Invia notifica di prova</Button></div>
      {!isSupported() && <p className="muted">Questo browser o contesto non supporta push web. Le notifiche in-app restano disponibili.</p>}
      {preferences.pushEnabled && devices.length === 0 && <p className="form-message">Il server non restituisce dispositivi push. Verifica la registrazione o disattiva e riattiva la funzione.</p>}
      {devices.length > 0 && <><h3>Dispositivi registrati</h3><div className="device-list">{devices.map(device => <article className="device-row" key={device.id}><div><strong>{device.userAgent || "Browser registrato"}</strong><small>Registrato il {dateTime(device.createdAt)}</small></div><Button variant="danger" onClick={() => removeDevice(device)}>Rimuovi</Button></article>)}</div></>}
    </section>
  </div>;
}