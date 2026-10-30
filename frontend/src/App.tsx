import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "./api/api";
import { ReproductionHub } from "./ReproductionHub";
import { DocumentsHub } from "./DocumentsHub";
import { NotificationsHub } from "./NotificationsHub";
import { CareRecordsHub } from "./CareRecordsHub";
import { AuthScreen as AuthFlowScreen } from "./AuthScreen";
import { AnimalsHub } from "./AnimalsHub";
import { BillingHub } from "./BillingHub";
import { CalendarHub } from "./CalendarHub";
import { InventoryMovementHistory } from "./InventoryMovementHistory";
import { FinanceSummary } from "./FinanceSummary";
import { Icon } from "./ui/Icon";
import { Dashboard } from "./components/Dashboard";
import { Records } from "./components/Records";
import { DataTools } from "./components/DataTools";
import { SettingsPage } from "./components/SettingsPage";
import { Tutorial } from "./components/Tutorial";
import { InventoryFilters } from "./components/InventoryFilters";
import { MoreHub } from "./components/MoreHub";
import { Dialog } from "./ui/Dialog";
import { useConfirmDialog } from "./ui/ConfirmDialog";
import { useRef } from "react";
import type { UnknownRecord, NoticeKind } from "./types";
import { readFormValues } from "./types";

const NAV = [
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

const NAV_GROUPS = [
  { id: "quotidianita", label: "Quotidianità", items: ["oggi", "animali", "alimentazioni", "cure", "attivita"] },
  { id: "allevamento", label: "Allevamento", items: ["riproduzioni", "genetica", "documenti"] },
  { id: "gestione", label: "Gestione", items: ["inventario", "finanze"] },
  { id: "account", label: "Account", items: ["notifiche", "dati", "abbonamento", "impostazioni", "guide"] }
];
const API = {
  oggi: "home/today", animali:"animals?page=1&pageSize=50", alimentazioni:"feeding-sessions?page=1&pageSize=50",
  peso:"weights?page=1&pageSize=50", mute:"sheds?page=1&pageSize=50", note:"notes?page=1&pageSize=50",
  attivita:"tasks?page=1&pageSize=50", riproduzioni:"reproduction-cycles?page=1&pageSize=100",
  inventario:"inventory/items?page=1&pageSize=50", documenti:"documents?page=1&pageSize=50",
  genetica:"genetic-traits", finanze:"finance/entries?page=1&pageSize=50", notifiche:"notifications?page=1&pageSize=50",
  abbonamento:"billing/subscription"
};
const TITLES = Object.fromEntries([...NAV.map(([id,label])=>[id,label]), ["peso","Peso"], ["mute","Mute"], ["note","Note"], ["altro","Altro"]]);
const DESCRIPTIONS = Object.fromEntries([...NAV.map(([id,label,icon,description])=>[id,description]), ["peso","Registra e consulta le pesate degli animali."], ["mute","Annota le mute e il loro esito."], ["note","Consulta e aggiungi osservazioni alle schede." ]]);
const SECTION_PATHS = {
  oggi: "/", animali: "/animals", alimentazioni: "/feeding", cure: "/care",
  peso: "/care/weights", mute: "/care/sheds", note: "/care/notes",
  attivita: "/calendar", riproduzioni: "/reproduction", inventario: "/inventory",
  documenti: "/documents", genetica: "/genetics", finanze: "/finances",
  notifiche: "/notifications", dati: "/data", abbonamento: "/billing",
  guide: "/guide", impostazioni: "/settings", altro: "/more"
};
function initialSectionFromPath(pathname) {
  let path = String(pathname || "/");
  while (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (/^\/tasks(?:\/[^/]+)?$/.test(path)) return "attivita";
  if (path.startsWith("/animals/")) return "animali";
  if (path === "/settings/notifications" || path === "/notifications") return "notifiche";
  const routes = {
    "/": "oggi", "/animals": "animali", "/feeding": "alimentazioni", "/care": "cure",
    "/care/weights": "peso", "/care/sheds": "mute", "/care/notes": "note",
    "/calendar": "attivita", "/tasks": "attivita", "/reproduction": "riproduzioni",
    "/inventory": "inventario", "/documents": "documenti", "/genetics": "genetica",
    "/finances": "finanze", "/data": "dati", "/billing": "abbonamento",
    "/guide": "guide", "/settings": "impostazioni", "/more": "altro"
  };
  return routes[path] || "oggi";
}
function animalIdFromLocation() {
  const queryId = new URLSearchParams(window.location.search).get("animal");
  if (queryId) return queryId;
  const match = window.location.pathname.match(/^\/animals\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}
const asArray = (data) => Array.isArray(data) ? data : Object.values(data ?? {}).find(Array.isArray) ?? [];
const value = (obj, keys, fallback="—") => { for (const k of keys) if (obj?.[k] !== undefined && obj?.[k] !== null && obj?.[k] !== "") return obj[k]; return fallback; };
const date = (v) => { if (!v || v==="—") return "—"; const d=new Date(v); return Number.isNaN(d.getTime())?String(v):new Intl.DateTimeFormat("it-IT",{dateStyle:"medium"}).format(d); };
const localDateTime = (v?: string | Date | null) => { const d=v?new Date(v):new Date(); if(Number.isNaN(d.getTime()))return ""; const p=n=>String(n).padStart(2,"0"); return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+"T"+p(d.getHours())+":"+p(d.getMinutes()); };
const money = (v) => { if (v === null || v === undefined || v === "" || v === "—") return "—"; const n = Number(v); return Number.isFinite(n) ? new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n / 100) : "—"; };

function Brand(){return <a className="brand" href="#oggi" aria-label="Vivarqo, Oggi"><span className="brand-mark">v</span><span>vivarqo<span className="brand-dot">.</span></span></a>;}
function Button({children,variant="",...props}){return <button className={"button "+variant} {...props}>{children}</button>;}
function Field({label,...props}){return <label className="field"><span>{label}</span><input {...props}/></label>;}
function SelectField({label,children,...props}){return <label className="field"><span>{label}</span><select {...props}>{children}</select></label>;}
function Notice({notice}){return notice?<div className={"notice "+(notice.kind||"info")} role="status">{notice.text}</div>:null;}




function App() {
 const [user,setUser]=useState(null),[active,setActive]=useState(()=>initialSectionFromPath(window.location.pathname)),[data,setData]=useState(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(null),[query,setQuery]=useState(""),[modal,setModal]=useState(null),[installEvent,setInstallEvent]=useState(null),[online,setOnline]=useState(navigator.onLine),[listPages,setListPages]=useState({}),[historyItem,setHistoryItem]=useState(null),[pwaUpdateRegistration,setPwaUpdateRegistration]=useState(null);
 const [inventoryFilters,setInventoryFilters]=useState({active:"true",category:"",lowStock:false});
 const [financeRefreshKey,setFinanceRefreshKey]=useState(0);
 const [targetAnimalId,setTargetAnimalId]=useState(()=>animalIdFromLocation());
 const confirmAction=useConfirmDialog();
 const noticeTimer=useRef<number | null>(null);
 const showNotice=useCallback((text: string,kind: NoticeKind="info")=>{setNotice({text,kind});if(noticeTimer.current)window.clearTimeout(noticeTimer.current);noticeTimer.current=window.setTimeout(()=>setNotice(null),5000);},[]);
 useEffect(()=>{const onInstall=e=>{e.preventDefault();setInstallEvent(e);};const onOnline=()=>setOnline(true);const onOffline=()=>setOnline(false);window.addEventListener("beforeinstallprompt",onInstall);window.addEventListener("online",onOnline);window.addEventListener("offline",onOffline);return()=>{window.removeEventListener("beforeinstallprompt",onInstall);window.removeEventListener("online",onOnline);window.removeEventListener("offline",onOffline);};},[]);
 useEffect(()=>{const syncLocation=()=>{setActive(initialSectionFromPath(window.location.pathname));setTargetAnimalId(animalIdFromLocation());setQuery("");setModal(null);setHistoryItem(null);};window.addEventListener("popstate",syncLocation);return()=>window.removeEventListener("popstate",syncLocation);},[]);
 useEffect(()=>{const onUpdateReady=(event: Event)=>setPwaUpdateRegistration((event as CustomEvent<{registration?: ServiceWorkerRegistration}>).detail?.registration??null);window.addEventListener("vivarqo:pwa-update-ready",onUpdateReady);return()=>window.removeEventListener("vivarqo:pwa-update-ready",onUpdateReady);},[]);
 const loadMe=useCallback(async()=>{try{const r=await apiRequest("auth/me");setUser(r.user??r);return true;}catch(e){setUser(null);return false;}},[]);
 useEffect(()=>{void loadMe();},[loadMe]);
 const loadData=useCallback(async(section=active)=>{setData(null);if(["guide-sito","guide-pwa","altro","riproduzioni","documenti","notifiche","alimentazioni","genetica","cure","peso","mute","note","animali","attivita","abbonamento"].includes(section)){setData({});return;}const basePath=API[section];if(!basePath){setData({});return;}const page=listPages[section]||1;const [pathname,queryString=""] = basePath.split("?");const params=new URLSearchParams(queryString);if(params.has("page"))params.set("page",String(page));if(section==="inventario"){params.set("active",inventoryFilters.active);if(inventoryFilters.category)params.set("category",inventoryFilters.category);else params.delete("category");if(inventoryFilters.lowStock)params.set("lowStock","true");else params.delete("lowStock");}if(query.trim()&&["inventario","finanze","alimentazioni","attivita"].includes(section))params.set("q",query.trim());else params.delete("q");const path=pathname+(params.size?"?"+params.toString():"");setBusy(true);try{const result=await apiRequest(path);setData(result);}catch(e){if(e.status===401){setUser(null);}setData({__error:e.message});}finally{setBusy(false);}},[active,listPages,inventoryFilters,query]);
 useEffect(()=>{if(!user)return;const timer=window.setTimeout(()=>void loadData(active),query.trim()?280:0);return()=>window.clearTimeout(timer);},[user,active,loadData,query]);
 const logout=async()=>{try{await apiRequest("auth/logout",{method:"POST",body:{}});}catch{}setUser(null);setData(null);setActive("oggi");showNotice("Hai terminato la sessione.");};
 const go=(id: string, options: {animalId?: string | null}={})=>{const animalId=options?.animalId||null;const basePath=id==="animali"&&animalId?"/animals/"+encodeURIComponent(animalId):(SECTION_PATHS[id]||"/");const nextPath=animalId&&id!=="animali"?basePath+"?animal="+encodeURIComponent(animalId):basePath;if(window.location.pathname+window.location.search!==nextPath)window.history.pushState({section:id},"",nextPath);setActive(id);setTargetAnimalId(animalId);setQuery("");setModal(null);setHistoryItem(null);if(window.innerWidth<900)document.querySelector(".sidebar")?.classList.remove("sidebar--open");};
 const updateInventoryFilter=(name,value)=>{setInventoryFilters(current=>({...current,[name]:value}));setListPages(current=>({...current,inventario:1}));setHistoryItem(null);};
 const resetInventoryFilters=()=>{setInventoryFilters({active:"true",category:"",lowStock:false});setListPages(current=>({...current,inventario:1}));setHistoryItem(null);};
 const updateRecordSearch=(next)=>{setQuery(next);setListPages(current=>({...current,[active]:1}));};
 const rows=useMemo(()=>asArray(data),[data]);
 const saveEntity=async(e)=>{e.preventDefault();const form=new FormData(e.currentTarget);const raw=readFormValues(e.currentTarget);const {endpoint,method="POST",transform}=modal;try{const result=await apiRequest(endpoint,{method,body:transform?transform(raw):raw});setModal(null);showNotice("Modifiche salvate.");if(active==="finanze")setFinanceRefreshKey(key=>key+1);await loadData(active);}catch(err){showNotice(err.message,"error");}};
 const addAnimal=()=>setModal({title:"Nuovo animale",endpoint:"animals",fields:[["name","Nome","text"],["identifier","Identificativo (facoltativo)","text"],["species","Specie","text"],["sex","Sesso","select"],["morph","Morph","text"],["birthDate","Data di nascita","date"],["locationLabel","Stabulazione / posizione","text"],["notes","Note","textarea"]],transform:v=>({...v,identifier:v.identifier||null,morph:v.morph||null,birthDate:v.birthDate||null,locationLabel:v.locationLabel||null,notes:v.notes||null})});
 const addInventory=()=>setModal({title:"Nuovo articolo",endpoint:"inventory/items",fields:[["name","Nome","text"],["category","Categoria","select"],["unit","Unità","text"],["quantityOnHand","Quantità iniziale","number"],["minimumQuantity","Soglia minima","number"],["notes","Note","textarea"]],transform:v=>({...v,quantityOnHand:Number(v.quantityOnHand||0),minimumQuantity:v.minimumQuantity===""?null:Number(v.minimumQuantity),notes:v.notes||null})});
 const addFinance=()=>setModal({title:"Nuova voce economica",endpoint:"finance/entries",fields:[["entryType","Tipo","select"],["occurredOn","Data","date"],["amount","Importo (€)","number"],["category","Categoria","text"],["description","Descrizione","text"]],transform:v=>({entryType:v.entryType,occurredOn:v.occurredOn,amountCents:Math.round(Number(v.amount)*100),currency:"EUR",category:v.category,description:v.description})});
 const addTask=()=>setModal({title:"Nuova attività",endpoint:"tasks",fields:[["title","Titolo","text"],["taskCategory","Categoria","select","custom"],["dueAt","Scadenza","datetime-local"],["description","Descrizione","text"]],transform:v=>({title:v.title,category:v.taskCategory,dueAt:new Date(v.dueAt).toISOString(),description:v.description||null})});
   const openEditRecord=(row)=>{if(!["animali","inventario","attivita","finanze"].includes(active))return;
    if(active==="animali")return setModal({title:"Modifica animale",endpoint:"animals/"+row.id,method:"PATCH",fields:[["name","Nome","text",row.name],["identifier","Identificativo (facoltativo)","text",row.identifier||""],["species","Specie","text",row.species],["sex","Sesso","select",row.sex||"unknown"],["morph","Morph","text",row.morph||""],["birthDate","Data di nascita","date",row.birthDate?String(row.birthDate).slice(0,10):""],["locationLabel","Stabulazione / posizione","text",row.locationLabel||""],["notes","Note","textarea",row.notes||""]],transform:v=>({name:v.name,identifier:v.identifier||null,species:v.species,sex:v.sex,morph:v.morph||null,birthDate:v.birthDate||null,locationLabel:v.locationLabel||null,notes:v.notes||null})});
    if(active==="inventario")return setModal({title:"Modifica articolo",endpoint:"inventory/items/"+row.id,method:"PATCH",fields:[["name","Nome","text",row.name],["category","Categoria","select",row.category],["unit","Unità","text",row.unit],["minimumQuantity","Soglia minima","number",row.minimumQuantity??""],["notes","Note","textarea",row.notes||""]],transform:v=>({name:v.name,category:v.category,unit:v.unit,minimumQuantity:v.minimumQuantity===""?null:Number(v.minimumQuantity),notes:v.notes||null})});
    if(active==="attivita")return setModal({title:"Modifica attività",endpoint:"tasks/"+row.id,method:"PATCH",fields:[["title","Titolo","text",row.title],["taskCategory","Categoria","select",row.category||"custom"],["dueAt","Scadenza","datetime-local",row.dueAt?new Date(row.dueAt).toISOString().slice(0,16):""],["description","Descrizione","textarea",row.description||""]],transform:v=>({title:v.title,category:v.taskCategory,dueAt:new Date(v.dueAt).toISOString(),description:v.description||null})});
    if(active==="finanze")return setModal({title:"Modifica voce economica",endpoint:"finance/entries/"+row.id,method:"PATCH",fields:[["entryType","Tipo","select",row.entryType],["occurredOn","Data","date",row.occurredOn?String(row.occurredOn).slice(0,10):""],["amount","Importo (€)","number",Number(row.amountCents||0)/100],["category","Categoria","text",row.category],["description","Descrizione","text",row.description]],transform:v=>({entryType:v.entryType,occurredOn:v.occurredOn,amountCents:Math.round(Number(v.amount)*100),category:v.category,description:v.description})});
  };
  const deleteRecord=async(row)=>{if(!["animali","inventario","attivita","finanze"].includes(active))return;
    const inventory=active==="inventario";
    if(!(await confirmAction({title:inventory?"Archiviare l’articolo?":"Eliminare il record?",message:inventory?"L’articolo verrà archiviato e lo storico resterà consultabile.":"L’operazione non è reversibile. Se esistono record collegati, il server potrebbe impedirla.",confirmLabel:inventory?"Archivia articolo":"Elimina record",danger:!inventory})))return;
    const endpoint=active==="animali"?"animals/"+row.id:inventory?"inventory/items/"+row.id+"/archive":active==="attivita"?"tasks/"+row.id:"finance/entries/"+row.id;
    const method=inventory?"POST":"DELETE";
    try{
      const result=await apiRequest(endpoint,{method,body:inventory?{}:undefined});
      showNotice(inventory?"Articolo archiviato.":"Record eliminato.");if(active==="finanze")setFinanceRefreshKey(key=>key+1);await loadData(active);
    }catch(err){showNotice(err.message,"error");}
  };
  const createInventoryMovement=(row)=>setModal({title:"Movimento di magazzino · "+row.name,endpoint:"inventory/items/"+row.id+"/movements",fields:[["movementType","Tipo movimento","select","in"],["quantity","Quantità","number","1"],["occurredAt","Data e ora","datetime-local",localDateTime()],["unitCostCents","Costo unitario (centesimi, facoltativo)","number",""],["reference","Riferimento (facoltativo)","text",""],["notes","Note","textarea",""]],transform:v=>({movementType:v.movementType,quantity:Number(v.quantity),occurredAt:new Date(v.occurredAt).toISOString(),unitCostCents:v.unitCostCents===""?null:Number(v.unitCostCents),reference:v.reference||null,notes:v.notes||null})});
const actionButton = active==="inventario"?["＋ Nuovo articolo",addInventory]:active==="finanze"?["＋ Nuova voce",addFinance]:null;
 const dataForDisplay = useMemo(()=>rows.filter(row=>JSON.stringify(row).toLowerCase().includes(query.toLowerCase())),[rows,query]);
 const displayRecord = (r)=>active==="animali"?{Nome:value(r,["name"]),Identificativo:value(r,["identifier"]),Specie:value(r,["species"]),Sesso:value(r,["sex"]),Morph:value(r,["morph"]),Stabulazione:value(r,["locationLabel"]),Stato:value(r,["status"])}:active==="inventario"?{Articolo:value(r,["name"]),Categoria:value(r,["category"]),Disponibile:value(r,["quantityOnHand"]),Unità:value(r,["unit"]),Soglia:value(r,["minimumQuantity"]),Stato:r.isActive===false?"Archiviato":"Attivo",Scorte:r.minimumQuantity==null?"Soglia non impostata":Number(r.quantityOnHand)<=Number(r.minimumQuantity)?"Sotto soglia":"Adeguate"}:active==="finanze"?{Descrizione:value(r,["description"]),Tipo:value(r,["entryType"]),Data:date(value(r,["occurredOn"],"—")),Importo:money(value(r,["amountCents"],"—")),Categoria:value(r,["category"])}:active==="alimentazioni"?{Data:date(value(r,["performedAt","fedAt","createdAt"])),Animale:value(r,["animalName","animalId"]),Esito:value(r,["outcome"]),Cibo:value(r,["foodType"]),Dettagli:value(r,["notes"])}:active==="attivita"?{Attività:value(r,["title","name"]),Scadenza:date(value(r,["dueAt"])),Stato:value(r,["status"]),Animale:value(r,["animalName"])}:active==="notifiche"?{Titolo:value(r,["title"]),Messaggio:value(r,["body"]),Data:date(value(r,["createdAt"])),Stato:value(r,["readAt"],"Non letta")}:Object.fromEntries(Object.entries(r).filter(([k,v])=>!["userId","updatedAt","createdAt","id"].includes(k)&&["string","number","boolean"].includes(typeof v)).slice(0,6).map(([k,v])=>[k.replace(/([A-Z])/g," $1"),String(v)]));
 const markTask=async(row,status)=>{try{await apiRequest("tasks/"+row.id+"/complete",{method:"POST",body:{}});showNotice("Attività aggiornata.");await loadData(active);}catch(e){showNotice(e.message,"error");}};
 const createCare=async(type)=>{const destination=type==="weights"?"peso":type==="sheds"?"mute":"note";go(destination);showNotice("Seleziona l'animale e completa il modulo dedicato per registrare il dato.","info");};
 const doInstall=async()=>{if(!installEvent){showNotice("Usa il menu Condividi del browser e scegli “Aggiungi alla schermata Home” o “Installa app”.");return;}await installEvent.prompt();await installEvent.userChoice;setInstallEvent(null);};
 const headerTitle=active==="guide-sito"?"Tutorial per usare il sito":active==="guide-pwa"?"Tutorial per installare e usare la PWA":TITLES[active]||"Vivarqo";
 const authFlowPath = /^\/(verify-email|reset-password)\/?$/.test(window.location.pathname);if(!user || authFlowPath)return <><AuthFlowScreen onLogin={loadMe}/><Notice notice={notice}/></>;
 return <div className="app-shell"><aside className="sidebar"><div className="sidebar-brand"><Brand/><button className="mobile-close" onClick={()=>document.querySelector(".sidebar")?.classList.remove("sidebar--open")}>×</button></div><nav className="nav-groups" aria-label="Navigazione principale">{NAV_GROUPS.map(group=><details className="nav-group" key={group.id} open={group.items.includes(active) || (active==="altro" && group.id==="quotidianita") || undefined}><summary>{group.label}<span className="nav-chevron" aria-hidden="true">⌄</span></summary><div className="nav-group-items">{group.items.map(id=>{const [,label,icon,description]=NAV.find(item=>item[0]===id)||[];return <button key={id} title={description} className={"nav-item "+(active===id?"active":"")} onClick={()=>go(id)}><span className="nav-icon"><Icon name={icon} size={18}/></span><span>{label}</span></button>;})}</div></details>)}</nav><div className="sidebar-foot"><div className="sidebar-note"><strong>Piccoli gesti, dati preziosi.</strong><p>Registra le attività quando accadono: il tuo storico sarà più utile.</p></div><button className="user-card" onClick={()=>go("impostazioni")}><span className="avatar">{String(user.displayName||user.email||"V").slice(0,1).toUpperCase()}</span><span><strong>{user.displayName||"Il mio account"}</strong><small>{user.email}</small></span><span>···</span></button></div></aside><main className="main-content"><header className="topbar"><button className="menu-toggle" aria-label="Apri menu" onClick={()=>document.querySelector(".sidebar")?.classList.toggle("sidebar--open")}><Icon name="menu" size={21}/></button><div><span className="breadcrumb">Vivarqo / </span><strong>{headerTitle}</strong></div><div className="topbar-right"><span className={"connection "+(online?"":"offline")}>{online?"● Online":"○ Offline"}</span><button className="install-button" onClick={doInstall}><Icon name="plus" size={15}/> Installa PWA</button><button className="avatar avatar-button" onClick={logout} title="Esci">{String(user.displayName||user.email||"V").slice(0,1).toUpperCase()}</button></div></header><div className="page-wrap"><Notice notice={notice}/>{pwaUpdateRegistration&&<div className="notice pwa-update-notice" role="status"><span>È disponibile una nuova versione di Vivarqo.</span><Button variant="secondary" onClick={()=>{const waiting=pwaUpdateRegistration.waiting;if(waiting)waiting.postMessage({type:"SKIP_WAITING"});else setPwaUpdateRegistration(null);}}>Aggiorna ora</Button></div>}{!online&&<div className="notice warning">Sei offline. Per leggere o modificare i dati devi ripristinare la connessione; Vivarqo non salva modifiche offline.</div>}
 <section className="page-heading"><div><p className="eyebrow">GESTIONE ALLEVAMENTO · {new Intl.DateTimeFormat("it-IT",{weekday:"long",day:"numeric",month:"long"}).format(new Date())}</p><h1><span className="page-heading-icon"><Icon name={NAV.find(item=>item[0]===active)?.[2]||"home"} size={24}/></span>{active==="oggi"?"Il tuo allevamento, sotto controllo.":headerTitle}</h1><p>{active==="altro"?"Tutte le funzioni, organizzate per area.":DESCRIPTIONS[active]||"Una guida pratica per gestire il tuo allevamento."}</p></div><div className="heading-actions">{actionButton&&<Button onClick={actionButton[1]}>{actionButton[0]}</Button>}{active==="guide-pwa"&&<Button onClick={doInstall}>Installa la PWA</Button>}</div></section>
 {busy?<div className="loading"><span className="spinner"/>Caricamento dati dal server…</div>:data?.__error?<div className="error-panel"><h2>Non riesco a caricare questa sezione</h2><p>{data.__error}</p><Button variant="secondary" onClick={()=>loadData(active)}>Riprova</Button></div>:active==="guide"?<><div className="tutorial-callout"><h3>Impara a usare Vivarqo</h3><p>Qui trovi due guide: come gestire i registri dal sito e come installare la PWA sul tuo dispositivo.</p></div><p className="eyebrow tutorial-section-label">GUIDA AL SITO</p><Tutorial/><div className="tutorial-callout"><h3>Flusso consigliato</h3><p>1. Crea le schede degli animali. 2. Registra pasti, pesi, mute e note. 3. Pianifica attività e promemoria. 4. Mantieni aggiornati inventario e documenti. 5. Esporta periodicamente una copia dei dati.</p></div><p className="eyebrow tutorial-section-label">GUIDA ALLA PWA</p><Tutorial pwa/><div className="tutorial-callout"><h3>Cosa funziona offline?</h3><p>La PWA conserva solo risorse statiche già caricate. Le modifiche JSON compatibili possono essere accodate sul dispositivo e sincronizzate quando torni online con Vivarqo aperto; le risposte private dell’API non vengono messe in cache.</p><Button onClick={doInstall}>＋ Installa la PWA</Button></div></>:active==="guide-sito"?<><Tutorial/><div className="tutorial-callout"><h3>Flusso consigliato</h3><p>1. Crea le schede degli animali. 2. Registra pasti, pesi, mute e note. 3. Pianifica attività e promemoria. 4. Mantieni aggiornati inventario e documenti. 5. Esporta periodicamente una copia dei dati.</p></div></>:active==="guide-pwa"?<><Tutorial pwa/><div className="tutorial-callout"><h3>Cosa funziona offline?</h3><p>La PWA può conservare alcune risorse statiche già caricate. Le risposte private dell’API non vengono memorizzate dal service worker. Le modifiche JSON compatibili possono essere accodate sul dispositivo e sincronizzate quando torni online con Vivarqo aperto. File e pagamenti restano online-only.</p><Button onClick={doInstall}>＋ Installa la PWA</Button></div></>:active==="altro"?<MoreHub onGo={go} groups={NAV_GROUPS} nav={NAV}/>:active==="oggi"?<Dashboard data={data} onGo={go} onRetry={()=>loadData("oggi")}/>:active==="riproduzioni"?<ReproductionHub owner={user.id||user.email} onNotice={showNotice}/>:active==="documenti"?<DocumentsHub owner={user.id||user.email} onNotice={showNotice}/>:active==="notifiche"?<NotificationsHub owner={user.id||user.email} onNotice={showNotice}/>:active==="cure"?<CareRecordsHub owner={user.id||user.email} onNotice={showNotice} initialTab="weights" initialAnimalId={targetAnimalId}/>:active==="alimentazioni"?<CareRecordsHub owner={user.id||user.email} onNotice={showNotice} initialTab="feedings" initialAnimalId={targetAnimalId}/>:active==="genetica"?<CareRecordsHub owner={user.id||user.email} onNotice={showNotice} initialTab="genetics" initialAnimalId={targetAnimalId}/>:active==="peso"||active==="mute"||active==="note"?<CareRecordsHub owner={user.id||user.email} onNotice={showNotice} initialTab={active==="peso"?"weights":active==="mute"?"sheds":"notes"} initialAnimalId={targetAnimalId}/>:active==="animali"?<AnimalsHub owner={user.id||user.email} onNotice={showNotice} onGo={go} initialAnimalId={targetAnimalId}/>:active==="attivita"?<CalendarHub onNotice={showNotice}/>:active==="abbonamento"?<BillingHub onNotice={showNotice}/>:active==="inventario"?<><InventoryFilters filters={inventoryFilters} onChange={updateInventoryFilter} onReset={resetInventoryFilters}/><Records active={active} data={data} rows={dataForDisplay} onSearch={updateRecordSearch} query={query} onCare={createCare} onReload={()=>loadData(active)} onTask={markTask} onGo={go} onEdit={openEditRecord} onDelete={deleteRecord} onHistory={setHistoryItem} onMovement={createInventoryMovement} onPageChange={page=>setListPages(p=>({...p,[active]:page}))}/>{historyItem&&<InventoryMovementHistory item={historyItem} onClose={()=>setHistoryItem(null)}/>}</>:active==="finanze"?<><FinanceSummary onNotice={showNotice} refreshKey={financeRefreshKey}/><Records active={active} data={data} rows={dataForDisplay} onSearch={updateRecordSearch} query={query} onCare={createCare} onReload={()=>loadData(active)} onTask={markTask} onGo={go} onEdit={openEditRecord} onDelete={deleteRecord} onPageChange={page=>setListPages(p=>({...p,[active]:page}))}/></>:active==="dati"?<DataTools onNotice={showNotice}/>:active==="impostazioni"?<SettingsPage user={user} onNotice={showNotice}/>:<Records active={active} data={data} rows={dataForDisplay} onSearch={updateRecordSearch} query={query} onCare={createCare} onReload={()=>loadData(active)} onTask={markTask} onGo={go} onEdit={openEditRecord} onDelete={deleteRecord} onMovement={createInventoryMovement} onPageChange={page=>setListPages(p=>({...p,[active]:page}))}/>} 
 <footer className="page-footer"><span>Vivarqo · Crescere con cura.</span><span>Sessione protetta · Dati caricati dal backend</span></footer></div></main>{modal&&<Modal modal={modal} onClose={()=>setModal(null)} onSubmit={saveEntity}/>}<nav className="mobile-nav" aria-label="Navigazione rapida">{[["oggi","home","Oggi"],["animali","animals","Animali"],["alimentazioni","feeding","Pasti"],["attivita","calendar","Attività"],["altro","more","Altro"]].map(([id,icon,label])=><button key={id} className={active===id || (id==="altro" && !["oggi","animali","alimentazioni","attivita"].includes(active))?"active":""} onClick={()=>go(id)}><span><Icon name={icon} size={20}/></span>{label}</button>)}</nav></div>;
}




function Modal({modal,onClose,onSubmit}: { modal: UnknownRecord; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
 return <Dialog title={modal.title} onClose={onClose} onSubmit={onSubmit} submitLabel="Salva" size={modal.fields.length>6?"wide":"normal"}>
  {modal.fields.map(([name,label,type,initial])=><div className={type==="textarea"?"form-full":""} key={name}>{type==="select"?<SelectField label={label} name={name} defaultValue={initial} required>{(name==="sex"?[["unknown","Non specificato"],["male","Maschio"],["female","Femmina"]]:name==="category"?[["food","Alimenti"],["substrate","Substrati"],["material","Materiali"],["equipment","Attrezzatura"],["other","Altro"]]:name==="taskCategory"?[["feeding","Alimentazioni"],["weighing","Peso"],["shed_check","Muta"],["cleaning","Pulizia"],["reproduction","Riproduzione"],["document","Documenti"],["inventory","Inventario"],["custom","Personalizzata"]]:name==="movementType"?[["in","Carico"],["out","Scarico"],["adjustment","Rettifica"]]:name==="entryType"?[["income","Entrata"],["expense","Uscita"]]:[]).map(([v,l])=><option key={v} value={v}>{l}</option>)}</SelectField>:type==="textarea"?<label className="field"><span>{label}</span><textarea name={name} rows={3} defaultValue={initial}/></label>:<Field label={label} name={name} type={type} defaultValue={initial} step={type==="number"?0.001:undefined} required={!label.includes("facoltativo")&&name!=="minimumQuantity"&&name!=="unitCostCents"}/>}</div>)}
 </Dialog>;
}
export default App;
