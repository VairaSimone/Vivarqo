import type { Locale } from "../lib/domain";
import { Button, Icon, PageHeader, Panel } from "../components/ui";

type Guide = { title: string; description: string; path: string; steps: string[] };
const guides: Record<Locale, Guide[]> = {
  it: [
    { title: "Animali e schede", description: "Crea l'anagrafica e tieni a portata di mano identità, provenienza, genetica e stato.", path: "/animals", steps: ["Apri Animali e scegli Aggiungi animale.", "Compila almeno nome e specie; gli altri dati possono essere aggiunti in seguito.", "Apri la scheda per consultare cronologia, pesi, mute e documenti collegati."] },
    { title: "Alimentazioni e cure", description: "Registra ogni pasto e gli eventi di cura senza perdere lo storico.", path: "/feeding", steps: ["Seleziona uno o più animali.", "Inserisci data, alimento ed esito: mangiato, rifiutato o non offerto.", "Consulta lo storico per ricostruire l'andamento nel tempo."] },
    { title: "Attività e calendario", description: "Trasforma le cose da ricordare in attività e promemoria.", path: "/tasks", steps: ["Crea un'attività con titolo e scadenza.", "Collega un animale quando l'attività lo riguarda.", "Usa il calendario per controllare le scadenze e segna le attività completate."] },
    { title: "Riproduzioni", description: "Organizza cicli, covate, uova e piccoli in un unico flusso.", path: "/reproduction", steps: ["Crea un ciclo e collega gli animali riproduttori.", "Registra gli eventi riproduttivi e crea una covata quando necessario.", "Aggiorna uova, incubazione e piccoli mantenendo il collegamento con il ciclo."] },
    { title: "Inventario e documenti", description: "Tieni traccia di materiali e documenti associati all'allevamento.", path: "/inventory", steps: ["Inserisci gli articoli che vuoi monitorare nell'inventario.", "Aggiorna quantità e soglie quando cambia la disponibilità.", "Carica i documenti e collegali, se possibile, all'animale o al ciclo corretto."] },
    { title: "Registro economico", description: "Annota entrate e uscite per avere una visione più chiara dei costi.", path: "/finance", steps: ["Apri il registro economico.", "Registra una voce indicando importo, data e categoria.", "Usa i filtri per analizzare il periodo o la tipologia di movimento."] },
    { title: "Importazione ed esportazione", description: "Sposta i dati da o verso SnakeBee usando gli strumenti dedicati.", path: "/imports", steps: ["Prima di importare, controlla il formato e le colonne richieste.", "Esegui una prova su un file preparato e verifica i risultati.", "Esporta periodicamente una copia dei dati e conservala in un luogo sicuro."] }
  ],
  en: [
    { title: "Animals and profiles", description: "Create animal profiles and keep identity, origin, genetics and status together.", path: "/animals", steps: ["Open Animals and choose Add animal.", "Enter at least a name and species; you can complete the other fields later.", "Open the profile to review its history, weights, sheds and linked documents."] },
    { title: "Feedings and care", description: "Record each feeding and care event while keeping its history.", path: "/feeding", steps: ["Select one or more animals.", "Enter the date, food and outcome: ate, refused or not offered.", "Review the history to understand changes over time."] },
    { title: "Tasks and calendar", description: "Turn things to remember into tasks and reminders.", path: "/tasks", steps: ["Create a task with a title and due date.", "Link an animal when the task concerns one.", "Use the calendar to review due dates and mark tasks complete."] },
    { title: "Reproduction", description: "Organise cycles, clutches, eggs and offspring in one workflow.", path: "/reproduction", steps: ["Create a cycle and link the breeding animals.", "Record reproductive events and create a clutch when needed.", "Update eggs, incubation and offspring while keeping them linked to the cycle."] },
    { title: "Inventory and documents", description: "Track supplies and documents associated with your breeding activity.", path: "/inventory", steps: ["Add the items you want to track to inventory.", "Update quantities and thresholds when stock changes.", "Upload documents and link them to the relevant animal or cycle when possible."] },
    { title: "Financial register", description: "Record income and expenses to get a clearer view of costs.", path: "/finance", steps: ["Open the financial register.", "Add an entry with amount, date and category.", "Use filters to review a period or transaction type."] },
    { title: "Import and export", description: "Move data into or out of SnakeBee with the dedicated tools.", path: "/imports", steps: ["Before importing, check the required format and columns.", "Test with a prepared file and review the results.", "Export a copy of your data regularly and store it safely."] }
  ]
};
const faqs: Record<Locale, Array<{ q: string; a: string }>> = {
  it: [
    { q: "Da dove mi conviene iniziare?", a: "Aggiungi prima gli animali. Poi registra un'alimentazione e crea un'attività o un promemoria: così inizi a costruire uno storico utile senza dover compilare tutto subito." },
    { q: "Devo compilare tutti i campi di una scheda?", a: "No. Inserisci i dati che conosci e completa la scheda quando necessario. Evita di inventare valori: è meglio un campo vuoto che un dato non attendibile." },
    { q: "Qual è la differenza tra un'attività e un registro?", a: "Un'attività serve a ricordare qualcosa da fare, spesso con una scadenza. Un registro documenta qualcosa che è già successo, come un pasto, una pesata, una muta o un movimento economico." },
    { q: "Posso collegare un documento a un animale?", a: "Quando carichi un documento puoi associarlo all'animale o al ciclo pertinente, se il flusso lo prevede. In questo modo lo ritrovi anche dalla relativa scheda." },
    { q: "Cosa succede se archivio un animale?", a: "L'archiviazione serve a toglierlo dalla gestione ordinaria senza confonderlo con gli animali attivi. Consulta la scheda e lo storico prima di eliminarlo: archiviare ed eliminare non sono la stessa cosa." },
    { q: "I dati sono disponibili offline?", a: "La PWA può essere installata, ma la gestione dei dati richiede la connessione. Non considerare la cache del browser un backup e non fare affidamento sulla modifica offline o sulla sincronizzazione automatica." },
    { q: "Come posso spostare i dati da un foglio Excel?", a: "Usa la sezione Importazione e verifica prima il modello e le colonne supportate. Controlla sempre il riepilogo dell'importazione e conserva una copia originale del file." }
  ],
  en: [
    { q: "Where should I start?", a: "Add your animals first. Then record a feeding and create a task or reminder. This builds a useful history without requiring you to fill in everything at once." },
    { q: "Do I need to fill in every profile field?", a: "No. Enter the information you know and complete the profile later. Do not make up values: an empty field is better than unreliable data." },
    { q: "What is the difference between a task and a register?", a: "A task reminds you to do something, often by a due date. A register records something that already happened, such as a feeding, weighing, shed or financial transaction." },
    { q: "Can I link a document to an animal?", a: "When uploading a document, you can associate it with the relevant animal or cycle where that workflow is available. It can then be found from the related profile." },
    { q: "What happens when I archive an animal?", a: "Archiving removes it from everyday management without treating it as an active animal. Review its profile and history before deleting it: archiving and deleting are different actions." },
    { q: "Can I use my data offline?", a: "The PWA can be installed, but managing data requires a connection. Browser cache is not a backup; do not rely on offline editing or automatic synchronisation." },
    { q: "How can I move data from an Excel spreadsheet?", a: "Use Import and check the supported template and columns first. Always review the import summary and keep an original copy of your file." }
  ]
};
const records: Record<Locale, Array<{ name: string; purpose: string; examples: string }>> = {
  it: [
    { name: "Anagrafica animale", purpose: "Descrive chi è l'animale e raccoglie i suoi dati relativamente stabili.", examples: "Nome, specie, sesso, identificativo, provenienza, genetica e stato." },
    { name: "Registro alimentazioni", purpose: "Documenta i tentativi di alimentazione e il relativo esito.", examples: "Data, alimento, dimensione o peso e mangiato/rifiutato/non offerto." },
    { name: "Registro pesi", purpose: "Permette di osservare l'andamento del peso nel tempo.", examples: "Valore misurato e data della pesata. Usa sempre la stessa unità quando confronti i valori." },
    { name: "Registro mute", purpose: "Tiene traccia degli eventi di muta e delle relative osservazioni.", examples: "Data ed eventuali note sull'esito o su anomalie osservate." },
    { name: "Attività e promemoria", purpose: "Organizzano il lavoro futuro: non sostituiscono la registrazione dell'evento avvenuto.", examples: "Controlli, pulizie, visite, scadenze e attività ricorrenti." },
    { name: "Registri riproduttivi", purpose: "Collegano cicli, eventi, covate, uova, incubazione e piccoli.", examples: "Usa il ciclo come contenitore del percorso riproduttivo e aggiorna ogni fase quando avviene." },
    { name: "Registro economico", purpose: "Raccoglie movimenti economici per consultazioni e analisi.", examples: "Entrate e uscite con data, importo e categoria." }
  ],
  en: [
    { name: "Animal profile", purpose: "Describes the animal and stores its relatively stable information.", examples: "Name, species, sex, identifier, origin, genetics and status." },
    { name: "Feeding register", purpose: "Documents feeding attempts and their outcomes.", examples: "Date, food, size or weight, and ate/refused/not offered." },
    { name: "Weight register", purpose: "Helps you observe weight changes over time.", examples: "Measured value and weighing date. Use the same unit when comparing values." },
    { name: "Shedding register", purpose: "Tracks shedding events and related observations.", examples: "Date and optional notes about the result or anything unusual." },
    { name: "Tasks and reminders", purpose: "Organise future work; they do not replace recording an event that already happened.", examples: "Checks, cleaning, appointments, due dates and recurring tasks." },
    { name: "Reproduction registers", purpose: "Connect cycles, events, clutches, eggs, incubation and offspring.", examples: "Use the cycle to organise the breeding process and update each stage as it happens." },
    { name: "Financial register", purpose: "Collects financial movements for review and analysis.", examples: "Income and expenses with date, amount and category." }
  ]
};

export function HelpCenterPage({ locale, navigate }: { locale: Locale; navigate: (path: string) => void }) {
  const en = locale === "en";
  const text = en ? {
    eyebrow: "HELP CENTER", title: "How can we help?", description: "A practical guide to using SnakeBee, understanding your records and finding your way around.",
    guides: "Feature guides", guidesHint: "Choose a topic to see what it does and how to get started.", open: "Open section",
    faq: "Frequently asked questions", faqHint: "Answers to common questions about everyday use.",
    registers: "Understanding your records", registersHint: "Each register has a different purpose. Keeping tasks separate from completed events makes your history more reliable.",
    purpose: "What it is for", examples: "What to record", contact: "Need more help?", contactHint: "Write to our support team if you need help with your account or a feature. You can also visit the official website.",
    email: "Email support", website: "Visit SnakeBee website", quick: "Quick tip", quickText: "If you are unsure where to enter something, ask yourself: is it something I need to do, or something that has already happened? Use Tasks for the first and the relevant register for the second."
  } : {
    eyebrow: "CENTRO ASSISTENZA", title: "Come possiamo aiutarti?", description: "Una guida pratica per usare SnakeBee, capire i registri e orientarti tra le funzioni.",
    guides: "Guide alle funzionalità", guidesHint: "Scegli un argomento per capire a cosa serve e come iniziare.", open: "Apri sezione",
    faq: "Domande frequenti", faqHint: "Risposte ai dubbi più comuni nell'utilizzo quotidiano.",
    registers: "Capire i registri", registersHint: "Ogni registro ha uno scopo diverso. Separare le attività da fare dagli eventi già avvenuti rende lo storico più affidabile.",
    purpose: "A cosa serve", examples: "Cosa registrare", contact: "Ti serve altro aiuto?", contactHint: "Se non trovi qui la risposta, puoi scrivere direttamente al supporto oppure visitare il sito ufficiale.",
    email: "Scrivi all’assistenza", website: "Visita il sito SnakeBee", quick: "Un consiglio pratico", quickText: "Se non sai dove inserire un'informazione, chiediti: è qualcosa che devo ancora fare o qualcosa che è già successo? Usa Attività nel primo caso e il registro pertinente nel secondo."
  };
  return <div className="help-center-page">
    <PageHeader eyebrow={text.eyebrow} title={text.title} description={text.description} />
    <Panel>
      <div className="help-section-heading"><div><h2>{text.guides}</h2><p>{text.guidesHint}</p></div><Icon name="book" size={22} /></div>
      <div className="help-guide-grid">
        {guides[locale].map((guide, index) => <article className="help-guide-card" key={guide.path}>
          <span className="help-guide-number">{String(index + 1).padStart(2, "0")}</span>
          <h3>{guide.title}</h3><p>{guide.description}</p>
          <ol>{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol>
          <Button variant="secondary" size="sm" onClick={() => navigate(guide.path)}>{text.open}<Icon name="arrow" size={14} /></Button>
        </article>)}
      </div>
    </Panel>
    <Panel>
      <div className="help-section-heading"><div><h2>{text.faq}</h2><p>{text.faqHint}</p></div><Icon name="help" size={22} /></div>
      <div className="help-faq-list">{faqs[locale].map((item) => <details className="help-faq-item" key={item.q}>
        <summary>{item.q}<Icon name="chevron" size={16} /></summary><p>{item.a}</p>
      </details>)}</div>
    </Panel>
    <Panel>
      <div className="help-section-heading"><div><h2>{text.registers}</h2><p>{text.registersHint}</p></div><Icon name="file" size={22} /></div>
      <div className="help-record-list">{records[locale].map((record) => <article className="help-record" key={record.name}>
        <h3>{record.name}</h3><div><strong>{text.purpose}</strong><p>{record.purpose}</p></div><div><strong>{text.examples}</strong><p>{record.examples}</p></div>
      </article>)}</div>
      <div className="help-tip"><Icon name="lightbulb" size={19} /><div><strong>{text.quick}</strong><p>{text.quickText}</p></div></div>
    </Panel>
    <Panel className="help-contact-panel">
      <div className="help-contact-icon"><Icon name="message" size={24} /></div>
      <div><h2>{text.contact}</h2><p>{text.contactHint}</p><div className="inline-actions"><a className="btn btn-primary" href="mailto:support@snakebee.it">{text.email}<Icon name="arrow" size={14} /></a><a className="btn btn-secondary" href="https://snakebee.it/" target="_blank" rel="noreferrer">{text.website}<Icon name="external" size={14} /></a></div></div>
    </Panel>
  </div>;
}
