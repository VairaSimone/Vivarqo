import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Locale } from "../lib/domain";
import { Button, Icon, LoadingState } from "./ui";

type Milestone = "animal" | "feeding" | "weight" | "shed" | "reminder" | "clutch" | "egg";
type ProgressResponse = {
  current: Record<Milestone, boolean>;
  completed: Record<Milestone, boolean>;
  dismissedSuggestions: string[];
};

const steps: Array<{ key: Milestone; optional: boolean; icon: string; path: string; title: { it: string; en: string }; description: { it: string; en: string }; action: { it: string; en: string } }> = [
  { key: "animal", optional: false, icon: "snake", path: "/animals?create=1", title: { it: "Aggiungi il primo animale", en: "Add your first animal" }, description: { it: "Crea la scheda del tuo primo esemplare, oppure importa la tua collezione.", en: "Create your first animal profile, or import your collection." }, action: { it: "Aggiungi animale", en: "Add animal" } },
  { key: "feeding", optional: false, icon: "feed", path: "/feeding?create=1", title: { it: "Registra la prima alimentazione", en: "Record the first feeding" }, description: { it: "Registra l'esito di un pasto, anche per più animali.", en: "Record a feeding outcome, including for multiple animals." }, action: { it: "Registra pasto", en: "Record feeding" } },
  { key: "reminder", optional: false, icon: "calendar", path: "/tasks?tab=reminders&create=1", title: { it: "Crea il primo promemoria", en: "Create your first reminder" }, description: { it: "Imposta una scadenza ricorrente per le attività di gestione.", en: "Set a recurring due date for routine care." }, action: { it: "Crea promemoria", en: "Create reminder" } },
  { key: "weight", optional: true, icon: "weight", path: "/animals?weigh=1", title: { it: "Registra il primo peso", en: "Record the first weight" }, description: { it: "Inizia a seguire la crescita e le variazioni di peso.", en: "Start tracking growth and weight changes." }, action: { it: "Registra peso", en: "Record weight" } },
  { key: "shed", optional: true, icon: "leaf", path: "/animals", title: { it: "Registra la prima muta", en: "Record the first shed" }, description: { it: "Tieni traccia delle mute e della loro qualità.", en: "Keep track of sheds and their quality." }, action: { it: "Apri animali", en: "Open animals" } },
];

const contextual = [
  { key: "animal-care", icon: "weight", title: { it: "Completa la scheda di cura", en: "Complete your care records" }, body: { it: "Hai già inserito animali: registra un peso per iniziare a seguirne la crescita.", en: "You have animals in your collection. Record a weight to start tracking their growth." }, path: "/animals?weigh=1", action: { it: "Registra un peso", en: "Record a weight" } },
  { key: "clutch-eggs", icon: "egg", title: { it: "Hai creato una covata", en: "You created a clutch" }, body: { it: "Aggiungi le singole uova per seguirne stato e incubazione.", en: "Add individual eggs to track their status and incubation." }, path: "/reproduction-cycles", action: { it: "Apri riproduzioni", en: "Open reproduction" } },
];

export function OnboardingChecklist({ locale, onNavigate }: { locale: Locale; onNavigate: (path: string) => void }) {
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const english = locale === "en";

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setFailed(false);
    try {
      const result = await api.get<ProgressResponse>("/onboarding/progress", { signal });
      if (!signal?.aborted) setProgress(result);
    } catch {
      if (!signal?.aborted) setFailed(true);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  async function dismiss(key: string) {
    setDismissing(key);
    try {
      await api.post(`/onboarding/suggestions/${key}/dismiss`);
      setProgress((previous) => previous ? { ...previous, dismissedSuggestions: [...previous.dismissedSuggestions, key] } : previous);
    } finally {
      setDismissing(null);
    }
  }

  if (loading && !progress) return <section className="onboarding-checklist panel" aria-label={english ? "Getting started" : "Primi passi"}><LoadingState label={english ? "Checking your progress…" : "Controllo dei tuoi progressi…"} /></section>;
  if (failed || !progress) return <section className="onboarding-checklist panel" aria-label={english ? "Getting started" : "Primi passi"}>
    <p className="onboarding-checklist-description">{english ? "We couldn't load your progress. Your records are safe; try again." : "Non siamo riusciti a caricare i progressi. I tuoi dati sono al sicuro: riprova."}</p>
    <Button size="sm" variant="secondary" onClick={() => void refresh()}><Icon name="refresh" size={14} />{english ? "Retry" : "Riprova"}</Button>
  </section>;

  const required = steps.filter((step) => !step.optional);
  const completedRequired = required.filter((step) => progress.completed[step.key]).length;
  const showChecklist = completedRequired < required.length;
  const visibleSteps = steps.filter((step) => {
    if (step.key === "animal") return true;
    return progress.completed.animal;
  });
  const suggestions = contextual.filter((item) => {
    if (progress.dismissedSuggestions.includes(item.key)) return false;
    if (item.key === "animal-care") return progress.completed.animal && !progress.completed.weight;
    return progress.completed.clutch && !progress.completed.egg;
  });

  return <>
    {showChecklist && <section className="onboarding-checklist panel" aria-labelledby="onboarding-checklist-title">
      <div className="onboarding-checklist-heading">
        <div><span className="eyebrow">{english ? "YOUR FIRST STEPS" : "I TUOI PRIMI PASSI"}</span><h2 id="onboarding-checklist-title">{english ? "Get your workspace ready" : "Metti in moto il tuo allevamento"}</h2><p>{english ? "Core setup first; the other actions are optional tips." : "Prima le attività essenziali; le altre sono suggerimenti facoltativi."}</p></div>
        <div className="onboarding-checklist-progress" aria-label={english ? `${completedRequired} of 3 core steps completed` : `${completedRequired} di 3 passaggi essenziali completati`}><strong>{completedRequired}/3</strong><span>{english ? "essential" : "essenziali"}</span></div>
      </div>
      <div className="onboarding-checklist-track" role="progressbar" aria-valuemin={0} aria-valuemax={3} aria-valuenow={completedRequired}><span style={{ width: `${completedRequired / 3 * 100}%` }} /></div>
      <ol className="onboarding-checklist-items">
        {visibleSteps.map((item) => {
          const done = progress.completed[item.key];
          return <li key={item.key} className={done ? "is-complete" : ""}>
            <span className="onboarding-checklist-icon"><Icon name={done ? "checkCircle" : item.icon} size={18} /></span>
            <div className="onboarding-checklist-copy"><strong>{english ? item.title.en : item.title.it}</strong><p>{english ? item.description.en : item.description.it}</p></div>
            {item.optional && <span className="onboarding-checklist-done">{english ? "Optional" : "Facoltativo"}</span>}
            {done ? <span className="onboarding-checklist-done"><Icon name="check" size={14} />{english ? "Done" : "Fatto"}</span>
              : <Button size="sm" variant={!item.optional && !required.slice(0, completedRequired).some((step) => step.key === item.key) ? "primary" : "secondary"} onClick={() => onNavigate(item.path)}>{english ? item.action.en : item.action.it}<Icon name="arrow" size={14} /></Button>}
          </li>;
        })}
      </ol>
      <p className="onboarding-checklist-footnote">{english ? "Imported data counts too. Completed steps remain completed even if you later delete records." : "Anche i dati importati vengono riconosciuti. Un passaggio completato resta tale anche se in seguito elimini dei record."}</p>
    </section>}
    {suggestions.length > 0 && <section className="onboarding-contextual" aria-label={english ? "Suggested next steps" : "Suggerimenti contestuali"}>
      {suggestions.map((item) => <article className="onboarding-contextual-card panel" key={item.key}>
        <span className="onboarding-checklist-icon"><Icon name={item.icon} size={18} /></span>
        <div className="onboarding-checklist-copy"><strong>{english ? item.title.en : item.title.it}</strong><p>{english ? item.body.en : item.body.it}</p></div>
        <Button size="sm" onClick={() => onNavigate(item.path)}>{english ? item.action.en : item.action.it}<Icon name="arrow" size={14} /></Button>
        <button className="onboarding-suggestion-dismiss" type="button" disabled={dismissing === item.key} onClick={() => void dismiss(item.key)} aria-label={english ? "Dismiss suggestion" : "Nascondi suggerimento"}><Icon name="close" size={16} /></button>
      </article>)}
    </section>}
  </>;
}
