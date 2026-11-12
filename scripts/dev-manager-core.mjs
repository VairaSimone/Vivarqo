const RULES = [
  { id: "db-connection", pattern: /ECONNREFUSED|P1001|database.*(unavailable|does not exist)|connection terminated/i, title: "Database non raggiungibile", advice: "Verifica PostgreSQL, Docker e DATABASE_URL.", classification: "transient" },
  { id: "network-transient", pattern: /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|socket hang up|fetch failed|network error|HTTP (502|503|504)/i, title: "Errore di rete temporaneo", advice: "Controlla la connettività e ripeti il controllo. Non considerarlo un guasto permanente dopo un singolo evento.", classification: "transient" },
  { id: "port-in-use", pattern: /EADDRINUSE|address already in use/i, title: "Porta già occupata", advice: "Individua il processo che usa la porta e verifica che non sia già attiva un'altra istanza.", classification: "needs-review" },
  { id: "missing-env", pattern: /Missing environment variable|Environment variable .* not found|CSRF_SECRET/i, title: "Configurazione ambiente incompleta", advice: "Confronta .env con .env.example. Non copiare segreti di produzione nell'ambiente locale.", classification: "likely-persistent" },
  { id: "migration", pattern: /migration.*(failed|error)|P3009|P3018|schema.*drift/i, title: "Problema di migrazione database", advice: "Controlla lo stato delle migrazioni prima di applicare modifiche manuali.", classification: "likely-persistent" },
  { id: "dependency", pattern: /ERR_MODULE_NOT_FOUND|Cannot find package|MODULE_NOT_FOUND|command not found/i, title: "Dipendenza mancante", advice: "Esegui pnpm install --frozen-lockfile e verifica Node.js/pnpm.", classification: "likely-persistent" },
  { id: "memory", pattern: /heap out of memory|ENOMEM|JavaScript heap out of memory/i, title: "Memoria esaurita", advice: "Controlla consumo RAM e carico. Prima di aumentare i limiti, identifica eventuali perdite o picchi.", classification: "needs-review" },
  { id: "permission", pattern: /EACCES|EPERM|permission denied|access is denied/i, title: "Permessi insufficienti", advice: "Controlla i permessi sulla cartella e sui file coinvolti; evita di eseguire tutto come amministratore.", classification: "likely-persistent" },
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
