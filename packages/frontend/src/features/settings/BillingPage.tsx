import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { formatDate, formatDateTime, getArray, getString } from "../lib/domain";
import type { DateFormat, Locale, TemperatureUnit, WeightUnit } from "../lib/domain";
import { translate } from "../lib/i18n";
import { useResource } from "../hooks/useResource";
import { Alert, Badge, Button, EmptyState, ErrorState, Field, Icon, IconButton, Input, LoadingState, Modal, PageHeader, Panel, PanelHeader, Select, Textarea, useToast } from "../components/ui";
export function BillingPage({ locale }: { locale: Locale }) {
  const t = (key: string) => translate(locale, key);
  const resource = useResource<{ configured: boolean; subscription: BillingSubscriptionDto | null; entitlements: BillingEntitlementsDto }>("/billing/subscription");
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