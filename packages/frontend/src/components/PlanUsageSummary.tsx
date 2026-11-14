import { useResource } from "../hooks/useResource";
import type { Locale } from "../lib/domain";
import { formatNumber } from "../lib/domain";
import type { BillingEntitlementsDto } from "@vivarqo/contracts/settings";
import { Badge, Button, Icon, Panel, PanelHeader } from "./ui";

type BillingSummary = { entitlements: BillingEntitlementsDto; subscription: { status: string } | null };

function quantity(value: number | null, locale: Locale): string {
  if (value === null) return locale === "it" ? "Illimitati" : "Unlimited";
  return formatNumber(value, locale, 0);
}
function storage(value: string | number | null, locale: Locale): string {
  if (value === null) return locale === "it" ? "Illimitato" : "Unlimited";
  const bytes = Math.max(0, Number(value) || 0);
  const unit = bytes >= 1024 ** 3 ? "GB" : "MB";
  const amount = bytes >= 1024 ** 3 ? bytes / 1024 ** 3 : bytes / 1024 ** 2;
  return `${formatNumber(amount, locale, 1)} ${unit}`;
}
function usage(used: number, max: number | null): number | null {
  if (max === null || max <= 0) return null;
  return Math.min(100, Math.max(0, used / max * 100));
}
function FeatureName({ locale }: { locale: Locale }) {
  return <>{locale === "it" ? "Accesso alle funzioni con abbonamento attivo" : "Access to subscription features"}</>;
}

export function PlanUsageSummary({ locale, compact = false, onNavigate }: { locale: Locale; compact?: boolean; onNavigate?: (path: string) => void }) {
  const resource = useResource<BillingSummary>("/billing/subscription");
  if (resource.loading && !resource.data) return null;
  if (resource.error || !resource.data?.entitlements) return null;
  const e = resource.data.entitlements;
  const animalPct = usage(e.animalsUsed, e.maxAnimals);
  const documentPct = usage(e.documentsUsed, e.maxDocuments);
  const storagePct = usage(Number(e.storageBytesUsed), e.maxStorageBytes);
  const features = e.features ?? [];
  const it = locale === "it";
  const row = (label: string, used: number, max: number | null, percent: number | null) => <div className="plan-usage-row" key={label}>
    <div className="plan-usage-label"><span>{label}</span><strong>{formatNumber(used, locale, 0)} / {quantity(max, locale)}</strong></div>
    {percent !== null && <div className="plan-usage-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}><span style={{ width: `${percent}%` }} /></div>}
  </div>;
  return <Panel className={compact ? "plan-usage-panel plan-usage-compact" : "plan-usage-panel"}>
    <PanelHeader title={it ? "Utilizzo del piano" : "Plan usage"} action={<Badge tone={e.plan === "paid" ? "success" : "neutral"}>{e.plan === "paid" ? (it ? "Piano attivo" : "Paid plan") : "Free"}</Badge>} />
    <div className="plan-usage-grid">
      {row(it ? "Animali" : "Animals", e.animalsUsed, e.maxAnimals, animalPct)}
      {row(it ? "Documenti" : "Documents", e.documentsUsed, e.maxDocuments, documentPct)}
      <div className="plan-usage-row">
        <div className="plan-usage-label"><span>{it ? "Spazio occupato" : "Storage used"}</span><strong>{storage(e.storageBytesUsed, locale)} / {storage(e.maxStorageBytes, locale)}</strong></div>
        {storagePct !== null && <div className="plan-usage-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(storagePct)}><span style={{ width: `${storagePct}%` }} /></div>}
      </div>
    </div>
    <div className="plan-usage-features">
      <strong>{it ? "Funzioni incluse nel tuo piano" : "Features included in your plan"}</strong>
      {e.paidSubscription ? <div className="plan-feature-list"><span><Icon name="check" size={13} /><FeatureName locale={locale} /></span></div>
        : e.accessMode === "subscription_required" ? <p>{it ? "Le funzioni soggette ad abbonamento richiedono un piano attivo. Puoi continuare a usare le funzioni gratuite entro i limiti indicati." : "Features requiring a subscription need an active plan. You can keep using free features within the limits shown above."}</p>
        : <p>{it ? "Il tuo account usa la modalità ad accesso libero; i limiti mostrati sopra si applicano comunque." : "Your account uses unrestricted access mode; the limits above still apply."}</p>}
    </div>
    {!compact && <p className="muted-note">{it ? "I limiti e le funzioni vengono letti dal tuo account. Lo spazio indica i file effettivamente archiviati." : "Limits and features are read from your account. Storage reflects the files currently stored."}</p>}
    {compact && <div className="plan-usage-footer"><span>{it ? "Vuoi vedere tutti i dettagli?" : "Need the full details?"}</span><Button size="sm" variant="secondary" onClick={() => onNavigate?.("/billing")}>{it ? "Dettagli piano" : "Plan details"}<Icon name="arrow" size={13} /></Button></div>}
  </Panel>;
}
