import React, { useEffect, useState } from "react";
import { getIntlLocale } from "../i18n";
import type { AnyRecord, NavigationHandler } from "../types";
import { apiRequest } from "../api/api";
import { Icon } from "../ui/Icon";

const asArray = (data: unknown): AnyRecord[] => Array.isArray(data) ? data as AnyRecord[] : data && typeof data === "object" ? Object.values(data as AnyRecord).find(Array.isArray) as AnyRecord[] ?? [] : [];
const value = (obj: AnyRecord | null | undefined, keys: string[], fallback = "—") => { for (const key of keys) if (obj?.[key] !== undefined && obj?.[key] !== null && obj?.[key] !== "") return obj[key]; return fallback; };
const date = (value: string | number | Date | null | undefined) => { if (!value || value === "—") return "—"; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat(getIntlLocale(), { dateStyle: "medium" }).format(parsed); };
function Button({ children, variant = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) { return <button className={"button " + variant} {...props}>{children}</button>; }

export function Dashboard({data,onGo,onRetry}: { data: AnyRecord; onGo: NavigationHandler; onRetry?: () => void }) {
 const due=asArray(data?.tasks?.dueToday??data?.dueToday);
 const overdue=asArray(data?.tasks?.overdue??data?.overdue);
 const [operational,setOperational]=useState<{stock:AnyRecord[];cycles:AnyRecord[];feeds:AnyRecord[];animalCount:number|null;stockLoaded:boolean;cyclesLoaded:boolean;feedsLoaded:boolean;animalsLoaded:boolean}>({stock:[],cycles:[],feeds:[],animalCount:null,stockLoaded:false,cyclesLoaded:false,feedsLoaded:false,animalsLoaded:false});
 useEffect(()=>{
  let live=true;
  Promise.allSettled([
   apiRequest("inventory/items?page=1&pageSize=8&active=true&lowStock=true"),
   apiRequest("reproduction-cycles?page=1&pageSize=8"),
   apiRequest("feeding-sessions?page=1&pageSize=5"),
   apiRequest("animals?page=1&pageSize=1&status=all")
  ]).then(([stockResult,cyclesResult,feedsResult,animalsResult])=>{
   if(!live)return;
   const inventory=stockResult.status==="fulfilled"?asArray(stockResult.value):[];
   const cycles=cyclesResult.status==="fulfilled"?asArray(cyclesResult.value):[];
   const feeds=feedsResult.status==="fulfilled"?asArray(feedsResult.value):[];
   const animalResponse=animalsResult.status==="fulfilled"?animalsResult.value:null;
   setOperational({
    stock:inventory.filter(item=>item.isActive!==false&&item.minimumQuantity!=null&&Number(item.quantityOnHand)<=Number(item.minimumQuantity)),
    cycles:cycles.filter(item=>["active","planned"].includes(item.status)).slice(0,5),
    feeds,
    animalCount:animalResponse?.pagination?.total??null,
    stockLoaded:stockResult.status==="fulfilled",
    cyclesLoaded:cyclesResult.status==="fulfilled",
    feedsLoaded:feedsResult.status==="fulfilled",
    animalsLoaded:animalsResult.status==="fulfilled"
   });
  });
  return ()=>{live=false;};
 },[]);
 const recent=operational.feeds;
 const taskAnimalNames=[...overdue,...due].map(task=>task.animal?.name||task.animalName).filter(Boolean);
 const animalsToCheck=[...new Set(taskAnimalNames)];
 const recentBreeding=asArray(data?.recentEvents).filter(event=>event.type==="reproduction").slice(0,3);
 const dueCount=data?.counts?.dueToday??data?.dueTodayCount??due.length;
 const overdueCount=data?.counts?.overdue??data?.overdueCount??overdue.length;
 const stat=[
  ["Animali registrati",operational.animalCount??"—",operational.animalsLoaded?"Schede nel tuo account":"Conteggio non disponibile"],
  ["Da fare oggi",dueCount,"Attività in scadenza"],
  ["In ritardo",overdueCount,"Da verificare"],
  ["Pasti recenti",operational.feedsLoaded?recent.length:"—","Ultime sessioni registrate"]
 ];
 return <div className="operational-dashboard">
  <div className="stats-grid">{stat.map(([label,val,caption],i)=><article className={"stat-card tone-"+i} key={label}><span>{label}</span><strong>{val}</strong><small>{caption}</small></article>)}</div>
  <div className="dashboard-grid">
   <section className="panel dashboard-focus"><div className="panel-heading"><div><p className="eyebrow">PRIORITÀ</p><h2>Da fare e da recuperare</h2><p className="subheading">Prima le scadenze superate, poi quelle di oggi.</p></div><Button variant="quiet" onClick={()=>onGo("attivita")}>Calendario ↗</Button></div>
    {due.length+overdue.length===0?<div className="dashboard-empty"><span className="status-mark">✓</span><div><strong>Nessuna scadenza segnalata</strong><p>Non risultano attività in ritardo o in scadenza nei dati restituiti dal server.</p></div></div>:<div className="task-list">{[...overdue,...due].slice(0,10).map((task,i)=><article className="task-row" key={task.id||i}><span className={"task-bullet "+(i<overdue.length?"is-overdue":"")}>{i<overdue.length?"!":"•"}</span><div><strong>{value(task,["title","name"],"Attività")}</strong><small>{task.animal?.name||value(task,["description"],"Promemoria")} · {date(value(task,["dueAt","scheduledAt"]))}</small></div><span className={"pill "+(i<overdue.length?"danger":"sage")}>{i<overdue.length?"In ritardo":"Oggi"}</span></article>)}</div>}
    {animalsToCheck.length>0&&<div className="dashboard-inline-note"><strong>Animali collegati alle scadenze</strong><div className="tag-list">{animalsToCheck.slice(0,8).map(name=><span className="data-tag" key={name}>{name}</span>)}</div></div>}
   </section>
   <section className="panel dashboard-actions"><p className="eyebrow">AZIONI FREQUENTI</p><h2>Registra in pochi passaggi</h2><div className="dashboard-action-grid">{[["plus","Nuovo animale","animali"],["feeding","Registra alimentazione","alimentazioni"],["weight","Peso, muta o nota","cure"],["task","Nuova attività","attivita"]].map(([icon,label,id])=><button className="dashboard-action" key={id} onClick={()=>onGo(id)}><span><Icon name={icon} size={18}/></span><strong>{label}</strong><b aria-hidden="true"><Icon name="external" size={14}/></b></button>)}</div><div className="dashboard-inline-links"><button onClick={()=>onGo("inventario")}>Apri inventario</button><button onClick={()=>onGo("riproduzioni")}>Apri riproduzioni</button></div></section>
  </div>
  <div className="dashboard-ops-grid">
   <section className="panel"><div className="panel-heading"><div><p className="eyebrow">ANIMALI</p><h2>Chi richiede attenzione</h2></div><Button variant="quiet" onClick={()=>onGo("animali")}>Apri elenco ↗</Button></div>
    {animalsToCheck.length>0?<div className="task-list">{animalsToCheck.slice(0,6).map(name=><div className="compact-info-row" key={name}><span className="mini-status-dot"/><strong>{name}</strong><span className="muted">Collegato a una scadenza</span></div>)}</div>:<p className="dashboard-helper">Quando un'attività in ritardo o prevista per oggi è associata a un animale, il suo nome compare qui. Non vengono creati controlli fittizi.</p>}
   </section>
   <section className="panel"><div className="panel-heading"><div><p className="eyebrow">ALIMENTAZIONI</p><h2>Ultimi pasti</h2></div><Button variant="quiet" onClick={()=>onGo("alimentazioni")}>Registro ↗</Button></div>
    {!operational.feedsLoaded?<p className="dashboard-helper">Non è stato possibile leggere le sessioni di alimentazione.</p>:recent.length===0?<p className="dashboard-helper">Nessuna sessione di alimentazione registrata.</p>:<div className="task-list">{recent.slice(0,5).map((item,i)=>{const entries=asArray(item.entries);const animalNames=entries.map(entry=>entry.animal?.name).filter(Boolean);const foods=Array.from(new Set(entries.map(entry=>entry.foodType).filter(Boolean)));return <div className="compact-info-row" key={item.id||i}><span className="feeding-dot">◉</span><div className="compact-info-copy"><strong>{animalNames.join(", ")||"Sessione di alimentazione"}</strong><small>{date(value(item,["performedAt","fedAt","createdAt"]))} · {foods.join(", ")||value(item,["notes"],"Pasto registrato")}</small></div></div>;})}</div>}
    <Button variant="secondary" onClick={()=>onGo("alimentazioni")}>＋ Registra alimentazione</Button>
   </section>
   <section className="panel"><div className="panel-heading"><div><p className="eyebrow">SCORTE</p><h2>Sotto soglia</h2></div><Button variant="quiet" onClick={()=>onGo("inventario")}>Inventario ↗</Button></div>
    {!operational.stockLoaded?<p className="dashboard-helper">Stato scorte non disponibile. Apri l’inventario per aggiornare i dati.</p>:operational.stock.length===0?<p className="dashboard-helper">Nessun articolo sotto soglia tra quelli restituiti dal server.</p>:<div className="task-list">{operational.stock.slice(0,5).map(item=><div className="compact-info-row" key={item.id}><span className="stock-warning">!</span><div className="compact-info-copy"><strong>{item.name}</strong><small>{item.quantityOnHand} {item.unit||""} disponibili · soglia {item.minimumQuantity}</small></div></div>)}</div>}
   </section>
   <section className="panel"><div className="panel-heading"><div><p className="eyebrow">RIPRODUZIONE</p><h2>Cicli e covate da seguire</h2></div><Button variant="quiet" onClick={()=>onGo("riproduzioni")}>Apri ↗</Button></div>
    {!operational.cyclesLoaded?<p className="dashboard-helper">Non è stato possibile leggere i cicli riproduttivi in questo momento.</p>:operational.cycles.length===0&&!recentBreeding.length?<p className="dashboard-helper">Nessun ciclo pianificato/in corso o evento recente restituito dal server.</p>:<div className="task-list">{operational.cycles.map(cycle=><div className="compact-info-row" key={cycle.id}><span className="cycle-dot">✳</span><div className="compact-info-copy"><strong>{cycle.name||"Ciclo riproduttivo"}</strong><small>{cycle.parentA?.name||"Genitore A —"} × {cycle.parentB?.name||"Genitore B —"} · {cycle.status==="active"?"In corso":"Pianificato"} · {cycle._count?.clutches??0} covate</small></div></div>)}{recentBreeding.map((event,i)=><div className="compact-info-row" key={event.record?.id||event.id||i}><span className="cycle-dot">◷</span><div className="compact-info-copy"><strong>{event.record?.cycle?.name||event.title||"Evento riproduttivo"}</strong><small>{date(value(event,["occurredAt"]))} · {value(event.record||{},["eventType"],event.title||"Registrazione")}</small></div></div>)}</div>}
   </section>
  </div>
  <div className="dashboard-footnote">Dati personali del tuo account. Le liste mostrano ciò che il server restituisce, senza creare record dimostrativi.</div>
 </div>;
}
