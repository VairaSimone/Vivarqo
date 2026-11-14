import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Locale } from "../lib/domain";
import { Button, Icon } from "../components/ui";

type Entitlements = {
  plan: "free" | "paid";
  maxAnimals: number | null;
  maxDocuments: number | null;
  maxStorageBytes: number | null;
  animalsUsed: number;
  documentsUsed: number;
  storageBytesUsed: string;
};

const steps = [
  { icon: "home", path: "/today", it: ["La tua cabina di regia", "La pagina Oggi raccoglie scadenze arretrate, attività da completare, promemoria e attività recenti. Parti da qui ogni volta che apri SnakeBee."], en: ["Your control room", "The Today page brings together overdue items, tasks to complete, reminders and recent activity. Start here whenever you open SnakeBee."] },
  { icon: "snake", path: "/animals", it: ["Crea la tua anagrafica", "Aggiungi gli animali con specie, sesso, morph, identificativo, posizione, foto e dettagli. Puoi cercare, filtrare, archiviare e consultare la scheda completa di ogni esemplare."], en: ["Build your animal registry", "Add animals with species, sex, morph, identifier, location, photos and details. Search, filter, archive and open each animal's full record."] },
  { icon: "feed", path: "/feeding", it: ["Registra la gestione quotidiana", "Segna alimentazioni, pesate e mute. Lo storico resta associato all'animale: niente fogli Excel separati o appunti sparsi. Puoi registrare anche operazioni multiple dove previsto."], en: ["Track daily care", "Record feedings, weigh-ins and sheds. History stays attached to each animal, replacing scattered spreadsheets and notes. Bulk entries are available where supported."] },
  { icon: "calendar", path: "/calendar", it: ["Pianifica e non dimenticare", "Crea attività e promemoria, assegna date e animali, controlla il calendario e completa le attività. La dashboard ti segnala ciò che richiede attenzione."], en: ["Plan and stay on top of things", "Create tasks and reminders, set dates and animals, review the calendar and mark work complete. Your dashboard highlights what needs attention."] },
  { icon: "leaf", path: "/reproduction", it: ["Gestisci riproduzioni e covate", "Organizza cicli riproduttivi, eventi, covate, uova, incubazione e piccoli. I dati seguono il percorso riproduttivo e possono essere consultati nel tempo."], en: ["Manage breeding and clutches", "Organize breeding cycles, events, clutches, eggs, incubation and offspring. Keep the reproductive history connected and accessible over time."] },
  { icon: "box", path: "/inventory", it: ["Tieni sotto controllo risorse e documenti", "Gestisci scorte e materiali, archivia documenti e consulta le informazioni quando servono. Le condivisioni pubbliche, quando abilitate, permettono di condividere solo i dati previsti."], en: ["Keep resources and documents organized", "Track stock and supplies, store documents and find information when needed. Public sharing, when enabled, lets you share only the information intended for others."] },
  { icon: "wallet", path: "/finance", it: ["Controlla numeri, dati e impostazioni", "Il registro economico raccoglie entrate e uscite. Importazione ed esportazione aiutano a trasferire e salvare i dati. In Impostazioni puoi cambiare lingua e preferenze; Abbonamento mostra piano e limiti effettivi."], en: ["Understand your numbers and settings", "The finance register tracks income and expenses. Import and export help move and back up data. Settings contains language and preferences; Subscription shows your actual plan and limits."] }
] as const;

export function OnboardingTour({ locale, onNavigate, onClose }: {
  locale: Locale;
  onNavigate: (path: string) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const english = locale === "en";
  useEffect(() => {
    let active = true;
    api.get<{ entitlements: Entitlements }>("/billing/subscription")
      .then((result) => { if (active) setEntitlements(result.entitlements); })
      .catch(() => { if (active) setEntitlements(null); });
    return () => { active = false; };
  }, []);
  const current = steps[step]!;
  const copy = english ? current.en : current.it;
  const limit = (value: number | null, used: number) => value === null
    ? (english ? "Unlimited" : "Senza limite")
    : `${used} / ${value}`;
  const finish = () => {
    try { localStorage.setItem("snakebee:onboarding:v1", "completed"); } catch { /* Tour remains dismissible if storage is unavailable. */ }
    onClose();
  };
  return <div className="onboarding-backdrop" role="presentation">
    <section className="onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <header className="onboarding-header">
        <span className="onboarding-brand"><span className="brand-mark"><Icon name="leaf" /></span><span><strong>SnakeBee</strong><small>{english ? "Your breeding workspace" : "Il tuo spazio di allevamento"}</small></span></span>
        <button type="button" className="onboarding-close" onClick={finish} aria-label={english ? "Close tutorial" : "Chiudi tutorial"}><Icon name="x" /></button>
      </header>
      <div className="onboarding-progress" aria-label={english ? `Step ${step + 1} of ${steps.length}` : `Passaggio ${step + 1} di ${steps.length}`}>
        {steps.map((item, index) => <span key={item.path} className={index <= step ? "done" : ""} />)}
      </div>
      <div className="onboarding-body">
        <div className="onboarding-step-count">{english ? `GETTING STARTED · ${String(step + 1).padStart(2, "0")} / ${String(steps.length).padStart(2, "0")}` : `PER INIZIARE · ${String(step + 1).padStart(2, "0")} / ${String(steps.length).padStart(2, "0")}`}</div>
        <div className="onboarding-icon"><Icon name={current.icon} size={25} /></div>
        <h2 id="onboarding-title">{copy[0]}</h2>
        <p className="onboarding-description">{copy[1]}</p>
        {step === 0 && <div className="onboarding-tip"><Icon name="lightbulb" /><span>{english ? "Tip: add your animals first. The rest of the workspace becomes much more useful once records are linked to them." : "Consiglio: inizia inserendo gli animali. Il resto della piattaforma diventa molto più utile quando le registrazioni sono collegate ai loro profili."}</span></div>}
        {step === steps.length - 1 && <div className="onboarding-plan">
          <strong>{english ? "Your current plan" : "Il tuo piano attuale"}</strong>
          {entitlements ? <>
            <div className="onboarding-plan-name">{entitlements.plan === "paid" ? (english ? "Paid plan" : "Piano a pagamento") : (english ? "Free plan" : "Piano gratuito")}</div>
            <div className="onboarding-limits">
              <span>{english ? "Animals" : "Animali"} <b>{limit(entitlements.maxAnimals, entitlements.animalsUsed)}</b></span>
              <span>{english ? "Documents" : "Documenti"} <b>{limit(entitlements.maxDocuments, entitlements.documentsUsed)}</b></span>
              <span>{english ? "Storage" : "Spazio documenti"} <b>{entitlements.maxStorageBytes === null ? (english ? "Unlimited" : "Senza limite") : `${(Number(entitlements.storageBytesUsed) / 1024 / 1024).toFixed(1)} / ${(entitlements.maxStorageBytes / 1024 / 1024).toFixed(0)} MB`}</b></span>
            </div>
          </> : <p>{english ? "Open Subscription to see the limits applied to your account." : "Apri Abbonamento per vedere i limiti applicati al tuo account."}</p>}
          <p className="onboarding-plan-note">{english ? "Limits and included features are enforced by your account's current subscription. Check Subscription for the latest details before upgrading." : "Limiti e funzionalità dipendono dall'abbonamento effettivo del tuo account. Consulta Abbonamento per i dettagli aggiornati prima di effettuare un upgrade."}</p>
        </div>}
      </div>
      <footer className="onboarding-footer">
        <button type="button" className="onboarding-skip" onClick={finish}>{english ? "Skip tutorial" : "Salta il tutorial"}</button>
        <div className="onboarding-actions">
          {step > 0 && <Button variant="secondary" onClick={() => setStep((value) => value - 1)}>{english ? "Back" : "Indietro"}</Button>}
          {step < steps.length - 1
            ? <Button onClick={() => setStep((value) => value + 1)}>{english ? "Continue" : "Continua"} <Icon name="arrow-right" size={15} /></Button>
            : <Button onClick={() => { finish(); onNavigate("/animals"); }}>{english ? "Let's get started" : "Iniziamo"} <Icon name="arrow-right" size={15} /></Button>}
        </div>
      </footer>
    </section>
  </div>;
}
