import { useState } from "react";
import { api, ApiError } from "../../lib/api";
import { formatDate, getString } from "../../lib/domain";
import type { Locale } from "../../lib/domain";
import type { BillingEntitlementsDto, BillingSubscriptionDto } from "@vivarqo/contracts/settings";
import { translate } from "../../lib/i18n";
import { PlanUsageSummary } from "../../components/PlanUsageSummary";
import { useResource } from "../../hooks/useResource";
import { Alert, Badge, Button, ErrorState, PageHeader, Panel, PanelHeader } from "../../components/ui";

type BillingResponse = {
  configured: boolean;
  plans?: { monthly: boolean; annual: boolean };
  subscription: BillingSubscriptionDto | null;
  entitlements: BillingEntitlementsDto;
};

export function BillingPage({ locale }: { locale: Locale }) {
  const t = (key: string) => translate(locale, key);
  const resource = useResource<BillingResponse>("/billing/subscription");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const checkout = new URLSearchParams(window.location.search).get("checkout");

  async function redirect(action: "checkout" | "portal", plan: "monthly" | "annual" = "monthly") {
    setBusy(true);
    setError("");
    try {
      const result = await api.post<{ url: string }>(`/billing/${action}`, action === "checkout" ? { plan } : {});
      window.location.assign(result.url);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t("operationFailed"));
      setBusy(false);
    }
  }

  const subscription = resource.data?.subscription;
  const entitlements = resource.data?.entitlements;
  const rawStatus = getString(subscription, "status", "none");
  const status = subscription?.cancelAtPeriodEnd ? "pending_cancellation" : rawStatus;
  const periodEnd = getString(subscription, "currentPeriodEnd");
  const paid = Boolean(entitlements?.paidSubscription);
  const labels: Record<string, string> = {
    active: locale === "it" ? "Attivo" : "Active",
    trialing: locale === "it" ? "Prova" : "Trial",
    incomplete: locale === "it" ? "Pagamento incompleto" : "Payment incomplete",
    incomplete_expired: locale === "it" ? "Scaduto" : "Expired",
    pending_cancellation: locale === "it" ? "Cancellazione programmata" : "Cancellation scheduled",
    canceled: locale === "it" ? "Annullato" : "Canceled",
    paused: locale === "it" ? "In pausa" : "Paused",
    past_due: locale === "it" ? "Pagamento scaduto" : "Past due",
    unpaid: locale === "it" ? "Non pagato" : "Unpaid",
    none: locale === "it" ? "Nessun abbonamento" : "No subscription",
  };
  const currentPlan = entitlements?.billingInterval === "annual"
    ? (locale === "it" ? "Premium annuale" : "Annual Premium")
    : entitlements?.billingInterval === "monthly"
      ? (locale === "it" ? "Premium mensile" : "Monthly Premium")
      : (locale === "it" ? "Gratuito" : "Free");

  return <div className="page-stack">
    <PageHeader eyebrow={t("navPreferences")} title={t("subscription")} description={locale === "it" ? "Scegli il piano Vivarqo più adatto a te. Pagamenti gestiti in modo sicuro tramite Stripe." : "Choose the Vivarqo plan that suits you. Payments are securely managed by Stripe."} />
    {checkout === "success" && <Alert tone="info">{locale === "it" ? "Checkout terminato. Il piano Premium si attiva dopo la conferma del webhook Stripe." : "Checkout completed. Premium activates after Stripe webhook confirmation."}</Alert>}
    {checkout === "cancelled" && <Alert tone="info">{locale === "it" ? "Checkout annullato. Non è stato attivato alcun nuovo abbonamento." : "Checkout canceled. No new subscription was activated."}</Alert>}
    {error && <Alert tone="danger">{error}</Alert>}
    <Panel>
      <PanelHeader title={locale === "it" ? "Piani e prezzi" : "Plans and pricing"} />
      <div className="billing-card">
        <div>
          <span className="eyebrow">{locale === "it" ? "Gratuito" : "Free"}</span>
          <h2>0 €</h2>
          <p>{locale === "it" ? "15 animali, 30 documenti e 512 MB inclusi. Tutte le funzioni essenziali sono disponibili." : "15 animals, 30 documents and 512 MB included. All essential features are available."}</p>
        </div>
        <div>
          <span className="eyebrow">Premium</span>
          <h2>4,99 € <small>/ {locale === "it" ? "mese" : "month"}</small></h2>
          <p>{locale === "it" ? "Animali, documenti e spazio di archiviazione illimitati." : "Unlimited animals, documents and storage."}</p>
          <Button onClick={() => void redirect("checkout", "monthly")} disabled={busy || !resource.data?.configured || !resource.data?.plans?.monthly || paid}>
            {locale === "it" ? "Scegli mensile" : "Choose monthly"}
          </Button>
        </div>
        <div>
          <span className="eyebrow">Premium annuale</span>
          <h2>49,99 € <small>/ {locale === "it" ? "anno" : "year"}</small></h2>
          <p>{locale === "it" ? "Risparmi 9,89 € rispetto a dodici pagamenti mensili." : "Save €9.89 compared with twelve monthly payments."}</p>
          <Button onClick={() => void redirect("checkout", "annual")} disabled={busy || !resource.data?.configured || !resource.data?.plans?.annual || paid}>
            {locale === "it" ? "Scegli annuale" : "Choose annual"}
          </Button>
        </div>
      </div>
      {!resource.data?.configured && <p className="muted-note">{t("billingUnavailable")}</p>}
    </Panel>
    <Panel>
      <div className="billing-card">
        <div>
          <span className="eyebrow">{t("currentPlan")}</span>
          <h2>{currentPlan}</h2>
          <p>{t("status")}: <Badge tone={status === "active" || status === "trialing" ? "success" : status === "past_due" || status === "unpaid" ? "warning" : "neutral"}>{labels[status] ?? status}</Badge></p>
          {periodEnd && <small>{locale === "it" ? "Periodo fino al" : "Period until"} {formatDate(periodEnd, locale)}</small>}
        </div>
        {subscription?.stripePriceId && <div className="billing-actions">
          <Button variant="secondary" onClick={() => void redirect("portal")} disabled={busy}>{t("portal")}</Button>
        </div>}
      </div>
      {resource.error && <ErrorState message={resource.error.message} retry={resource.reload} />}
    </Panel>
    <PlanUsageSummary locale={locale} />
    <Panel>
      <PanelHeader title={locale === "it" ? "Stato del pagamento" : "Payment status"} />
      <p className="detail-copy">{locale === "it" ? "Lo stato mostrato proviene dal backend ed è aggiornato dagli eventi Stripe verificati. Vivarqo non raccoglie né memorizza i dati della carta." : "The displayed state comes from the backend and is updated by verified Stripe events. Vivarqo does not collect or store card details."}</p>
    </Panel>
  </div>;
}
