import React, { useCallback, useEffect, useState } from "react";
import type { CommonHubProps } from "./types";
import { apiRequest } from "./api/api";

const dateLabel = value => value ? new Intl.DateTimeFormat("it-IT", { dateStyle: "medium" }).format(new Date(value)) : "—";
const statusLabel = value => ({ active: "Attivo", trialing: "Periodo di prova", incomplete: "Incompleto", processing: "In elaborazione", pending_cancellation: "Cancellazione a fine periodo", canceled: "Annullato", paused: "In pausa", past_due: "Pagamento in ritardo", unpaid: "Non pagato" }[value] || value || "Nessun abbonamento");
function Button({ children, variant = "secondary", ...props }) { return <button className={"button " + variant} {...props}>{children}</button>; }
function safeStripeRedirect(raw, kind) {
  try {
    const url = new URL(raw);
    const validHost = kind === "checkout"
      ? (url.hostname === "checkout.stripe.com" || url.hostname.endsWith(".stripe.com"))
      : (url.hostname === "billing.stripe.com" || url.hostname.endsWith(".stripe.com"));
    return url.protocol === "https:" && validHost ? url.href : null;
  } catch { return null; }
}
export function BillingHub({ onNotice = () => {} }: CommonHubProps) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const checkoutState = new URLSearchParams(window.location.search).get("checkout");
  const load = useCallback(async () => {
    setBusy(true); setError("");
    try { setData(await apiRequest("billing/subscription")); }
    catch (err) { setError(err.message || "Impossibile leggere lo stato dell’abbonamento."); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const go = async kind => {
    setBusy(true); setError("");
    try {
      const response = await apiRequest(kind === "checkout" ? "billing/checkout" : "billing/portal", { method: "POST", body: {} });
      const url = safeStripeRedirect(response?.url, kind);
      if (!url) throw new Error("Il backend non ha restituito un indirizzo Stripe valido.");
      window.location.assign(url);
    } catch (err) {
      const msg = err.message || "Impossibile aprire la pagina di pagamento.";
      setError(msg); onNotice(msg, "error"); setBusy(false);
    }
  };
  const subscription = data?.subscription;
  const paid = Boolean(data?.entitlements?.paidSubscription);
  const customerHasSubscription = Boolean(subscription);
  return <div className="advanced-stack">
    {checkoutState === "success" && <div className="notice info">Checkout completato. Stripe può impiegare qualche istante ad aggiornare lo stato tramite webhook: usa “Aggiorna stato” per verificarlo.</div>}
    {checkoutState === "cancelled" && <div className="notice warning">Checkout annullato: non è stato avviato un nuovo abbonamento.</div>}
    {error && <section className="panel"><p className="form-message" role="alert">{error}</p><Button onClick={() => void load()}>Riprova</Button></section>}
    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">PIANO E PAGAMENTI</p><h2>Il tuo abbonamento</h2><p className="subheading">I pagamenti vengono gestiti da Stripe; Vivarqo non raccoglie i dati completi della carta.</p></div><Button onClick={() => void load()} disabled={busy}>↻ Aggiorna stato</Button></div>
      {busy && !data ? <div className="loading">Caricamento abbonamento…</div> : <>
        <div className="stats-grid"><article className="stat-card tone-0"><span>Stato</span><strong>{statusLabel(subscription?.status)}</strong><small>{paid ? "Funzioni del piano a pagamento abilitate" : "Funzioni a pagamento non abilitate"}</small></article><article className="stat-card tone-1"><span>Periodo dal</span><strong>{dateLabel(subscription?.currentPeriodStart)}</strong><small>Inizio periodo corrente</small></article><article className="stat-card tone-2"><span>Periodo fino al</span><strong>{dateLabel(subscription?.currentPeriodEnd)}</strong><small>{subscription?.cancelAtPeriodEnd ? "Annullamento programmato" : "Fine periodo corrente"}</small></article></div>
        {!data?.configured && <div className="notice warning">Il pagamento non è configurato completamente sul server. Imposta chiavi Stripe, prezzo e segreto webhook in ambiente; i pulsanti di pagamento resteranno disabilitati.</div>}
        <div className="inline-actions">
          <Button variant="primary" disabled={busy || !data?.configured || paid} onClick={() => void go("checkout")}>Attiva / acquista abbonamento</Button>
          <Button disabled={busy || !customerHasSubscription} onClick={() => void go("portal")}>Gestisci pagamenti e cancellazione</Button>
        </div>
        {paid && <p className="muted">Il piano è attivo. Per aggiornare il metodo di pagamento o cambiare le preferenze di rinnovo, apri il portale Stripe.</p>}
        {subscription?.cancelAtPeriodEnd && <p className="muted">L’abbonamento è previsto in cancellazione alla fine del periodo indicato sopra. Verifica i dettagli nel portale Stripe.</p>}
        {!subscription && <p className="muted">Non risulta ancora un abbonamento collegato a questo account. L’acquisto sarà disponibile quando il server Stripe sarà configurato.</p>}
      </>}
    </section>
  </div>;
}
