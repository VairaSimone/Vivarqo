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

const STORAGE_KEY = "vivarqo.onboarding.minimized";

const steps: Array<{ key: Milestone; icon: string; path: string; title: { it: string; en: string }; description: { it: string; en: string }; action: { it: string; en: string } }> = [
  { key: "animal", icon: "snake", path: "/animals?create=1", title: { it: "Aggiungi i tuoi animali", en: "Add your animals" }, description: { it: "Crea la prima scheda oppure importa la collezione da un file. Non serve configurare tutto adesso.", en: "Create your first profile or import your collection from a file. You don't need to configure everything now." }, action: { it: "Aggiungi animali", en: "Add animals" } },
  { key: "feeding", icon: "feed", path: "/feeding?create=1", title: { it: "Registra la prima alimentazione", en: "Record your first feeding" }, description: { it: "Collega un pasto a uno o più animali e inizia a costruire il loro storico.", en: "Link a feeding to one or more animals and start building their care history." }, action: { it: "Registra pasto", en: "Record feeding" } },
];

const contextual = [
  { key: "animal-care", icon: "weight", title: { it: "Completa la scheda di cura", en: "Complete your care records" }, body: { it: "Hai già inserito animali: registra un peso per iniziare a seguirne la crescita.", en: "You have animals in your collection. Record a weight to start tracking their growth." }, path: "/animals?weigh=1", action: { it: "Registra un peso", en: "Record a weight" } },
  { key: "clutch-eggs", icon: "egg", title: { it: "Hai creato una covata", en: "You created a clutch" }, body: { it: "Aggiungi le singole uova per seguirne stato e incubazione.", en: "Add individual eggs to track their status and incubation." }, path: "/reproduction", action: { it: "Apri riproduzioni", en: "Open breeding" } },
];

function readMinimized(): boolean {
  try { return window.localStorage.getItem(STORAGE_KEY) === "true"; } catch { return false; }
}

export function OnboardingChecklist({ locale, onNavigate }: { locale: Locale; onNavigate: (path: string) => void }) {
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(readMinimized);
  const [dismissError, setDismissError] = useState(false);
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

  function toggleMinimized(next: boolean) {
    setMinimized(next);
    try { window.localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* Keep the current session preference. */ }
  }

  async function dismiss(key: string) {
    setDismissing(key);
    setDismissError(false);
    try {
      await api.post(`/onboarding/suggestions/${encodeURIComponent(key)}/dismiss`);
      setProgress((previous) => previous ? { ...previous, dismissedSuggestions: [...new Set([...previous.dismissedSuggestions, key])] } : previous);
    } catch {
      setDismissError(true);
    } finally {
      setDismissing(null);
    }
  }

  if (loading && !progress) return <section className="onboarding-checklist panel" aria-label={english ? "Getting started" : "Primi passi"}><LoadingState label={english ? "Checking your progress…" : "Controllo dei tuoi progressi…"} /></section>;
  if (failed || !progress) return <section className="onboarding-checklist panel" aria-label={english ? "Getting started" : "Primi passi"}>
    <p className="onboarding-checklist-description">{english ? "We couldn't load your progress. Your records are safe; try again." : "Non siamo riusciti a caricare i progressi. I tuoi dati sono al sicuro: riprova."}</p>
    <Button size="sm" variant="secondary" onClick={() => void refresh()}><Icon name="refresh" size={14} />{english ? "Retry" : "Riprova"}</Button>
  </section>;

  const completedCount = steps.filter((step) => progress.completed[step.key] === true).length;
  const showChecklist = completedCount < steps.length;
  const suggestions = contextual.filter((item) => {
    if (progress.dismissedSuggestions.includes(item.key)) return false;
    if (item.key === "animal-care") return progress.completed.animal && !progress.completed.weight;
    return progress.completed.clutch && !progress.completed.egg;
  });

  return <>
    {showChecklist && <section className="onboarding-checklist panel" aria-labelledby="onboarding-checklist-title">
      <div className="onboarding-checklist-heading">
        <div><span className="eyebrow">{english ? "YOUR FIRST STEPS" : "PER INIZIARE"}</span><h2 id="onboarding-checklist-title">{english ? "Start with the essentials" : "Inizia dalle cose essenziali"}</h2><p>{english ? "Add your animals, then record a feeding. You can explore the other features when you need them." : "Inserisci i tuoi animali e registra un pasto. Le altre funzioni le scoprirai quando ti serviranno."}</p></div>
        <div className="onboarding-checklist-heading-actions">
          <div className="onboarding-checklist-progress" aria-label={english ? `${completedCount} of 2 completed` : `${completedCount} di 2 completati`}><strong>{completedCount}/2</strong><span>{english ? "completed" : "completati"}</span></div>
          <Button size="sm" variant="ghost" onClick={() => toggleMinimized(!minimized)} aria-expanded={!minimized} aria-controls="onboarding-checklist-content"><Icon name={minimized ? "chevron" : "minus"} size={15} />{minimized ? (english ? "Expand" : "Espandi") : (english ? "Minimize" : "Riduci")}</Button>
        </div>
      </div>
      {!minimized && <div id="onboarding-checklist-content">
        <div className="onboarding-checklist-track" role="progressbar" aria-label={english ? "Getting started progress" : "Primi passi completati"} aria-valuemin={0} aria-valuemax={2} aria-valuenow={completedCount}><span style={{ width: `${completedCount / 2 * 100}%` }} /></div>
        <ol className="onboarding-checklist-items">
          {steps.map((item) => {
            const done = progress.completed[item.key] === true;
            return <li key={item.key} className={done ? "is-complete" : ""}>
              <span className="onboarding-checklist-icon"><Icon name={done ? "checkCircle" : item.icon} size={18} /></span>
              <div className="onboarding-checklist-copy"><strong>{english ? item.title.en : item.title.it}</strong><p>{english ? item.description.en : item.description.it}</p></div>
              {done ? <span className="onboarding-checklist-done"><Icon name="check" size={14} />{english ? "Done" : "Completato"}</span>
                : <Button size="sm" variant="secondary" onClick={() => onNavigate(item.path)}>{english ? item.action.en : item.action.it}<Icon name="arrow" size={14} /></Button>}
            </li>;
          })}
        </ol>
        <p className="onboarding-checklist-footnote">{english ? "You can keep using SnakeBee without completing every suggestion. Your existing records are not changed." : "Puoi usare SnakeBee anche senza completare tutti i suggerimenti. I dati già presenti non vengono modificati."}</p>
      </div>}
    </section>}
    {suggestions.length > 0 && <section className="onboarding-contextual" aria-label={english ? "Suggested next steps" : "Suggerimenti contestuali"}>
      {suggestions.map((item) => <article className="onboarding-contextual-card panel" key={item.key}>
        <span className="onboarding-checklist-icon"><Icon name={item.icon} size={18} /></span>
        <div className="onboarding-checklist-copy"><strong>{english ? item.title.en : item.title.it}</strong><p>{english ? item.body.en : item.body.it}</p></div>
        <Button size="sm" onClick={() => onNavigate(item.path)}>{english ? item.action.en : item.action.it}<Icon name="arrow" size={14} /></Button>
        <button className="onboarding-suggestion-dismiss" type="button" disabled={dismissing === item.key} onClick={() => void dismiss(item.key)} aria-label={english ? "Dismiss suggestion" : "Nascondi suggerimento"}><Icon name="close" size={16} /></button>
      </article>)}
      {dismissError && <p className="muted-note" role="alert">{english ? "Couldn't dismiss the suggestion. Please try again." : "Non è stato possibile nascondere il suggerimento. Riprova."}</p>}
    </section>}
  </>;
}