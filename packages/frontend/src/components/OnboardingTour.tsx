import { useState } from "react";
import type { Locale } from "../lib/domain";
import { Button, Icon } from "../components/ui";

const steps = [
  { icon: "snake", path: "/animals", it: ["1. Inserisci gli animali", "Crea le schede dei tuoi esemplari oppure importa la collezione. Puoi aggiungere dettagli e completare le informazioni in un secondo momento."], en: ["1. Add your animals", "Create profiles for your animals or import your collection. You can add details and complete the information later."] },
  { icon: "feed", path: "/feeding", it: ["2. Registra un'alimentazione", "Scegli uno o più animali, registra l'esito del pasto e inizia a costruire lo storico delle cure."], en: ["2. Record a feeding", "Choose one or more animals, record the feeding outcome and start building their care history."] },
  { icon: "calendar", path: "/today", it: ["3. Torna qui per le priorità", "La pagina Oggi ti mostra attività scadute, alimentazioni da controllare e promemoria imminenti. Le altre sezioni sono disponibili quando ti serviranno."], en: ["3. Return here for priorities", "The Today page highlights overdue tasks, feeding alerts and upcoming reminders. The other sections are there when you need them."] }
] as const;

export function OnboardingTour({ locale, onNavigate, onClose }: {
  locale: Locale;
  onNavigate: (path: string) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const english = locale === "en";
  const current = steps[step]!;
  const copy = english ? current.en : current.it;
  const finish = () => {
    try { localStorage.setItem("snakebee:onboarding:v1", "completed"); } catch { /* Tour remains dismissible if storage is unavailable. */ }
    onClose();
  };
  return <div className="onboarding-backdrop" role="presentation">
    <section className="onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <header className="onboarding-header">
        <span className="onboarding-brand"><span className="brand-mark"><Icon name="brand" /></span><span><strong>SnakeBee</strong><small>{english ? "Your breeding workspace" : "Il tuo spazio di allevamento"}</small></span></span>
        <button type="button" className="onboarding-close" onClick={finish} aria-label={english ? "Close tutorial" : "Chiudi tutorial"}><Icon name="close" /></button>
      </header>
      <div className="onboarding-progress" aria-label={english ? `Step ${step + 1} of ${steps.length}` : `Passaggio ${step + 1} di ${steps.length}`}>
        {steps.map((item, index) => <span key={item.path} className={index <= step ? "done" : ""} />)}
      </div>
      <div className="onboarding-body">
        <div className="onboarding-step-count">{english ? `GETTING STARTED · ${String(step + 1).padStart(2, "0")} / ${String(steps.length).padStart(2, "0")}` : `PER INIZIARE · ${String(step + 1).padStart(2, "0")} / ${String(steps.length).padStart(2, "0")}`}</div>
        <div className="onboarding-icon"><Icon name={current.icon} size={25} /></div>
        <h2 id="onboarding-title">{copy[0]}</h2>
        <p className="onboarding-description">{copy[1]}</p>
        <button type="button" className="onboarding-open-section" onClick={() => { finish(); onNavigate(current.path); }}>{english ? "Open this section" : "Apri questa sezione"} <Icon name="arrow" size={14} /></button>
        {step === 0 && <div className="onboarding-tip"><Icon name="leaf" /><span>{english ? "A good starting point: add your animals first. The rest of the workspace becomes much more useful once records are linked to them." : "Un buon punto di partenza: inserisci prima gli animali. Il resto della piattaforma diventa molto più utile quando le registrazioni sono collegate ai loro profili."}</span></div>}

      </div>
      <footer className="onboarding-footer">
        <button type="button" className="onboarding-skip" onClick={finish}>{english ? "Skip tutorial" : "Salta il tutorial"}</button>
        <div className="onboarding-actions">
          {step > 0 && <Button variant="secondary" onClick={() => setStep((value) => value - 1)}>{english ? "Back" : "Indietro"}</Button>}
          {step < steps.length - 1
            ? <Button onClick={() => setStep((value) => value + 1)}>{english ? "Continue" : "Continua"} <Icon name="arrow" size={15} /></Button>
            : <Button onClick={() => { finish(); onNavigate("/today"); }}>{english ? "Let's get started" : "Iniziamo"} <Icon name="arrow" size={15} /></Button>}
        </div>
      </footer>
    </section>
  </div>;
}
