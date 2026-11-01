import React from "react";
import { getIntlLocale, t } from "../i18n";
import type { AnyRecord, NavigationHandler } from "../types";
import { Icon } from "../ui/Icon";

const value = (obj: AnyRecord | null | undefined, keys: string[], fallback = "—") => {
  for (const key of keys) {
    if (obj?.[key] !== undefined && obj?.[key] !== null && obj?.[key] !== "") return obj[key];
  }
  return fallback;
};
const date = (value: string | number | Date | null | undefined) => {
  if (!value || value === "—") return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat(getIntlLocale(), { dateStyle: "medium" }).format(parsed);
};
const money = (amount: string | number | null | undefined) => {
  if (amount === null || amount === undefined || amount === "" || amount === "—") return "—";
  const parsed = Number(amount);
  return Number.isFinite(parsed) ? new Intl.NumberFormat(getIntlLocale(), { style: "currency", currency: "EUR" }).format(parsed / 100) : "—";
};
function Button({ children, variant = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) {
  return <button className={"button " + variant} {...props}>{children}</button>;
}

type RecordHubProps = {
  active: string; data: AnyRecord; rows: AnyRecord[]; query: string; onSearch: (query: string) => void;
  onCare?: (type: string) => void; onReload?: () => void;
  onTask?: (row: AnyRecord, status: string) => void; onGo?: NavigationHandler;
  onEdit?: (row: AnyRecord) => void; onDelete?: (row: AnyRecord) => void;
  onMovement?: (row: AnyRecord) => void; onHistory?: (row: AnyRecord) => void;
  onPageChange?: (page: number) => void;
};

const TITLES: Record<string, string> = {
  animali: "Schede animali",
  inventario: "Scorte e materiali",
  alimentazioni: "Storico alimentazioni",
  attivita: "Attività e promemoria",
  finanze: "Entrate e uscite",
  notifiche: "Centro notifiche",
  riproduzioni: "Riproduzioni",
  documenti: "Documenti e condivisioni",
  genetica: "Morph e genetica",
  peso: "Storico pesi",
  mute: "Storico mute",
  note: "Osservazioni"
};

const STATUS_LABELS: Record<string, string> = {
  active: "Attivo",
  archived: "Archiviato",
  inactive: "Archiviato",
  sold: "Venduto",
  transferred: "Trasferito",
  deceased: "Deceduto",
  planned: "Pianificato",
  in_progress: "In corso",
  completed: "Completato",
  cancelled: "Annullato",
  canceled: "Annullato",
  overdue: "In ritardo",
  read: "Letta",
  unread: "Non letta"
};
const OUTCOME_LABELS: Record<string, string> = {
  ate: "Ha mangiato",
  refused: "Ha rifiutato",
  not_offered: "Non offerto",
  unknown: "Non noto"
};
const SEX_LABELS: Record<string, string> = {
  female: "Femmina",
  male: "Maschio",
  unknown: "Non specificato"
};

function displayValue(label: string, raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "—";
  const text = String(raw);
  if (label === "Stato") return t(STATUS_LABELS[text.toLowerCase()] ?? text);
  if (label === "Esito") return t(OUTCOME_LABELS[text.toLowerCase()] ?? text);
  if (label === "Sesso") return t(SEX_LABELS[text.toLowerCase()] ?? text);
  if (label === "Scorte") return t(text);
  return text;
}

export function Records({
  active, data, rows, onSearch, query, onCare, onReload, onTask, onGo, onEdit, onDelete,
  onMovement, onHistory, onPageChange
}: RecordHubProps) {
  const shown = rows.map(raw => {
    let display: Record<string, unknown>;
    if (active === "animali") {
      display = {
        Nome: value(raw, ["name"]),
        Identificativo: value(raw, ["identifier"]),
        Specie: value(raw, ["species"]),
        Sesso: value(raw, ["sex"]),
        Morph: value(raw, ["morph"]),
        Stabulazione: value(raw, ["locationLabel"]),
        Stato: value(raw, ["status"])
      };
    } else if (active === "inventario") {
      display = {
        Articolo: value(raw, ["name"]),
        Categoria: value(raw, ["category"]),
        Quantità: value(raw, ["quantityOnHand"]),
        Unità: value(raw, ["unit"]),
        Soglia: value(raw, ["minimumQuantity"]),
        Stato: raw.isActive === false ? "Archiviato" : "Attivo",
        Scorte: raw.minimumQuantity == null
          ? "Soglia non impostata"
          : Number(raw.quantityOnHand) <= Number(raw.minimumQuantity) ? "Sotto soglia" : "Adeguate"
      };
    } else if (active === "alimentazioni") {
      display = {
        Data: date(value(raw, ["performedAt", "fedAt", "createdAt"])),
        Animale: value(raw, ["animalName", "animalId"]),
        Esito: value(raw, ["outcome"]),
        Cibo: value(raw, ["foodType"]),
        Note: value(raw, ["notes"])
      };
    } else if (active === "attivita") {
      display = {
        Attività: value(raw, ["title", "name"]),
        Scadenza: date(value(raw, ["dueAt"])),
        Categoria: value(raw, ["category"]),
        Stato: value(raw, ["status"]),
        Descrizione: value(raw, ["description"])
      };
    } else if (active === "finanze") {
      display = {
        Descrizione: value(raw, ["description"]),
        Tipo: value(raw, ["entryType"]),
        Data: date(value(raw, ["occurredOn"])),
        Importo: money(value(raw, ["amountCents"])),
        Categoria: value(raw, ["category"])
      };
    } else if (active === "notifiche") {
      display = {
        Titolo: value(raw, ["title"]),
        Messaggio: value(raw, ["body"]),
        Data: date(value(raw, ["createdAt"])),
        Stato: raw.readAt ? "Letta" : "Non letta"
      };
    } else {
      display = Object.fromEntries(
        Object.entries(raw)
          .filter(([key, item]) => !["userId", "updatedAt", "createdAt", "id"].includes(key) && ["string", "number", "boolean"].includes(typeof item))
          .slice(0, 6)
          .map(([key, item]) => [key.replace(/([A-Z])/g, " $1"), String(item)])
      );
    }
    return { raw, display };
  });

  const rowActions = (raw: AnyRecord) => <div className="inline-actions record-actions">
    {onEdit && <Button onClick={() => onEdit(raw)}><Icon name="edit" size={14}/> {t("Modifica")}</Button>}
    {active === "attivita" && onTask && <Button onClick={() => onTask(raw, "complete")}><Icon name="check" size={14}/> {t("Completa")}</Button>}
    {active === "inventario" && onHistory && <Button onClick={() => onHistory(raw)}>{t("Storico")}</Button>}
    {active === "inventario" && onMovement && <Button onClick={() => onMovement(raw)}>{t("Movimento")}</Button>}
    {onDelete && <Button variant="danger" onClick={() => onDelete(raw)}>
      <Icon name={active === "inventario" ? "archive" : "trash"} size={14}/>
      {active === "inventario" ? t("Archivia") : t("Elimina")}
    </Button>}
  </div>;

  return <section className="panel records-panel">
    <div className="panel-heading">
      <div>
        <p className="eyebrow">{t("DATI DEL TUO ACCOUNT")}</p>
        <h2>{t(TITLES[active] || active)}</h2>
        <p className="subheading">{t("Dati reali del tuo allevamento, ordinati per una consultazione rapida.")}</p>
      </div>
      <Button variant="secondary" onClick={onReload}><Icon name="refresh" size={15}/> {t("Aggiorna")}</Button>
    </div>

    {["animali", "inventario", "alimentazioni", "attivita", "finanze"].includes(active) && (
      <input className="search-input" type="search" placeholder={t("Cerca nei record…")} value={query}
        onChange={event => onSearch(event.target.value)} aria-label={t("Cerca nei risultati")}/>
    )}

    {shown.length === 0
      ? <div className="empty-state">
        <span><Icon name="search" size={25}/></span>
        <h3>{t("Nessun dato trovato")}</h3>
        <p>{t("Prova a modificare la ricerca oppure crea una nuova registrazione nella sezione dedicata.")}</p>
      </div>
      : <>
        <div className="table-wrap">
          <table>
            <thead><tr>{Object.keys(shown[0].display).map(key => <th key={key}>{t(key)}</th>)}<th>{t("Azioni")}</th></tr></thead>
            <tbody>{shown.map(({raw, display}, index) => (
              <tr key={raw.id || index}>
                {Object.entries(display).map(([key, item]) => <td key={key}>{displayValue(key, item)}</td>)}
                <td>{rowActions(raw)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="record-mobile-list">
          {shown.map(({raw, display}, index) => {
            const entries = Object.entries(display);
            const [, mainValue] = entries[0] || ["Record", "Record"];
            return <article className="record-mobile-card" key={raw.id || index}>
              <header>
                <strong>{displayValue(entries[0]?.[0] || "Record", mainValue)}</strong>
                {display.Stato !== undefined && <span className={"pill " + (/active|attivo|sufficient|adeguate|read|letta/i.test(displayValue("Stato", display.Stato)) ? "sage" : "")}>
                  {displayValue("Stato", display.Stato)}
                </span>}
              </header>
              <dl>
                {entries.slice(1).filter(([label]) => label !== "Stato").map(([label, item]) => (
                  <div key={label}><dt>{t(label)}</dt><dd>{displayValue(label, item)}</dd></div>
                ))}
              </dl>
              {rowActions(raw)}
            </article>;
          })}
        </div>
      </>}

    {data?.pagination && <div className="pagination-bar">
      <span className="muted">{t("Pagina")} {data.pagination.page || 1} {t("di")} {Math.max(1, data.pagination.totalPages || 1)} · {data.pagination.total ?? shown.length} {t("risultati")}</span>
      <div className="inline-actions">
        <Button disabled={(data.pagination.page || 1) <= 1} onClick={() => onPageChange?.(Math.max(1, (data.pagination.page || 1) - 1))}>
          <Icon name="back" size={14}/> {t("Precedente")}
        </Button>
        <Button disabled={(data.pagination.page || 1) >= (data.pagination.totalPages || 1)} onClick={() => onPageChange?.((data.pagination.page || 1) + 1)}>
          {t("Successiva")} <Icon name="next" size={14}/>
        </Button>
      </div>
    </div>}
  </section>;
}
