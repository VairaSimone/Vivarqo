export const NAV = [
  ["oggi","Oggi","home","Panoramica e attività in scadenza"],
  ["animali","Animali","animals","Anagrafica e schede individuali"],
  ["alimentazioni","Alimentazioni","feeding","Sessioni e storico dei pasti"],
  ["cure","Peso, mute e note","care","Registri di cura e osservazioni"],
  ["attivita","Attività e calendario","calendar","Promemoria, attività e scadenze"],
  ["riproduzioni","Riproduzioni","reproduction","Cicli, covate, uova e piccoli"],
  ["inventario","Inventario","inventory","Scorte, movimenti e soglie"],
  ["documenti","Documenti e QR","documents","Documenti e condivisioni pubbliche"],
  ["genetica","Morph e genetica","genetics","Tratti genetici e storico"],
  ["finanze","Registro economico","finance","Entrate e uscite gestionali"],
  ["notifiche","Notifiche","notifications","Avvisi e preferenze push"],
  ["dati","Importa ed esporta","data","Portabilità dei tuoi dati"],
  ["abbonamento","Abbonamento","billing","Stato e gestione del piano"],
  ["guide","Guide e tutorial","guide","Guide dettagliate sito e PWA"],
  ["impostazioni","Impostazioni","settings","Profilo, lingua e sicurezza"]
];

export const NAV_GROUPS = [
  { id: "quotidianita", label: "Quotidianità", items: ["oggi", "animali", "alimentazioni", "cure", "attivita"] },
  { id: "allevamento", label: "Allevamento", items: ["riproduzioni", "genetica", "documenti"] },
  { id: "gestione", label: "Gestione", items: ["inventario", "finanze"] },
  { id: "account", label: "Account", items: ["notifiche", "dati", "abbonamento", "impostazioni", "guide"] }
];

export const NAV_PRIMARY = ["oggi", "animali", "alimentazioni", "attivita"];
export const NAV_MORE_GROUPS = NAV_GROUPS
  .map(group => ({ ...group, items: group.items.filter(id => !NAV_PRIMARY.includes(id)) }))
  .filter(group => group.items.length > 0);

export const API: Record<string, string> = {
  oggi: "home/today",
  animali: "animals?page=1&pageSize=50",
  alimentazioni: "feeding-sessions?page=1&pageSize=50",
  peso: "weights?page=1&pageSize=50",
  mute: "sheds?page=1&pageSize=50",
  note: "notes?page=1&pageSize=50",
  attivita: "tasks?page=1&pageSize=50",
  riproduzioni: "reproduction-cycles?page=1&pageSize=100",
  inventario: "inventory/items?page=1&pageSize=50",
  documenti: "documents?page=1&pageSize=50",
  genetica: "genetic-traits",
  finanze: "finance/entries?page=1&pageSize=50",
  notifiche: "notifications?page=1&pageSize=50",
  abbonamento: "billing/subscription"
};

export const TITLES: Record<string, string> = Object.fromEntries([
  ...NAV.map(([id, label]) => [id, label]),
  ["peso", "Peso"], ["mute", "Mute"], ["note", "Note"], ["altro", "Altro"]
]);

export const DESCRIPTIONS: Record<string, string> = Object.fromEntries([
  ...NAV.map(([id, label, icon, description]) => [id, description]),
  ["peso", "Registra e consulta le pesate degli animali."],
  ["mute", "Annota le mute e il loro esito."],
  ["note", "Consulta e aggiungi osservazioni alle schede."]
]);

export const SECTION_PATHS: Record<string, string> = {
  oggi: "/",
  animali: "/animals",
  alimentazioni: "/feeding",
  cure: "/care",
  peso: "/care/weights",
  mute: "/care/sheds",
  note: "/care/notes",
  attivita: "/calendar",
  riproduzioni: "/reproduction",
  inventario: "/inventory",
  documenti: "/documents",
  genetica: "/genetics",
  finanze: "/finances",
  notifiche: "/notifications",
  dati: "/data",
  abbonamento: "/billing",
  guide: "/guide",
  impostazioni: "/settings",
  altro: "/more"
};

export function initialSectionFromPath(pathname: string): string {
  let path = String(pathname || "/");
  while (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (/^\/tasks(?:\/[^/]+)?$/.test(path)) return "attivita";
  if (path.startsWith("/animals/")) return "animali";
  if (path === "/settings/notifications" || path === "/notifications") return "notifiche";
  const routes: Record<string, string> = {
    "/": "oggi",
    "/animals": "animali",
    "/feeding": "alimentazioni",
    "/care": "cure",
    "/care/weights": "peso",
    "/care/sheds": "mute",
    "/care/notes": "note",
    "/calendar": "attivita",
    "/tasks": "attivita",
    "/reproduction": "riproduzioni",
    "/inventory": "inventario",
    "/documents": "documenti",
    "/genetics": "genetica",
    "/finances": "finanze",
    "/data": "dati",
    "/billing": "abbonamento",
    "/guide": "guide",
    "/settings": "impostazioni",
    "/more": "altro"
  };
  return routes[path] || "oggi";
}

export function animalIdFromLocation(): string | null {
  const queryId = new URLSearchParams(window.location.search).get("animal");
  if (queryId) return queryId;
  const match = window.location.pathname.match(/^\/animals\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}
