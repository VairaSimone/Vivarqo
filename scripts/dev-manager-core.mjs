const RULES = [
  { id: "env-invalid", pattern: /Invalid environment configuration:.*(?:SENTRY_DSN|METRICS_BEARER_TOKEN|EMAIL_FROM|DATABASE_URL|CSRF_SECRET)/i, title: "Configurazione ambiente non valida", advice: "Controlla la variabile indicata in .env. I campi opzionali vuoti vengono ignorati; correggi solo i valori non vuoti non validi. Non inserire segreti nei log.", classification: "likely-persistent" },
  { id: "vapid-incomplete", pattern: /configure VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT together|VAPID_(?:PUBLIC_KEY|PRIVATE_KEY|SUBJECT).*required/i, title: "Configurazione notifiche Push incompleta", advice: "Configura tutte e tre le variabili VAPID oppure lascia tutte e tre vuote. Non generare o sostituire chiavi senza una decisione esplicita.", classification: "likely-persistent" },
  { id: "pnpm-build-scripts", pattern: /Ignored build scripts|approve-builds/i, title: "Script di installazione pnpm bloccati", advice: "Il Manager autorizza solo i pacchetti presenti in onlyBuiltDependencies. Per pacchetti nuovi e non riconosciuti, verifica la provenienza e poi usa pnpm approve-builds manualmente.", classification: "needs-review" },
  { id: "docker-port-binding", pattern: /ports are not available|failed to bind host port|driver failed programming external connectivity|listen tcp.*bind:|EADDRINUSE|address already in use/i, title: "Porta PostgreSQL già occupata", advice: "Il Manager seleziona una porta host libera per PostgreSQL Docker e aggiorna .env senza terminare il processo che occupa la porta originale. Se il conflitto persiste, controlla il processo proprietario.", classification: "auto-repairable" },
  { id: "db-connection", pattern: /ECONNREFUSED|P1001|database.*(unavailable|does not exist)|connection terminated/i, title: "Database non raggiungibile", advice: "Verifica PostgreSQL, Docker e DATABASE_URL. Il Manager tenta prima il recupero del container e poi ripete il controllo.", classification: "transient" },
  { id: "network-transient", pattern: /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|socket hang up|fetch failed|network error|HTTP (502|503|504)/i, title: "Errore di rete temporaneo", advice: "Controlla la connettività e ripeti il controllo. Non considerarlo un guasto permanente dopo un singolo evento.", classification: "transient" },
  { id: "port-in-use", pattern: /EADDRINUSE|address already in use/i, title: "Porta già occupata", advice: "Individua il processo che usa la porta. Non terminare automaticamente servizi esterni o database già installati.", classification: "needs-review" },
  { id: "missing-env", pattern: /Missing environment variable|Environment variable .* not found|CSRF_SECRET/i, title: "Configurazione ambiente incompleta", advice: "Confronta .env con .env.example. In sviluppo il Manager può generare CSRF_SECRET solo se manca; non copiare segreti di produzione.", classification: "likely-persistent" },
  { id: "migration", pattern: /migration.*(failed|error)|P3009|P3018|schema.*drift/i, title: "Problema di migrazione database", advice: "Controlla lo stato delle migrazioni prima di applicare modifiche manuali. Non eliminare volumi o dati per tentare un recupero.", classification: "likely-persistent" },
  { id: "dependency", pattern: /ERR_MODULE_NOT_FOUND|Cannot find package|MODULE_NOT_FOUND|command not found|tsx.*not found/i, title: "Dipendenza mancante", advice: "Esegui pnpm install --frozen-lockfile e verifica Node.js/pnpm. Controlla prima gli errori precedenti: un errore di configurazione può generare messaggi secondari fuorvianti.", classification: "likely-persistent" },
  { id: "memory", pattern: /heap out of memory|ENOMEM|JavaScript heap out of memory/i, title: "Memoria esaurita", advice: "Controlla consumo RAM e carico. Prima di aumentare i limiti, identifica eventuali perdite o picchi.", classification: "needs-review" },
  { id: "permission", pattern: /EACCES|EPERM|permission denied|access is denied/i, title: "Permessi insufficienti", advice: "Controlla i permessi sulla cartella e sui file coinvolti; evita di eseguire tutto come amministratore.", classification: "likely-persistent" },
  { id: "shell-deprecation", pattern: /DEP0190|shell option true/i, title: "Avvio processi Windows deprecato", advice: "Aggiorna il launcher per avviare pnpm tramite cmd.exe esplicito con shell disabilitata.", classification: "auto-repairable" },
  { id: "unknown", pattern: /.*/, title: "Errore da verificare", advice: "Errore non classificato: controlla il contesto nei log prima di attribuire una causa.", classification: "needs-review" }
];

export function diagnose(message) {
  const text = String(message || "").slice(0, 4000);
  const rule = RULES.find(item => item.pattern.test(text)) || RULES[RULES.length - 1];
  const signature = text.toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, "<uuid>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/\s+/g, " ").trim().slice(0, 220);
  return {
    id: rule.id, title: rule.title, advice: rule.advice,
    classification: rule.classification,
    signature: rule.id + ":" + signature
  };
}


export function primaryErrorMessage(message) {
  const text = String(message || "").slice(0, 20_000);
  const priorities = [
    /Invalid environment configuration:[^\r\n]*/i,
    /Invalid (?:development|staging|production) environment:[^\r\n]*/i,
    /ports are not available:[^\r\n]*/i,
    /Error response from daemon:[^\r\n]*/i,
    /Ignored build scripts:[^\r\n]*/i,
    /(?:spawn .+ ENOENT|ERR_MODULE_NOT_FOUND|Cannot find package)[^\r\n]*/i
  ];
  for (const pattern of priorities) {
    const match = text.match(pattern);
    if (match) return match[0].trim();
  }
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const firstError = lines.find(line => /^(?:Error:|TypeError:|ReferenceError:|SyntaxError:)|\bFATAL\b|\bERR_[A-Z_]+\b/i.test(line));
  return (firstError || lines.at(-1) || "Errore sconosciuto").slice(0, 4000);
}

export function summarizeDiagnostics(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const item = diagnose(entry.message);
    const current = grouped.get(item.signature) || {
      ...item, count: 0, services: new Set(), firstSeen: entry.timestamp,
      lastSeen: entry.timestamp
    };
    current.count += 1;
    current.services.add(entry.service || "manager");
    current.lastSeen = entry.timestamp || current.lastSeen;
    grouped.set(item.signature, current);
  }
  return [...grouped.values()].map(item => {
    const firstAt = Date.parse(item.firstSeen || "");
    const lastAt = Date.parse(item.lastSeen || "");
    const recentBurst = Number.isFinite(firstAt) && Number.isFinite(lastAt) &&
      lastAt >= firstAt && lastAt - firstAt <= 5 * 60 * 1000;
    const persistent = item.classification === "likely-persistent" && item.count >= 3 && recentBurst;
    const repeatedTransient = item.classification === "transient" && item.count >= 5 && recentBurst;
    return {
      ...item,
      classification: persistent ? "persistent" :
        repeatedTransient ? "repeated-transient" : item.classification,
      confidence: persistent || repeatedTransient ? "medium" : "low",
      requiresIntervention: persistent,
      services: [...item.services]
    };
  }).sort((a, b) => b.count - a.count);
}
