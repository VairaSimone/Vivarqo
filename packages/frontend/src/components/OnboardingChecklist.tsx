import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Locale } from "../lib/domain";
import { Button, Icon, LoadingState } from "../components/ui";

type ChecklistStatus = {
  animal: boolean;
  feeding: boolean;
  reminder: boolean;
};

type CountResponse = { pagination?: { total?: number } };

const steps = [
  {
    key: "animal" as const,
    icon: "snake",
    path: "/animals?create=1",
    title: { it: "Aggiungi il primo animale", en: "Add your first animal" },
    description: { it: "Crea la scheda del tuo primo esemplare: sarà il punto di partenza per tutto lo storico.", en: "Create your first animal profile. It becomes the starting point for its care history." },
    action: { it: "Aggiungi animale", en: "Add animal" },
  },
  {
    key: "feeding" as const,
    icon: "feed",
    path: "/feeding?create=1",
    title: { it: "Registra la prima alimentazione", en: "Record the first feeding" },
    description: { it: "Registra l'esito di un pasto e collega la voce a un animale già inserito.", en: "Record a feeding outcome and link it to an animal in your collection." },
    action: { it: "Registra alimentazione", en: "Record feeding" },
  },
  {
    key: "reminder" as const,
    icon: "calendar",
    path: "/tasks?tab=reminders&create=1",
    title: { it: "Crea il primo promemoria", en: "Create your first reminder" },
    description: { it: "Imposta una scadenza ricorrente per non dimenticare le attività di gestione.", en: "Set a recurring due date so routine care never slips through the cracks." },
    action: { it: "Crea promemoria", en: "Create reminder" },
  },
];

export function OnboardingChecklist({ locale, onNavigate }: { locale: Locale; onNavigate: (path: string) => void }) {
  const [status, setStatus] = useState<ChecklistStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const english = locale === "en";

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setFailed(false);
    const results = await Promise.allSettled([
      api.get<CountResponse>("/animals?page=1&pageSize=1"),
      api.get<CountResponse>("/feeding-sessions?page=1&pageSize=1"),
      api.get<CountResponse>("/tasks/reminder-rules?page=1&pageSize=1&enabled=true"),
    ]);
    if (signal?.aborted) return;
    if (results.some((result) => result.status === "rejected")) {
      setFailed(true);
      setStatus(null);
    } else {
      const [animals, feedings, reminders] = results as [
        PromiseFulfilledResult<CountResponse>,
        PromiseFulfilledResult<CountResponse>,
        PromiseFulfilledResult<CountResponse>
      ];
      setStatus({
        animal: (animals.value.pagination?.total ?? 0) > 0,
        feeding: (feedings.value.pagination?.total ?? 0) > 0,
        reminder: (reminders.value.pagination?.total ?? 0) > 0,
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  if (loading && !status) return <section className="onboarding-checklist panel" aria-label={english ? "Getting started checklist" : "Checklist per iniziare"}><LoadingState label={english ? "Checking your progress…" : "Controllo dei tuoi progressi…"} /></section>;
  if (failed || !status) return <section className="onboarding-checklist panel" aria-label={english ? "Getting started checklist" : "Checklist per iniziare"}>
    <div className="onboarding-checklist-heading"><div><span className="eyebrow">{english ? "GETTING STARTED" : "PRIMI PASSI"}</span><h2>{english ? "Let's set up your workspace" : "Mettiamo in moto il tuo allevamento"}</h2></div></div>
    <p className="onboarding-checklist-description">{english ? "We couldn't load your progress. Your records are safe; try again." : "Non siamo riusciti a caricare i progressi. I tuoi dati sono al sicuro: riprova."}</p>
    <Button size="sm" variant="secondary" onClick={() => void refresh()}><Icon name="refresh" size={14} />{english ? "Retry" : "Riprova"}</Button>
  </section>;

  const completed = steps.filter((item) => status[item.key]).length;
  if (completed === steps.length) return null;

  return <section className="onboarding-checklist panel" aria-labelledby="onboarding-checklist-title">
    <div className="onboarding-checklist-heading">
      <div><span className="eyebrow">{english ? "YOUR FIRST STEPS" : "I TUOI PRIMI PASSI"}</span><h2 id="onboarding-checklist-title">{english ? "Turn your account into a working space" : "Trasforma il tuo account in uno strumento di lavoro"}</h2><p>{english ? "Complete these actions to get real value from SnakeBee." : "Completa queste attività per iniziare a usare davvero SnakeBee."}</p></div>
      <div className="onboarding-checklist-progress" aria-label={english ? `${completed} of 3 completed` : `${completed} di 3 completati`}><strong>{completed}/3</strong><span>{english ? "completed" : "completati"}</span></div>
    </div>
    <div className="onboarding-checklist-track" role="progressbar" aria-valuemin={0} aria-valuemax={3} aria-valuenow={completed}><span style={{ width: `${completed / 3 * 100}%` }} /></div>
    <ol className="onboarding-checklist-items">
      {steps.map((item, index) => {
        const done = status[item.key];
        return <li key={item.key} className={done ? "is-complete" : ""}>
          <span className="onboarding-checklist-icon"><Icon name={done ? "checkCircle" : item.icon} size={18} /></span>
          <div className="onboarding-checklist-copy"><strong>{english ? item.title.en : item.title.it}</strong><p>{english ? item.description.en : item.description.it}</p></div>
          {done
            ? <span className="onboarding-checklist-done"><Icon name="check" size={14} />{english ? "Done" : "Fatto"}</span>
            : <Button size="sm" variant={index === completed ? "primary" : "secondary"} onClick={() => onNavigate(item.path)}>{english ? item.action.en : item.action.it}<Icon name="arrow" size={14} /></Button>}
        </li>;
      })}
    </ol>
    <p className="onboarding-checklist-footnote">{english ? "Progress is based on your saved records and follows your account across devices." : "I progressi derivano dai dati salvati e seguono il tuo account su tutti i dispositivi."}</p>
  </section>;
}
