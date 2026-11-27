import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../lib/api";
import type { Locale } from "../lib/domain";
import { Alert, Button, Icon, LoadingState } from "../components/ui";

type AnimalCategory = "reptiles" | "fish" | "birds" | "dogs_cats";
type ConfigurationResponse = { categories: AnimalCategory[]; configuredAt: string | null };

const categories: Array<{
  id: AnimalCategory;
  emoji: string;
  title: { it: string; en: string };
  description: { it: string; en: string };
  modules: { it: string[]; en: string[] };
}> = [
  {
    id: "reptiles", emoji: "🐍",
    title: { it: "Rettili", en: "Reptiles" },
    description: { it: "Serpenti, gechi, pogone, tartarughe", en: "Snakes, geckos, bearded dragons, tortoises" },
    modules: { it: ["Morph, genetica e sesso", "Prede, quantità e rifiuti", "Terrari, rack e temperature", "Accoppiamenti, uova e incubazione", "Mute, controlli e trattamenti"], en: ["Morphs, genetics and sex", "Prey, quantities and refusals", "Terrariums, racks and temperatures", "Pairings, eggs and incubation", "Shedding, checks and treatments"] }
  },
  {
    id: "fish", emoji: "🐠",
    title: { it: "Pesci", en: "Fish" },
    description: { it: "Acquari, specie, vasche, riproduzione", en: "Aquariums, species, tanks and breeding" },
    modules: { it: ["Specie e varietà", "Mangime e quantità", "Acquari e parametri dell'acqua", "Deposizione e avannotti", "pH, ammoniaca, nitriti e nitrati"], en: ["Species and varieties", "Food and quantities", "Aquariums and water parameters", "Spawning and fry", "pH, ammonia, nitrites and nitrates"] }
  },
  {
    id: "birds", emoji: "🦜",
    title: { it: "Uccelli", en: "Birds" },
    description: { it: "Specie, coppie, deposizione, schiuse", en: "Species, pairs, laying and hatching" },
    modules: { it: ["Specie, varietà e anello", "Mangime e dieta", "Voliera e gabbia", "Coppie, uova e schiuse", "Controlli e trattamenti"], en: ["Species, varieties and leg bands", "Food and diet", "Aviary and cage", "Pairs, eggs and hatching", "Checks and treatments"] }
  },
  {
    id: "dogs_cats", emoji: "🐕",
    title: { it: "Cani e gatti", en: "Dogs and cats" },
    description: { it: "Anagrafica, salute, cucciolate", en: "Profiles, health and litters" },
    modules: { it: ["Razza, microchip e anagrafica", "Pasti e dieta", "Ambiente e routine", "Accoppiamenti, gravidanza e cucciolate", "Vaccini, visite e trattamenti"], en: ["Breed, microchip and profile", "Meals and diet", "Environment and routines", "Mating, pregnancy and litters", "Vaccinations, visits and treatments"] }
  }
];

export function AccountCategoriesPage({ locale, mode = "settings", onComplete }: {
  locale: Locale;
  mode?: "setup" | "settings";
  onComplete: () => void;
}) {
  const english = locale === "en";
  const [selected, setSelected] = useState<AnimalCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const isSetup = mode === "setup";

  useEffect(() => {
    let active = true;
    api.get<ConfigurationResponse>("/onboarding/configuration").then((result) => {
      if (!active) return;
      setSelected(result.categories);
      setLoaded(true);
    }).catch((reason: unknown) => {
      if (!active) return;
      setError(reason instanceof ApiError ? reason.message : (english ? "Could not load your configuration." : "Impossibile caricare la configurazione."));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [english]);

  const selectedDetails = useMemo(() => categories.filter((category) => selected.includes(category.id)), [selected]);

  function toggle(category: AnimalCategory) {
    setSelected((current) => current.includes(category)
      ? current.filter((value) => value !== category)
      : [...current, category]);
  }

  async function save() {
    if (selected.length === 0) {
      setError(english ? "Choose at least one category to continue." : "Seleziona almeno una categoria per continuare.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.post<ConfigurationResponse>("/onboarding/configuration", { categories: selected });
      onComplete();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : (english ? "Could not save your configuration. Try again." : "Impossibile salvare la configurazione. Riprova."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="app-boot"><LoadingState /></div>;

  return <main className="category-setup">
    <div className="category-setup-header">
      <span className="category-setup-brand"><span className="brand-mark"><Icon name="leaf" /></span> Vivarqo</span>
      <span className="category-setup-step">{isSetup ? (english ? "YOUR WORKSPACE" : "IL TUO SPAZIO DI LAVORO") : (english ? "ACCOUNT SETTINGS" : "IMPOSTAZIONI ACCOUNT")}</span>
    </div>
    <section className="category-setup-content">
      <div className="category-setup-intro">
        <span className="eyebrow">{english ? "LET'S SET THINGS UP" : "CONFIGURAZIONE INIZIALE"}</span>
        <h1>{english ? "Configure Vivarqo" : "Configura Vivarqo"}</h1>
        <p>{english ? "Choose which types of animals you want to manage. You can select more than one and change this choice later." : "Scegli quale tipologia di animali vuoi gestire. Puoi selezionare più categorie e modificare questa scelta in seguito."}</p>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="category-choice-grid" aria-label={english ? "Animal categories" : "Categorie animali"}>
        {categories.map((category) => {
          const active = selected.includes(category.id);
          return <button key={category.id} type="button" className={active ? "category-choice selected" : "category-choice"}
            aria-pressed={active} onClick={() => toggle(category.id)}>
            <span className="category-choice-check" aria-hidden="true">{active ? <Icon name="check" size={16} /> : null}</span>
            <span className="category-choice-emoji" aria-hidden="true">{category.emoji}</span>
            <span className="category-choice-copy">
              <strong>{english ? category.title.en : category.title.it}</strong>
              <small>{english ? category.description.en : category.description.it}</small>
            </span>
          </button>;
        })}
      </div>
      <div className="category-architecture">
        <div className="category-architecture-heading">
          <div><span className="eyebrow">{english ? "ONE PLATFORM, SPECIALIZED MODULES" : "UN'UNICA PIATTAFORMA, MODULI SPECIALIZZATI"}</span>
            <h2>{english ? "What changes with your selection" : "Cosa cambia in base alla selezione"}</h2></div>
          <span className="category-selection-count">{selected.length} / 4</span>
        </div>
        <div className="category-core">
          <strong>{english ? "Shared core" : "Nucleo comune"}</strong>
          <span>{english ? "Animals · Feeding · Documents · Expenses · Reminders · Users" : "Animali · Alimentazione · Documenti · Spese · Promemoria · Utenti"}</span>
        </div>
        {selectedDetails.length > 0 ? <div className="category-module-list">
          {selectedDetails.map((category) => <div className="category-module" key={category.id}>
            <strong><span>{category.emoji}</span>{english ? category.title.en : category.title.it}</strong>
            <ul>{(english ? category.modules.en : category.modules.it).map((module) => <li key={module}>{module}</li>)}</ul>
          </div>)}
        </div> : <p className="category-empty-hint">{english ? "Select one or more categories to preview their specialized modules." : "Seleziona una o più categorie per vedere i relativi moduli specializzati."}</p>}
        <p className="category-architecture-note">{english
          ? "Your selection is saved at account level. Specialized workflows will be enabled progressively; existing records are never deleted or converted when you change categories."
          : "La selezione viene salvata sull'account. I flussi specializzati saranno attivati progressivamente: cambiare categoria non cancella né converte i dati già presenti."}</p>
      </div>
      {!loaded && <Alert tone="warning">{english ? "The current configuration could not be confirmed." : "Non è stato possibile verificare la configurazione attuale."}</Alert>}
      <div className="category-setup-actions">
        <span>{english ? "You can update this choice at any time from Settings." : "Potrai modificare questa scelta in qualsiasi momento dalle Impostazioni."}</span>
        <Button onClick={() => void save()} disabled={saving || selected.length === 0}>
          {saving ? (english ? "Saving…" : "Salvataggio…") : (english ? "Confirm selection" : "Conferma selezione")}
          {!saving && <Icon name="arrow" size={15} />}
        </Button>
      </div>
    </section>
  </main>;
}
