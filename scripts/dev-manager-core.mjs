const RULES = [
  { id: "db-connection", pattern: /ECONNREFUSED|P1001|database.*(unavailable|does not exist)|connection terminated/i, title: "Database non raggiungibile", advice: "Verifica che Docker Desktop sia avviato e che PostgreSQL risulti healthy. Controlla DATABASE_URL e la porta 5432." },
  { id: "port-in-use", pattern: /EADDRINUSE|address already in use/i, title: "Porta già occupata", advice: "Individua il processo che usa la porta del servizio e arrestalo, oppure configura una porta libera." },
  { id: "missing-env", pattern: /Missing environment variable|Environment variable .* not found|CSRF_SECRET/i, title: "Configurazione ambiente incompleta", advice: "Confronta .env con .env.example. Non copiare segreti di produzione nell'ambiente locale." },
  { id: "migration", pattern: /migration.*(failed|error)|P3009|P3018|schema.*drift/i, title: "Problema di migrazione database", advice: "Leggi il dettaglio della migrazione prima di intervenire. Non cancellare il volume PostgreSQL: contiene i dati locali." },
  { id: "dependency", pattern: /ERR_MODULE_NOT_FOUND|Cannot find module|command not found|is not recognized/i, title: "Dipendenza o comando mancante", advice: "Esegui pnpm install --frozen-lockfile dalla root e verifica Node.js/pnpm richiesti dal repository." },
  { id: "memory", pattern: /heap out of memory|JavaScript heap out of memory|ENOMEM/i, title: "Memoria esaurita", advice: "Controlla processi e consumo RAM. Evita di aumentare il limite heap senza prima identificare la perdita o il carico anomalo." },
  { id: "permission", pattern: /EACCES|EPERM|permission denied|access is denied/i, title: "Permessi insufficienti", advice: "Controlla i permessi sulla cartella e sui file coinvolti. Evita di eseguire tutto come amministratore come workaround permanente." },
  { id: "unknown", pattern: /.*/, title: "Errore non classificato", advice: "Apri i log completi del servizio e cerca la prima eccezione, non soltanto l'ultima riga. Esporta il report diagnostico per analizzarlo." }
];

export function diagnose(message) {
  const text = String(message || "").slice(0, 4000);
  const rule = RULES.find(item => item.pattern.test(text)) || RULES[RULES.length - 1];
  const signature = text.toLowerCase().replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, "<uuid>").replace(/\b\d+\b/g, "<n>").replace(/\s+/g, " ").trim().slice(0, 220);
  return { id: rule.id, title: rule.title, advice: rule.advice, signature: rule.id + ":" + signature };
}

export function summarizeDiagnostics(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const item = diagnose(entry.message);
    const current = grouped.get(item.signature) || { ...item, count: 0, services: new Set(), lastSeen: entry.timestamp };
    current.count += 1;
    current.services.add(entry.service || "manager");
    current.lastSeen = entry.timestamp || current.lastSeen;
    grouped.set(item.signature, current);
  }
  return [...grouped.values()].map(item => ({ ...item, services: [...item.services] })).sort((a, b) => b.count - a.count);
}
