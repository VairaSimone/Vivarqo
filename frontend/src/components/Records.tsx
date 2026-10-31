import React from "react";
import { getIntlLocale } from "../i18n";
import type { AnyRecord, NavigationHandler } from "../types";
import { Icon } from "../ui/Icon";

const value = (obj: AnyRecord | null | undefined, keys: string[], fallback = "—") => { for (const key of keys) if (obj?.[key] !== undefined && obj?.[key] !== null && obj?.[key] !== "") return obj[key]; return fallback; };
const date = (value: string | number | Date | null | undefined) => { if (!value || value === "—") return "—"; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat(getIntlLocale(), { dateStyle: "medium" }).format(parsed); };
const money = (amount: string | number | null | undefined) => { if (amount === null || amount === undefined || amount === "" || amount === "—") return "—"; const parsed = Number(amount); return Number.isFinite(parsed) ? new Intl.NumberFormat(getIntlLocale(), { style: "currency", currency: "EUR" }).format(parsed / 100) : "—"; };
function Button({ children, variant = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) { return <button className={"button " + variant} {...props}>{children}</button>; }

type RecordHubProps = {
 active: string; data: AnyRecord; rows: AnyRecord[]; query: string; onSearch: (query: string) => void;
 onCare?: (type: string) => void; onReload?: () => void;
 onTask?: (row: AnyRecord, status: string) => void; onGo?: NavigationHandler;
 onEdit?: (row: AnyRecord) => void; onDelete?: (row: AnyRecord) => void;
 onMovement?: (row: AnyRecord) => void; onHistory?: (row: AnyRecord) => void;
 onPageChange?: (page: number) => void;
};
export function Records({active,data,rows,onSearch,query,onCare,onReload,onTask,onGo,onEdit,onDelete,onMovement,onHistory,onPageChange}: RecordHubProps) {
 const titles: Record<string,string> = {animali:"Schede animali",inventario:"Scorte e materiali",alimentazioni:"Storico alimentazioni",attivita:"Attività e promemoria",finanze:"Entrate e uscite",notifiche:"Centro notifiche",riproduzioni:"Riproduzioni",documenti:"Documenti e condivisioni",genetica:"Morph e genetica",peso:"Storico pesi",mute:"Storico mute",note:"Osservazioni"};
 const shown=rows.map(r=>({raw:r,display:active==="animali"?{Nome:value(r,["name"]),Identificativo:value(r,["identifier"]),Specie:value(r,["species"]),Sesso:value(r,["sex"]),Morph:value(r,["morph"]),Stabulazione:value(r,["locationLabel"]),Stato:value(r,["status"])}:active==="inventario"?{Articolo:value(r,["name"]),Categoria:value(r,["category"]),Quantità:value(r,["quantityOnHand"]),Unità:value(r,["unit"]),Soglia:value(r,["minimumQuantity"]),Stato:r.isActive===false?"Archiviato":"Attivo",Scorte:r.minimumQuantity==null?"Soglia non impostata":Number(r.quantityOnHand)<=Number(r.minimumQuantity)?"Sotto soglia":"Adeguate"}:active==="alimentazioni"?{Data:date(value(r,["performedAt","fedAt","createdAt"])),Animale:value(r,["animalName","animalId"]),Esito:value(r,["outcome"]),Cibo:value(r,["foodType"]),Note:value(r,["notes"])}:active==="attivita"?{Attività:value(r,["title","name"]),Scadenza:date(value(r,["dueAt"])),Categoria:value(r,["category"]),Stato:value(r,["status"]),Descrizione:value(r,["description"])}:active==="finanze"?{Descrizione:value(r,["description"]),Tipo:value(r,["entryType"]),Data:date(value(r,["occurredOn"])),Importo:money(value(r,["amountCents"])),Categoria:value(r,["category"])}:active==="notifiche"?{Titolo:value(r,["title"]),Messaggio:value(r,["body"]),Data:date(value(r,["createdAt"])),Stato:r.readAt?"Letta":"Non letta"}:Object.fromEntries(Object.entries(r).filter(([k,v])=>!["userId","updatedAt","createdAt","id"].includes(k)&&["string","number","boolean"].includes(typeof v)).slice(0,6).map(([k,v])=>[k.replace(/([A-Z])/g," $1"),String(v)]))}));
 const rowActions=(raw:AnyRecord)=><div className="inline-actions record-actions">
   {onEdit&&<Button onClick={()=>onEdit(raw)}><Icon name="edit" size={14}/> Modifica</Button>}
   {active==="attivita"&&onTask&&<Button onClick={()=>onTask(raw,"complete")}><Icon name="check" size={14}/> Completa</Button>}
   {active==="inventario"&&onHistory&&<Button onClick={()=>onHistory(raw)}>Storico</Button>}
   {active==="inventario"&&onMovement&&<Button onClick={()=>onMovement(raw)}>Movimento</Button>}
   {onDelete&&<Button variant="danger" onClick={()=>onDelete(raw)}><Icon name={active==="inventario"?"archive":"trash"} size={14}/>{active==="inventario"?"Archivia":"Elimina"}</Button>}
  </div>;
 return <section className="panel records-panel">
  <div className="panel-heading"><div><p className="eyebrow">DATI DEL TUO ACCOUNT</p><h2>{titles[active]||active}</h2><p className="subheading">Dati reali del tuo allevamento, ordinati per una consultazione rapida.</p></div><Button variant="secondary" onClick={onReload}><Icon name="refresh" size={15}/> Aggiorna</Button></div>
  {["animali","inventario","alimentazioni","attivita","finanze"].includes(active)&&<input className="search-input" type="search" placeholder="Cerca nei record…" value={query} onChange={e=>onSearch(e.target.value)} aria-label="Cerca nei risultati"/>}
  {shown.length===0?<div className="empty-state"><span><Icon name="search" size={25}/></span><h3>Nessun dato trovato</h3><p>Prova a modificare la ricerca oppure crea una nuova registrazione nella sezione dedicata.</p></div>:<>
   <div className="table-wrap"><table><thead><tr>{Object.keys(shown[0].display).map(k=><th key={k}>{k}</th>)}<th>Azioni</th></tr></thead><tbody>{shown.map(({raw,display},i)=><tr key={raw.id||i}>{Object.entries(display).map(([k,v])=><td key={k}>{String(v)}</td>)}<td>{rowActions(raw)}</td></tr>)}</tbody></table></div>
   <div className="record-mobile-list">{shown.map(({raw,display},i)=>{const entries=Object.entries(display);const [mainLabel,mainValue]=entries[0]||["Record","Record"];return <article className="record-mobile-card" key={raw.id||i}>
     <header><strong>{String(mainValue)}</strong>{display.Stato&&<span className={"pill "+(/attivo|adeguate|letta/i.test(String(display.Stato))?"sage":"")}>{String(display.Stato)}</span>}</header>
     <dl>{entries.slice(1).filter(([label])=>label!=="Stato").map(([label,value])=><div key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>)}</dl>
     {rowActions(raw)}
   </article>;})}</div>
  </>}
  {data?.pagination&&<div className="pagination-bar"><span className="muted">Pagina {data.pagination.page||1} di {Math.max(1,data.pagination.totalPages||1)} · {data.pagination.total??shown.length} risultati</span><div className="inline-actions"><Button disabled={(data.pagination.page||1)<=1} onClick={()=>onPageChange?.(Math.max(1,(data.pagination.page||1)-1))}><Icon name="back" size={14}/> Precedente</Button><Button disabled={(data.pagination.page||1)>=(data.pagination.totalPages||1)} onClick={()=>onPageChange?.((data.pagination.page||1)+1)}>Successiva <Icon name="next" size={14}/></Button></div></div>}
 </section>;
}
