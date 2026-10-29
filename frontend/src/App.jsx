import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest, apiUpload } from "./api/api.js";
import { ReproductionHub } from "./ReproductionHub.jsx";
import { DocumentsHub } from "./DocumentsHub.jsx";
import { NotificationsHub } from "./NotificationsHub.jsx";
import { CareRecordsHub } from "./CareRecordsHub.jsx";
import { OfflineQueuePanel } from "./OfflineQueuePanel.jsx";
import { AuthScreen as AuthFlowScreen } from "./AuthScreen.jsx";
import { AnimalsHub } from "./AnimalsHub.jsx";
import { BillingHub } from "./BillingHub.jsx";
import { CalendarHub } from "./CalendarHub.jsx";
import { InventoryMovementHistory } from "./InventoryMovementHistory.jsx";
import { FinanceSummary } from "./FinanceSummary.jsx";

const NAV = [
  ["oggi","Oggi","⌂","Panoramica e attività in scadenza"],
  ["animali","Animali","♧","Anagrafica e schede individuali"],
  ["alimentazioni","Alimentazioni","◉","Sessioni e storico dei pasti"],
  ["cure","Peso, mute e note","＋","Registri di cura e osservazioni"],
  ["attivita","Attività e calendario","◷","Promemoria, attività e scadenze"],
  ["riproduzioni","Riproduzioni","✳","Cicli, covate, uova e piccoli"],
  ["inventario","Inventario","▤","Scorte, movimenti e soglie"],
  ["documenti","Documenti e QR","▧","Documenti e condivisioni pubbliche"],
  ["genetica","Morph e genetica","◈","Tratti genetici e storico"],
  ["finanze","Registro economico","€","Entrate e uscite gestionali"],
  ["notifiche","Notifiche","♧","Avvisi e preferenze push"],
  ["dati","Importa ed esporta","⇄","Portabilità dei tuoi dati"],
  ["abbonamento","Abbonamento","◇","Stato e gestione del piano"],
  ["guide","Guide e tutorial","?","Guide dettagliate sito e PWA"],
  ["impostazioni","Impostazioni","⚙","Profilo, lingua e sicurezza"]
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
const TITLES = Object.fromEntries([...NAV.map(([id,label])=>[id,label]), ["altro", "Altro"]]);
function initialSectionFromPath(pathname) {
 let path = String(pathname || "/");
 while (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
 const segments = path.split("/").filter(Boolean);
 if (segments[0] === "tasks" && segments.length <= 2) return "attivita";
 if (path === "/settings/notifications" || path === "/notifications") return "notifiche";
 if (path === "/calendar" || path === "/tasks") return "attivita";
 if (path === "/billing") return "abbonamento";
 if (path === "/inventory") return "inventario";
 if (path === "/animals") return "animali";
 if (path === "/reproduction") return "riproduzioni";
 if (path === "/documents") return "documenti";
 return "oggi";
}
const asArray = (data) => Array.isArray(data) ? data : Object.values(data ?? {}).find(Array.isArray) ?? [];
const value = (obj, keys, fallback="—") => { for (const k of keys) if (obj?.[k] !== undefined && obj?.[k] !== null && obj?.[k] !== "") return obj[k]; return fallback; };
const date = (v) => { if (!v || v==="—") return "—"; const d=new Date(v); return Number.isNaN(d.getTime())?String(v):new Intl.DateTimeFormat("it-IT",{dateStyle:"medium"}).format(d); };
const localDateTime = (v) => { const d=v?new Date(v):new Date(); if(Number.isNaN(d.getTime()))return ""; const p=n=>String(n).padStart(2,"0"); return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+"T"+p(d.getHours())+":"+p(d.getMinutes()); };
const money = (v) => { if (v === null || v === undefined || v === "" || v === "—") return "—"; const n = Number(v); return Number.isFinite(n) ? new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n / 100) : "—"; };

function Brand(){return <a className="brand" href="#oggi" aria-label="Vivarqo, Oggi"><span className="brand-mark">v</span><span>vivarqo<span className="brand-dot">.</span></span></a>;}
function Button({children,variant="",...props}){return <button className={"button "+variant} {...props}>{children}</button>;}
function Field({label,...props}){return <label className="field"><span>{label}</span><input {...props}/></label>;}
function SelectField({label,children,...props}){return <label className="field"><span>{label}</span><select {...props}>{children}</select></label>;}
function Notice({notice}){return notice?<div className={"notice "+(notice.kind||"info")} role="status">{notice.text}</div>:null;}

function AuthScreen({onLogin}) {
 const [mode,setMode]=useState("login"),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const submit=async(e)=>{e.preventDefault();setBusy(true);setError("");const f=new FormData(e.currentTarget);const body=Object.fromEntries(f.entries());try{const path=mode==="login"?"auth/login":mode==="register"?"auth/register":mode==="forgot"?"auth/forgot-password":"auth/resend-verification";await apiRequest(path,{method:"POST",body});if(mode==="login")await onLogin();else setError(mode==="register"?"Account creato. Controlla la tua email per verificare l’indirizzo.":"Se l’indirizzo è registrato, riceverai le istruzioni via email.");}catch(err){setError(err.message||"Operazione non riuscita.");}finally{setBusy(false);}};
 return <main className="auth-wrap"><div className="auth-art"><Brand/><p className="eyebrow">IL GESTIONALE PER ALLEVATORI</p><h1>Più cura.<br/><em>Meno fogli.</em></h1><p>Animali, alimentazioni, documenti e riproduzioni: tutto in un unico spazio, pensato anche per il telefono.</p><div className="auth-leaf">❧</div></div><section className="auth-card"><div className="auth-card-head"><p className="eyebrow">BENTORNATO</p><h2>{mode==="login"?"Accedi a Vivarqo":mode==="register"?"Crea il tuo account":"Recupera l’accesso"}</h2><p>I tuoi registri restano privati e collegati al tuo account.</p></div><form className="form-stack" onSubmit={submit}>{mode==="register"&&<Field label="Nome visualizzato" name="displayName" autoComplete="name" required maxLength="120"/>}{mode!=="forgot"&&<Field label="Email" name="email" type="email" autoComplete="email" required maxLength="254"/>}{(mode==="login"||mode==="register")&&<Field label="Password" name="password" type="password" autoComplete={mode==="login"?"current-password":"new-password"} required minLength={mode==="register"?12:1}/ >}{mode==="forgot"&&<p className="muted">Ti invieremo le istruzioni se l’indirizzo è associato a un account.</p>}<Button disabled={busy}>{busy?"Attendi…":mode==="login"?"Accedi":mode==="register"?"Crea account":"Invia istruzioni"}</Button></form>{error&&<p className="form-message">{error}</p>}<div className="auth-links">{mode!=="login"&&<button onClick={()=>{setMode("login");setError("");}}>Torna all’accesso</button>}{mode==="login"&&<><button onClick={()=>setMode("forgot")}>Password dimenticata?</button><button onClick={()=>setMode("register")}>Crea un account</button></>}</div><p className="tiny">Registrandoti dichiari di aver letto l’informativa privacy e le condizioni applicabili pubblicate dal gestore.</p></section></main>;
}

function LoginGuard({children,onLogout}){return <>{children}</>;}

function Tutorial({pwa=false}){return <div className="tutorial-grid"><article className="tutorial-card"><span className="step">01</span><h3>{pwa?"Installa sul dispositivo":"Completa il profilo"}</h3><p>{pwa?"Apri Vivarqo con Chrome o Edge su Android/desktop oppure usa Condividi → Aggiungi alla schermata Home su iPhone. Su iOS la voce può chiamarsi “Aggiungi alla schermata Home”.":"Accedi, completa nome, lingua e fuso orario. La sessione è gestita dal server: non condividere il dispositivo se non hai effettuato la disconnessione."}</p></article><article className="tutorial-card"><span className="step">02</span><h3>{pwa?"Apri dalla nuova icona":"Registra gli animali"}</h3><p>{pwa?"Avvia Vivarqo dall’icona installata. L’app usa una visualizzazione dedicata; la prima apertura e le funzioni con dati richiedono la connessione.":"Crea una scheda per ogni esemplare con nome, specie e identificativo facoltativo. Usa la ricerca e i filtri per trovare rapidamente le schede."}</p></article><article className="tutorial-card"><span className="step">03</span><h3>{pwa?"Aggiorna con cautela":"Registra le attività"}</h3><p>{pwa?"Quando compare un aggiornamento, ricarica dopo aver terminato le modifiche. Le modifiche compatibili vengono conservate in una coda locale e inviate quando torna la connessione mentre Vivarqo è aperto. Alcune operazioni (allegati, condivisioni e pagamenti) restano solo online.":"Dopo un pasto registra l’esito e i dettagli; aggiungi peso, muta, note e promemoria con data reale per mantenere uno storico affidabile."}</p></article><article className="tutorial-card"><span className="step">04</span><h3>{pwa?"Consenti le notifiche solo se vuoi":"Esporta e proteggi i dati"}</h3><p>{pwa?"Apri Notifiche e premi Attiva solo se desideri le push. Il browser chiederà il consenso. La consegna dipende dal sistema operativo e dalla configurazione server.":"Usa Importa ed esporta per scaricare una copia o migrare dati. Gli archivi possono contenere informazioni personali: conservali in modo sicuro."}</p></article><article className="tutorial-card"><span className="step">05</span><h3>Quando non funziona</h3><p>Controlla la connessione, verifica che il server sia raggiungibile e riprova. Se il problema persiste, annota il messaggio e l’ora senza condividere password o token.</p></article><article className="tutorial-card"><span className="step">06</span><h3>Privacy e sicurezza</h3><p>La PWA memorizza solo risorse statiche nella cache; le risposte private dell’API non vengono memorizzate. Le modifiche JSON compatibili restano in coda locale e si sincronizzano quando torna la connessione mentre Vivarqo è aperto.</p></article></div>;}

function App() {
 const [user,setUser]=useState(null),[active,setActive]=useState(()=>initialSectionFromPath(window.location.pathname)),[data,setData]=useState(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(null),[query,setQuery]=useState(""),[modal,setModal]=useState(null),[installEvent,setInstallEvent]=useState(null),[online,setOnline]=useState(navigator.onLine),[listPages,setListPages]=useState({}),[historyItem,setHistoryItem]=useState(null);
 const [inventoryFilters,setInventoryFilters]=useState({active:"true",category:"",lowStock:false});
 const [financeRefreshKey,setFinanceRefreshKey]=useState(0);
 const showNotice=useCallback((text,kind="info")=>{setNotice({text,kind});window.clearTimeout(showNotice.timer);showNotice.timer=window.setTimeout(()=>setNotice(null),5000);},[]);
 useEffect(()=>{const onInstall=e=>{e.preventDefault();setInstallEvent(e);};const onOnline=()=>setOnline(true);const onOffline=()=>setOnline(false);window.addEventListener("beforeinstallprompt",onInstall);window.addEventListener("online",onOnline);window.addEventListener("offline",onOffline);return()=>{window.removeEventListener("beforeinstallprompt",onInstall);window.removeEventListener("online",onOnline);window.removeEventListener("offline",onOffline);};},[]);
 const loadMe=useCallback(async()=>{try{const r=await apiRequest("auth/me");setUser(r.user??r);return true;}catch(e){setUser(null);return false;}},[]);
 useEffect(()=>{void loadMe();},[loadMe]);
 const loadData=useCallback(async(section=active)=>{setData(null);if(["guide-sito","guide-pwa","altro","riproduzioni","documenti","notifiche","alimentazioni","genetica","cure","peso","mute","note","animali","attivita","abbonamento"].includes(section)){setData({});return;}const basePath=API[section];if(!basePath){setData({});return;}const page=listPages[section]||1;const [pathname,queryString=""] = basePath.split("?");const params=new URLSearchParams(queryString);if(params.has("page"))params.set("page",String(page));if(section==="inventario"){params.set("active",inventoryFilters.active);if(inventoryFilters.category)params.set("category",inventoryFilters.category);else params.delete("category");if(inventoryFilters.lowStock)params.set("lowStock","true");else params.delete("lowStock");}if(query.trim()&&["inventario","finanze","alimentazioni","attivita"].includes(section))params.set("q",query.trim());else params.delete("q");const path=pathname+(params.size?"?"+params.toString():"");setBusy(true);try{const result=await apiRequest(path);setData(result);}catch(e){if(e.status===401){setUser(null);}setData({__error:e.message});}finally{setBusy(false);}},[active,listPages,inventoryFilters,query]);
 useEffect(()=>{if(!user)return;const timer=window.setTimeout(()=>void loadData(active),query.trim()?280:0);return()=>window.clearTimeout(timer);},[user,active,loadData,query]);
 const logout=async()=>{try{await apiRequest("auth/logout",{method:"POST",body:{}});}catch{}setUser(null);setData(null);setActive("oggi");showNotice("Hai terminato la sessione.");};
 const go=(id)=>{setActive(id);setQuery("");setModal(null);setHistoryItem(null);if(window.innerWidth<900)document.querySelector(".sidebar")?.classList.remove("sidebar--open");};
 const updateInventoryFilter=(name,value)=>{setInventoryFilters(current=>({...current,[name]:value}));setListPages(current=>({...current,inventario:1}));setHistoryItem(null);};
 const resetInventoryFilters=()=>{setInventoryFilters({active:"true",category:"",lowStock:false});setListPages(current=>({...current,inventario:1}));setHistoryItem(null);};
 const updateRecordSearch=(next)=>{setQuery(next);setListPages(current=>({...current,[active]:1}));};
 const rows=useMemo(()=>asArray(data),[data]);
 const saveEntity=async(e)=>{e.preventDefault();const form=new FormData(e.currentTarget);const raw=Object.fromEntries(form.entries());const {endpoint,method="POST",transform}=modal;try{const result=await apiRequest(endpoint,{method,body:transform?transform(raw):raw,queueWhenOffline:true,offlineOwner:user.id||user.email,offlineLabel:modal.title||"Modifica dati"});setModal(null);if(result?.queuedOffline){showNotice("Modifica conservata sul dispositivo. Verrà sincronizzata al ritorno della connessione.","warning");}else{showNotice("Modifiche salvate.");if(active==="finanze")setFinanceRefreshKey(key=>key+1);await loadData(active);}}catch(err){showNotice(err.message,"error");}};
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
    if(!window.confirm(inventory?"Archiviare questo articolo? Potrai ancora consultarne lo storico.":"Eliminare definitivamente questo record?"))return;
    const endpoint=active==="animali"?"animals/"+row.id:inventory?"inventory/items/"+row.id+"/archive":active==="attivita"?"tasks/"+row.id:"finance/entries/"+row.id;
    const method=inventory?"POST":"DELETE";
    try{
      const result=await apiRequest(endpoint,{method,body:inventory?{}:undefined,queueWhenOffline:true,offlineOwner:user.id||user.email,offlineLabel:inventory?"Archivia articolo":"Elimina record"});
      if(result?.queuedOffline)showNotice("Operazione conservata nella coda locale.","warning");
      else{showNotice(inventory?"Articolo archiviato.":"Record eliminato.");if(active==="finanze")setFinanceRefreshKey(key=>key+1);await loadData(active);}
    }catch(err){showNotice(err.message,"error");}
  };
  const createInventoryMovement=(row)=>setModal({title:"Movimento di magazzino · "+row.name,endpoint:"inventory/items/"+row.id+"/movements",fields:[["movementType","Tipo movimento","select","in"],["quantity","Quantità","number","1"],["occurredAt","Data e ora","datetime-local",localDateTime()],["unitCostCents","Costo unitario (centesimi, facoltativo)","number",""],["reference","Riferimento (facoltativo)","text",""],["notes","Note","textarea",""]],transform:v=>({movementType:v.movementType,quantity:Number(v.quantity),occurredAt:new Date(v.occurredAt).toISOString(),unitCostCents:v.unitCostCents===""?null:Number(v.unitCostCents),reference:v.reference||null,notes:v.notes||null})});
const actionButton = active==="inventario"?["＋ Nuovo articolo",addInventory]:active==="finanze"?["＋ Nuova voce",addFinance]:null;
 const dataForDisplay = useMemo(()=>rows.filter(row=>JSON.stringify(row).toLowerCase().includes(query.toLowerCase())),[rows,query]);
 const displayRecord = (r)=>active==="animali"?{Nome:value(r,["name"]),Identificativo:value(r,["identifier"]),Specie:value(r,["species"]),Sesso:value(r,["sex"]),Morph:value(r,["morph"]),Stabulazione:value(r,["locationLabel"]),Stato:value(r,["status"])}:active==="inventario"?{Articolo:value(r,["name"]),Categoria:value(r,["category"]),Disponibile:value(r,["quantityOnHand"]),Unità:value(r,["unit"]),Soglia:value(r,["minimumQuantity"]),Stato:r.isActive===false?"Archiviato":"Attivo",Scorte:r.minimumQuantity==null?"Soglia non impostata":Number(r.quantityOnHand)<=Number(r.minimumQuantity)?"Sotto soglia":"Adeguate"}:active==="finanze"?{Descrizione:value(r,["description"]),Tipo:value(r,["entryType"]),Data:date(value(r,["occurredOn"],"—")),Importo:money(value(r,["amountCents"],"—")),Categoria:value(r,["category"])}:active==="alimentazioni"?{Data:date(value(r,["performedAt","fedAt","createdAt"])),Animale:value(r,["animalName","animalId"]),Esito:value(r,["outcome"]),Cibo:value(r,["foodType"]),Dettagli:value(r,["notes"])}:active==="attivita"?{Attività:value(r,["title","name"]),Scadenza:date(value(r,["dueAt"])),Stato:value(r,["status"]),Animale:value(r,["animalName"])}:active==="notifiche"?{Titolo:value(r,["title"]),Messaggio:value(r,["body"]),Data:date(value(r,["createdAt"])),Stato:value(r,["readAt"],"Non letta")}:Object.fromEntries(Object.entries(r).filter(([k,v])=>!["userId","updatedAt","createdAt","id"].includes(k)&&["string","number","boolean"].includes(typeof v)).slice(0,6).map(([k,v])=>[k.replace(/([A-Z])/g," $1"),String(v)]));
 const markTask=async(row,status)=>{try{const result=await apiRequest("tasks/"+row.id+"/complete",{method:"POST",body:{},queueWhenOffline:true,offlineOwner:user.id||user.email,offlineLabel:"Completa attività"});if(result?.queuedOffline)showNotice("Completamento in coda locale.","warning");else{showNotice("Attività aggiornata.");await loadData(active);}}catch(e){showNotice(e.message,"error");}};
 const createCare=async(type)=>{const animalId=window.prompt("ID dell’animale (UUID della scheda)");if(!animalId)return;const detail=window.prompt(type==="weights"?"Peso in grammi":type==="sheds"?"Esito della muta":"Osservazione");if(detail===null)return;let body={animalId};if(type==="weights")body={animalId,measuredAt:new Date().toISOString(),weightG:Number(detail)};if(type==="sheds")body={animalId,occurredAt:new Date().toISOString(),outcome:detail};if(type==="notes")body={animalId,occurredAt:new Date().toISOString(),category:"general",body:detail};try{await apiRequest("animals/"+animalId+"/"+(type==="weights"?"weights":type==="sheds"?"sheds":"notes"),{method:"POST",body});showNotice("Registro aggiornato.");await loadData(active);}catch(e){showNotice(e.message,"error");}};
 const doInstall=async()=>{if(!installEvent){showNotice("Usa il menu Condividi del browser e scegli “Aggiungi alla schermata Home” o “Installa app”.");return;}await installEvent.prompt();await installEvent.userChoice;setInstallEvent(null);};
 const headerTitle=active==="guide-sito"?"Tutorial per usare il sito":active==="guide-pwa"?"Tutorial per installare e usare la PWA":TITLES[active]||"Vivarqo";
 const authFlowPath = /^\/(verify-email|reset-password)\/?$/.test(window.location.pathname);if(!user || authFlowPath)return <><AuthFlowScreen onLogin={loadMe}/><Notice notice={notice}/></>;
 return <div className="app-shell"><aside className="sidebar"><div className="sidebar-brand"><Brand/><button className="mobile-close" onClick={()=>document.querySelector(".sidebar")?.classList.remove("sidebar--open")}>×</button></div><nav className="nav-groups" aria-label="Navigazione principale">{NAV_GROUPS.map(group=><details className="nav-group" key={group.id} open={group.items.includes(active) || (active==="altro" && group.id==="quotidianita") || undefined}><summary>{group.label}<span className="nav-chevron" aria-hidden="true">⌄</span></summary><div className="nav-group-items">{group.items.map(id=>{const [,label,icon,description]=NAV.find(item=>item[0]===id)||[];return <button key={id} title={description} className={"nav-item "+(active===id?"active":"")} onClick={()=>go(id)}><span className="nav-icon">{icon}</span><span>{label}</span></button>;})}</div></details>)}</nav><div className="sidebar-foot"><div className="sidebar-note"><strong>Piccoli gesti, dati preziosi.</strong><p>Registra le attività quando accadono: il tuo storico sarà più utile.</p></div><button className="user-card" onClick={()=>go("impostazioni")}><span className="avatar">{String(user.displayName||user.email||"V").slice(0,1).toUpperCase()}</span><span><strong>{user.displayName||"Il mio account"}</strong><small>{user.email}</small></span><span>···</span></button></div></aside><main className="main-content"><header className="topbar"><button className="menu-toggle" aria-label="Apri menu" onClick={()=>document.querySelector(".sidebar")?.classList.toggle("sidebar--open")}>☰</button><div><span className="breadcrumb">Vivarqo / </span><strong>{headerTitle}</strong></div><div className="topbar-right"><span className={"connection "+(online?"":"offline")}>{online?"● Online":"○ Offline"}</span><button className="install-button" onClick={doInstall}>＋ Installa PWA</button><button className="avatar avatar-button" onClick={logout} title="Esci">{String(user.displayName||user.email||"V").slice(0,1).toUpperCase()}</button></div></header><div className="page-wrap"><Notice notice={notice}/><OfflineQueuePanel owner={user.id||user.email} online={online} onNotice={showNotice}/>{!online&&<div className="notice warning">Sei offline: le modifiche compatibili vengono accodate localmente e sincronizzate quando torni online con Vivarqo aperto. Documenti, allegati, condivisioni pubbliche, notifiche push e pagamenti richiedono la connessione. Le risposte private dell’API non sono memorizzate nel service worker.</div>}
 <section className="page-heading"><div><p className="eyebrow">GESTIONE ALLEVAMENTO · {new Intl.DateTimeFormat("it-IT",{weekday:"long",day:"numeric",month:"long"}).format(new Date())}</p><h1>{active==="oggi"?"Il tuo allevamento, sotto controllo.":headerTitle}</h1><p>{active==="altro"?"Tutte le funzioni, organizzate per area.":NAV.find(n=>n[0]===active)?.[3]||"Una guida pratica per gestire il tuo allevamento."}</p></div><div className="heading-actions">{actionButton&&<Button onClick={actionButton[1]}>{actionButton[0]}</Button>}{active==="guide-pwa"&&<Button onClick={doInstall}>Installa la PWA</Button>}</div></section>
 {busy?<div className="loading"><span className="spinner"/>Caricamento dati dal server…</div>:data?.__error?<div className="error-panel"><h2>Non riesco a caricare questa sezione</h2><p>{data.__error}</p><Button variant="secondary" onClick={()=>loadData(active)}>Riprova</Button></div>:active==="guide"?<><div className="tutorial-callout"><h3>Impara a usare Vivarqo</h3><p>Qui trovi due guide: come gestire i registri dal sito e come installare la PWA sul tuo dispositivo.</p></div><p className="eyebrow tutorial-section-label">GUIDA AL SITO</p><Tutorial/><div className="tutorial-callout"><h3>Flusso consigliato</h3><p>1. Crea le schede degli animali. 2. Registra pasti, pesi, mute e note. 3. Pianifica attività e promemoria. 4. Mantieni aggiornati inventario e documenti. 5. Esporta periodicamente una copia dei dati.</p></div><p className="eyebrow tutorial-section-label">GUIDA ALLA PWA</p><Tutorial pwa/><div className="tutorial-callout"><h3>Cosa funziona offline?</h3><p>La PWA conserva solo risorse statiche già caricate. Le modifiche JSON compatibili possono essere accodate sul dispositivo e sincronizzate quando torni online con Vivarqo aperto; le risposte private dell’API non vengono messe in cache.</p><Button onClick={doInstall}>＋ Installa la PWA</Button></div></>:active==="guide-sito"?<><Tutorial/><div className="tutorial-callout"><h3>Flusso consigliato</h3><p>1. Crea le schede degli animali. 2. Registra pasti, pesi, mute e note. 3. Pianifica attività e promemoria. 4. Mantieni aggiornati inventario e documenti. 5. Esporta periodicamente una copia dei dati.</p></div></>:active==="guide-pwa"?<><Tutorial pwa/><div className="tutorial-callout"><h3>Cosa funziona offline?</h3><p>La PWA può conservare alcune risorse statiche già caricate. Le risposte private dell’API non vengono memorizzate dal service worker. Le modifiche JSON compatibili possono essere accodate sul dispositivo e sincronizzate quando torni online con Vivarqo aperto. File e pagamenti restano online-only.</p><Button onClick={doInstall}>＋ Installa la PWA</Button></div></>:active==="altro"?<MoreHub onGo={go}/>:active==="oggi"?<Dashboard data={data} onGo={go} onRetry={()=>loadData("oggi")}/>:active==="riproduzioni"?<ReproductionHub owner={user.id||user.email} onNotice={showNotice}/>:active==="documenti"?<DocumentsHub owner={user.id||user.email} onNotice={showNotice}/>:active==="notifiche"?<NotificationsHub owner={user.id||user.email} onNotice={showNotice}/>:active==="cure"?<CareRecordsHub owner={user.id||user.email} onNotice={showNotice} initialTab="weights"/>:active==="alimentazioni"?<CareRecordsHub owner={user.id||user.email} onNotice={showNotice} initialTab="feedings"/>:active==="genetica"?<CareRecordsHub owner={user.id||user.email} onNotice={showNotice} initialTab="genetics"/>:active==="peso"||active==="mute"||active==="note"?<CareRecordsHub owner={user.id||user.email} onNotice={showNotice} initialTab={active==="peso"?"weights":active==="mute"?"sheds":"notes"}/>:active==="animali"?<AnimalsHub owner={user.id||user.email} onNotice={showNotice} onGo={go}/>:active==="attivita"?<CalendarHub onNotice={showNotice}/>:active==="abbonamento"?<BillingHub onNotice={showNotice}/>:active==="inventario"?<><Records active={active} data={data} rows={dataForDisplay} onSearch={updateRecordSearch} query={query} onCare={createCare} onReload={()=>loadData(active)} onTask={markTask} onGo={go} onEdit={openEditRecord} onDelete={deleteRecord} onMovement={createInventoryMovement} onHistory={setHistoryItem} onPageChange={page=>setListPages(p=>({...p,[active]:page}))}/><InventoryMovementHistory item={historyItem} onClose={()=>setHistoryItem(null)}/></>:active==="finanze"?<><FinanceSummary onNotice={showNotice}/><Records active={active} data={data} rows={dataForDisplay} onSearch={updateRecordSearch} query={query} onCare={createCare} onReload={()=>loadData(active)} onTask={markTask} onGo={go} onEdit={openEditRecord} onDelete={deleteRecord} onPageChange={page=>setListPages(p=>({...p,[active]:page}))}/></>:active==="dati"?<DataTools onNotice={showNotice}/>:active==="impostazioni"?<SettingsPage user={user} onNotice={showNotice}/>:active==="finanze"?<><FinanceSummary onNotice={showNotice} refreshKey={financeRefreshKey}/><Records active={active} data={data} rows={dataForDisplay} onSearch={updateRecordSearch} query={query} onCare={createCare} onReload={()=>loadData(active)} onTask={markTask} onGo={go} onEdit={openEditRecord} onDelete={deleteRecord} onPageChange={page=>setListPages(p=>({...p,[active]:page}))}/></>:active==="inventario"?<><InventoryFilters filters={inventoryFilters} onChange={updateInventoryFilter} onReset={resetInventoryFilters}/><Records active={active} data={data} rows={dataForDisplay} onSearch={updateRecordSearch} query={query} onCare={createCare} onReload={()=>loadData(active)} onTask={markTask} onGo={go} onEdit={openEditRecord} onDelete={deleteRecord} onHistory={setHistoryItem} onMovement={createInventoryMovement} onPageChange={page=>setListPages(p=>({...p,[active]:page}))}/>{historyItem&&<InventoryMovementHistory item={historyItem} onClose={()=>setHistoryItem(null)}/>}</>:<Records active={active} data={data} rows={dataForDisplay} onSearch={updateRecordSearch} query={query} onCare={createCare} onReload={()=>loadData(active)} onTask={markTask} onGo={go} onEdit={openEditRecord} onDelete={deleteRecord} onMovement={createInventoryMovement} onPageChange={page=>setListPages(p=>({...p,[active]:page}))}/>}
 <footer className="page-footer"><span>Vivarqo · Crescere con cura.</span><span>Sessione protetta · Dati caricati dal backend</span></footer></div></main>{modal&&<Modal modal={modal} onClose={()=>setModal(null)} onSubmit={saveEntity}/>}<nav className="mobile-nav" aria-label="Navigazione rapida">{[["oggi","⌂","Oggi"],["animali","♧","Animali"],["alimentazioni","◉","Pasti"],["attivita","◷","Attività"],["altro","•••","Altro"]].map(([id,icon,label])=><button key={id} className={active===id || (id==="altro" && !["oggi","animali","alimentazioni","attivita"].includes(active))?"active":""} onClick={()=>go(id)}><span>{icon}</span>{label}</button>)}</nav></div>;
}

function InventoryFilters({filters,onChange,onReset}) {
 return <section className="panel inventory-filter-panel" aria-labelledby="inventory-filters-title">
  <div className="panel-heading"><div><p className="eyebrow">CONTROLLO SCORTE</p><h2 id="inventory-filters-title">Filtra inventario</h2><p className="subheading">Individua articoli attivi, archiviati o con quantità sotto la soglia minima.</p></div><Button variant="secondary" onClick={onReset}>Azzera filtri</Button></div>
  <div className="form-grid">
   <SelectField label="Stato articoli" value={filters.active} onChange={event=>onChange("active",event.target.value)}>
    <option value="true">Solo attivi</option><option value="false">Solo archiviati</option><option value="all">Tutti gli articoli</option>
   </SelectField>
   <SelectField label="Categoria" value={filters.category} onChange={event=>onChange("category",event.target.value)}>
    <option value="">Tutte le categorie</option><option value="food">Alimenti</option><option value="substrate">Substrati</option><option value="material">Materiali</option><option value="equipment">Attrezzatura</option><option value="other">Altro</option>
   </SelectField>
   <label className="check-row form-full"><input type="checkbox" checked={filters.lowStock} onChange={event=>onChange("lowStock",event.target.checked)}/><span>Mostra solo articoli sotto la soglia minima</span></label>
  </div>
 </section>;
}

function MoreHub({onGo}) {
 return <div className="more-hub">{NAV_GROUPS.map(group=><section className="more-category" key={group.id}><div className="more-category-heading"><p className="eyebrow">{group.label}</p><span>{group.items.length} {group.items.length===1?"sezione":"sezioni"}</span></div><div className="more-grid">{group.items.map(id=>{const [,label,icon,description]=NAV.find(item=>item[0]===id)||[];return <button className="more-card" key={id} onClick={()=>onGo(id)}><span className="more-icon" aria-hidden="true">{icon}</span><span className="more-copy"><strong>{label}</strong><small>{description}</small></span><span className="more-arrow" aria-hidden="true">↗</span></button>;})}</div></section>)}</div>;
}

function Dashboard({data,onGo,onRetry}) {
 const due=asArray(data?.dueToday),overdue=asArray(data?.overdue),recent=asArray(data?.recentFeedings);
 const [operational,setOperational]=useState({stock:[],cycles:[],stockLoaded:false,cyclesLoaded:false});
 useEffect(()=>{
  let live=true;
  Promise.allSettled([
   apiRequest("inventory/items?page=1&pageSize=8&active=true&lowStock=true"),
   apiRequest("reproduction-cycles?page=1&pageSize=100")
  ]).then(([stockResult,cyclesResult])=>{
   if(!live)return;
   setOperational({
    stock:stockResult.status==="fulfilled"?asArray(stockResult.value).filter(item=>item.isActive!==false&&item.minimumQuantity!=null&&Number(item.quantityOnHand)<=Number(item.minimumQuantity)):[],
    cycles:cyclesResult.status==="fulfilled"?asArray(cyclesResult.value).filter(item=>["active","planned"].includes(item.status)).slice(0,5):[],
    stockLoaded:stockResult.status==="fulfilled",
    cyclesLoaded:cyclesResult.status==="fulfilled"
   });
  });
  return ()=>{live=false;};
 },[]);
 const taskAnimalNames=[...overdue,...due].map(task=>task.animal?.name||task.animalName||task.animal?.displayName).filter(Boolean);
 const animalsToCheck=[...new Set(taskAnimalNames)];
 const stat=[["Animali registrati",value(data,["animalCount","totalAnimals"],"—"),"Schede nel tuo account"],["Da fare oggi",value(data,["dueTodayCount"],due.length),"Attività in scadenza"],["In ritardo",value(data,["overdueCount"],overdue.length),"Da verificare"],["Pasti recenti",recent.length,"Ultimi 7 giorni"]];
 return <div className="operational-dashboard">
  <div className="stats-grid">{stat.map(([label,val,caption],i)=><article className={"stat-card tone-"+i} key={label}><span>{label}</span><strong>{val}</strong><small>{caption}</small></article>)}</div>
  <div className="dashboard-grid">
   <section className="panel dashboard-focus"><div className="panel-heading"><div><p className="eyebrow">PRIORITÀ</p><h2>Da fare e da recuperare</h2><p className="subheading">Prima le scadenze superate, poi quelle di oggi.</p></div><Button variant="quiet" onClick={()=>onGo("attivita")}>Calendario ↗</Button></div>
    {due.length+overdue.length===0?<div className="dashboard-empty"><span className="status-mark">✓</span><div><strong>Nessuna scadenza segnalata</strong><p>Non risultano attività in ritardo o in scadenza nei dati restituiti dal server.</p></div></div>:<div className="task-list">{[...overdue,...due].slice(0,10).map((task,i)=><article className="task-row" key={task.id||i}><span className={"task-bullet "+(i<overdue.length?"is-overdue":"")}>{i<overdue.length?"!":"•"}</span><div><strong>{value(task,["title","name"],"Attività")}</strong><small>{task.animal?.name||value(task,["description"],"Promemoria")} · {date(value(task,["dueAt","scheduledAt"]))}</small></div><span className={"pill "+(i<overdue.length?"danger":"sage")}>{i<overdue.length?"In ritardo":"Oggi"}</span></article>)}</div>}
    {animalsToCheck.length>0&&<div className="dashboard-inline-note"><strong>Animali collegati alle scadenze</strong><div className="tag-list">{animalsToCheck.slice(0,8).map(name=><span className="data-tag" key={name}>{name}</span>)}</div></div>}
   </section>
   <section className="panel dashboard-actions"><p className="eyebrow">AZIONI FREQUENTI</p><h2>Registra in pochi passaggi</h2><div className="dashboard-action-grid">{[["＋","Nuovo animale","animali"],["◉","Registra alimentazione","alimentazioni"],["↗","Peso, muta o nota","cure"],["◷","Nuova attività","attivita"]].map(([icon,label,id])=><button className="dashboard-action" key={id} onClick={()=>onGo(id)}><span>{icon}</span><strong>{label}</strong><b aria-hidden="true">↗</b></button>)}</div><div className="dashboard-inline-links"><button onClick={()=>onGo("inventario")}>Apri inventario</button><button onClick={()=>onGo("riproduzioni")}>Apri riproduzioni</button></div></section>
  </div>
  <div className="dashboard-ops-grid">
   <section className="panel"><div className="panel-heading"><div><p className="eyebrow">ANIMALI</p><h2>Chi richiede attenzione</h2></div><Button variant="quiet" onClick={()=>onGo("animali")}>Apri elenco ↗</Button></div>
    {animalsToCheck.length>0?<div className="task-list">{animalsToCheck.slice(0,6).map(name=><div className="compact-info-row" key={name}><span className="mini-status-dot"/><strong>{name}</strong><span className="muted">Collegato a una scadenza</span></div>)}</div>:<p className="dashboard-helper">Quando un promemoria contiene un animale associato, il suo nome compare qui. Per evitare falsi allarmi, non vengono inventati controlli senza una scadenza registrata.</p>}
   </section>
   <section className="panel"><div className="panel-heading"><div><p className="eyebrow">ALIMENTAZIONI</p><h2>Ultimi pasti</h2></div><Button variant="quiet" onClick={()=>onGo("alimentazioni")}>Registro ↗</Button></div>
    {recent.length===0?<p className="dashboard-helper">Nessuna alimentazione recente restituita dal riepilogo.</p>:<div className="task-list">{recent.slice(0,5).map((item,i)=>{const entries=asArray(item.entries);const animalNames=entries.map(entry=>entry.animal?.name).filter(Boolean);const foods=Array.from(new Set(entries.map(entry=>entry.foodType).filter(Boolean)));return <div className="compact-info-row" key={item.id||i}><span className="feeding-dot">◉</span><div className="compact-info-copy"><strong>{animalNames.join(", ")||"Sessione di alimentazione"}</strong><small>{date(value(item,["performedAt","fedAt","createdAt"]))} · {foods.join(", ")||value(item,["notes"],"Pasto registrato")}</small></div></div>;})}</div>}
    <Button variant="secondary" onClick={()=>onGo("alimentazioni")}>＋ Registra alimentazione</Button>
   </section>
   <section className="panel"><div className="panel-heading"><div><p className="eyebrow">SCORTE</p><h2>Sotto soglia</h2></div><Button variant="quiet" onClick={()=>onGo("inventario")}>Inventario ↗</Button></div>
    {!operational.stockLoaded?<p className="dashboard-helper">Stato scorte non disponibile. Apri l’inventario per aggiornare i dati.</p>:operational.stock.length===0?<p className="dashboard-helper">Nessun articolo sotto soglia tra quelli restituiti dal server.</p>:<div className="task-list">{operational.stock.slice(0,5).map(item=><div className="compact-info-row" key={item.id}><span className="stock-warning">!</span><div className="compact-info-copy"><strong>{item.name}</strong><small>{item.quantityOnHand} {item.unit||""} disponibili · soglia {item.minimumQuantity}</small></div></div>)}</div>}
   </section>
   <section className="panel"><div className="panel-heading"><div><p className="eyebrow">RIPRODUZIONE</p><h2>Cicli da seguire</h2></div><Button variant="quiet" onClick={()=>onGo("riproduzioni")}>Apri ↗</Button></div>
    {!operational.cyclesLoaded?<p className="dashboard-helper">Non è stato possibile leggere i cicli riproduttivi in questo momento.</p>:operational.cycles.length===0?<p className="dashboard-helper">Nessun ciclo pianificato o in corso restituito dal server.</p>:<div className="task-list">{operational.cycles.map(cycle=><div className="compact-info-row" key={cycle.id}><span className="cycle-dot">✳</span><div className="compact-info-copy"><strong>{cycle.name||"Ciclo riproduttivo"}</strong><small>{cycle.parentA?.name||"Genitore A —"} × {cycle.parentB?.name||"Genitore B —"} · {cycle.status==="active"?"In corso":"Pianificato"}</small></div></div>)}</div>}
   </section>
  </div>
  <div className="dashboard-footnote">Dati personali del tuo account. Le liste mostrano ciò che il server restituisce, senza creare record dimostrativi.</div>
 </div>;
}
function Records({active,data,rows,onSearch,query,onCare,onReload,onTask,onGo,onEdit,onDelete,onMovement,onHistory,onPageChange}) {
 const titles={animali:"Schede animali",inventario:"Scorte e materiali",alimentazioni:"Storico alimentazioni",attivita:"Attività e promemoria",finanze:"Entrate e uscite",notifiche:"Centro notifiche",riproduzioni:"Riproduzioni",documenti:"Documenti e condivisioni",genetica:"Morph e genetica",peso:"Storico pesi",mute:"Storico mute",note:"Osservazioni"};
 const shown=rows.map(r=>({raw:r,display:active==="animali"?{Nome:value(r,["name"]),Identificativo:value(r,["identifier"]),Specie:value(r,["species"]),Sesso:value(r,["sex"]),Morph:value(r,["morph"]),Stabulazione:value(r,["locationLabel"]),Stato:value(r,["status"])}:active==="inventario"?{Articolo:value(r,["name"]),Categoria:value(r,["category"]),Quantità:value(r,["quantityOnHand"]),Unità:value(r,["unit"]),Soglia:value(r,["minimumQuantity"]),Stato:r.isActive===false?"Archiviato":"Attivo",Scorte:r.minimumQuantity==null?"Soglia non impostata":Number(r.quantityOnHand)<=Number(r.minimumQuantity)?"Sotto soglia":"Adeguate"}:active==="alimentazioni"?{Data:date(value(r,["performedAt","fedAt","createdAt"])),Animale:value(r,["animalName","animalId"]),Esito:value(r,["outcome"]),Cibo:value(r,["foodType"]),Note:value(r,["notes"])}:active==="attivita"?{Attività:value(r,["title","name"]),Scadenza:date(value(r,["dueAt"])),Categoria:value(r,["category"]),Stato:value(r,["status"]),Descrizione:value(r,["description"])}:active==="finanze"?{Descrizione:value(r,["description"]),Tipo:value(r,["entryType"]),Data:date(value(r,["occurredOn"])),Importo:money(value(r,["amountCents"])),Categoria:value(r,["category"])}:active==="notifiche"?{Titolo:value(r,["title"]),Messaggio:value(r,["body"]),Data:date(value(r,["createdAt"])),Stato:r.readAt?"Letta":"Non letta"}:Object.fromEntries(Object.entries(r).filter(([k,v])=>!["userId","updatedAt","createdAt","id"].includes(k)&&["string","number","boolean"].includes(typeof v)).slice(0,6).map(([k,v])=>[k.replace(/([A-Z])/g," $1"),String(v)]))}));
 return <section className="panel records-panel"><div className="panel-heading"><div><p className="eyebrow">DATI DEL TUO ACCOUNT</p><h2>{titles[active]||TITLES[active]||active}</h2><p className="subheading">Dati reali restituiti dall’API. Le azioni rispettano l’account autenticato.</p></div><Button variant="secondary" onClick={onReload}>↻ Aggiorna</Button></div>{["animali","inventario","alimentazioni","attivita","finanze"].includes(active)&&<input className="search-input" type="search" placeholder="Cerca in tutti i record…" value={query} onChange={e=>onSearch(e.target.value)} aria-label="Cerca nei risultati"/>}{shown.length===0?<div className="empty-state"><span>⌁</span><h3>Nessun dato trovato</h3><p>Se è il tuo primo accesso, inizia aggiungendo i tuoi dati. Se hai già registrazioni, aggiorna la sezione o controlla i filtri.</p></div>:<div className="table-wrap"><table><thead><tr>{Object.keys(shown[0].display).map(k=><th key={k}>{k}</th>)}<th>Azioni</th></tr></thead><tbody>{shown.map(({raw,display},i)=><tr key={raw.id||i}>{Object.entries(display).map(([k,v])=><td key={k}>{String(v)}</td>)}<td><div className="inline-actions">{onEdit&&<Button onClick={()=>onEdit(raw)}>Modifica</Button>}{active==="attivita"&&<Button onClick={()=>onTask(raw,"complete")}>Completa</Button>}{active==="inventario"&&onHistory&&<Button onClick={()=>onHistory(raw)}>Storico movimenti</Button>}{active==="inventario"&&onMovement&&<Button onClick={()=>onMovement(raw)}>Movimento</Button>}{onDelete&&<Button variant="danger" onClick={()=>onDelete(raw)}>{active==="inventario"?"Archivia":"Elimina"}</Button>}</div></td></tr>)}</tbody></table></div>}{data?.pagination&&<div className="pagination-bar"><span className="muted">Pagina {data.pagination.page||1} di {Math.max(1,data.pagination.totalPages||1)} · {data.pagination.total??shown.length} risultati</span><div className="inline-actions"><Button disabled={(data.pagination.page||1)<=1} onClick={()=>onPageChange?.(Math.max(1,(data.pagination.page||1)-1))}>← Precedente</Button><Button disabled={(data.pagination.page||1)>=(data.pagination.totalPages||1)} onClick={()=>onPageChange?.((data.pagination.page||1)+1)}>Successiva →</Button></div></div>}</section>;
}
function CareHub({onCare}){return <div className="care-grid">{[["weights","Peso","Registra il peso in grammi e confronta lo storico."],["sheds","Mute","Annota esito e data della muta."],["notes","Osservazioni","Aggiungi una nota alla scheda dell’animale."]].map(([type,title,desc])=><article className="panel care-card" key={type}><span className="care-symbol">＋</span><h2>{title}</h2><p>{desc}</p><Button onClick={()=>onCare(type)}>Nuova registrazione</Button></article>)}</div>;}
function DataTools({onNotice}) {
  const [file, setFile] = useState(null);
  const [entity, setEntity] = useState("animals");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [includeDocs, setIncludeDocs] = useState(false);
  const [exportJob, setExportJob] = useState(null);
  const entities = [["animals","Animali"],["weights","Pesate"],["sheds","Mute"],["notes","Note"],["feedings","Alimentazioni"],["finance","Finanze"],["inventory","Inventario"],["reproductionCycles","Cicli riproduttivi"],["reproductiveEvents","Eventi riproduttivi"],["clutches","Covate"],["eggs","Uova"],["incubationLogs","Controlli d’incubazione"],["offspringBatches","Lotti di piccoli"]];
  const upload = async e => {
    e.preventDefault();
    if (!file) return onNotice("Scegli prima un file CSV o XLSX.", "error");
    setBusy(true);
    try {
      const result = await apiUpload("imports?entity=" + encodeURIComponent(entity), file);
      setPreview(result);
      onNotice("Anteprima pronta: nessun dato importato ancora.");
    } catch (error) { onNotice(error.message, "error"); }
    finally { setBusy(false); }
  };
  const downloadWhenReady = async id => {
    setBusy(true);
    try {
      const result = await apiRequest("exports/" + encodeURIComponent(id));
      setExportJob({ ...result.export, ready: result.ready });
      if (result.ready) window.location.assign("/api/v1/exports/" + encodeURIComponent(id) + "/download");
      else onNotice("L'esportazione non è ancora pronta. Verifica nuovamente lo stato tra poco.", "warning");
    } catch (error) { onNotice(error.message, "error"); }
    finally { setBusy(false); }
  };
  const exportData = async () => {
    setBusy(true);
    try {
      const result = await apiRequest("exports", { method: "POST", body: { includeDocuments: includeDocs } });
      const id = result?.export?.id;
      if (!id) throw new Error("Il server non ha restituito l'identificativo dell'esportazione.");
      setExportJob({ ...result.export, ready: false });
      const status = await apiRequest("exports/" + encodeURIComponent(id));
      setExportJob({ ...status.export, ready: status.ready });
      if (status.ready) window.location.assign("/api/v1/exports/" + encodeURIComponent(id) + "/download");
      else onNotice("L'esportazione non è ancora pronta. Verifica nuovamente lo stato tra poco.", "warning");
    } catch (error) { onNotice(error.message, "error"); }
    finally { setBusy(false); }
  };
  const confirmImport = async () => {
    if (!preview) return;
    const possibleDuplicates = Array.isArray(preview.possibleDuplicates) ? preview.possibleDuplicates : [];
    let body = {};
    if (entity === "animals" && possibleDuplicates.length > 0) {
      const accepted = window.confirm("L'anteprima segnala " + possibleDuplicates.length + " possibili duplicati per nome e specie. Procedere comunque con l'importazione? Gli identificativi già esistenti saranno comunque verificati dal server.");
      if (!accepted) return;
      body = { allowPossibleDuplicates: true };
    }
    setBusy(true);
    try {
      const id = preview.importId || preview.id || preview.import?.id;
      if (!id) throw new Error("L'anteprima non contiene un identificativo d'importazione valido.");
      await apiRequest("imports/" + id + "/confirm", { method: "POST", body });
      setPreview(null);
      onNotice("Importazione completata.");
    } catch (error) { onNotice(error.message, "error"); }
    finally { setBusy(false); }
  };
  const statusLabel = status => ({ pending: "In attesa", processing: "In elaborazione", completed: "Completata", failed: "Non riuscita" }[status] || status || "Sconosciuto");
  return <div className="transfer-grid">
    <section className="panel">
      <p className="eyebrow">IMPORT GUIDATO</p><h2>Importa dati esistenti</h2>
      <p>Carica CSV o XLSX. Prima di confermare controlla l'anteprima e gli eventuali errori.</p>
      <form className="form-stack" onSubmit={upload}>
        <SelectField label="Tipo di dati" value={entity} onChange={e => { setEntity(e.target.value); setPreview(null); }}>
          {entities.map(([id,label]) => <option key={id} value={id}>{label}</option>)}
        </SelectField>
        <Field label="File CSV o XLSX" type="file" accept=".csv,.xlsx" onChange={e => setFile(e.target.files?.[0] || null)} required/>
        <Button disabled={busy}>{busy ? "Elaborazione…" : "Crea anteprima"}</Button>
      </form>
      {preview && <div className="import-result">
        <h3>Anteprima importazione</h3>
        <p>Righe totali: {preview.totalRows ?? "—"} · valide: {preview.validRows ?? "—"} · errori: {preview.invalidRows ?? "—"}</p>
        {entity === "animals" && Array.isArray(preview.possibleDuplicates) && preview.possibleDuplicates.length > 0 && <div className="notice warning"><strong>Possibili duplicati rilevati ({preview.possibleDuplicates.length}).</strong><p>Controlla le righe segnalate: la conferma richiederà un'ulteriore autorizzazione esplicita.</p></div>}
        {(preview.errors || []).slice(0,20).map((error, index) => <p key={index} className="error-text">Riga {error.row}: {error.column} — {error.reason}</p>)}
        <Button onClick={confirmImport} disabled={busy || !preview.validRows}>Conferma importazione</Button>
      </div>}
    </section>
    <section className="panel">
      <p className="eyebrow">PORTABILITÀ</p><h2>Esporta il tuo account</h2>
      <p>Genera un archivio privato con identificativi e relazioni. Gli archivi possono contenere dati personali.</p>
      <label className="check-row"><input type="checkbox" checked={includeDocs} onChange={e => setIncludeDocs(e.target.checked)}/> Includi documenti e allegati</label>
      <Button onClick={exportData} disabled={busy}>Genera e scarica archivio ZIP</Button>
      {exportJob && <div className="import-result">
        <p>Stato esportazione: <strong>{statusLabel(exportJob.status)}</strong>{exportJob.expiresAt ? " · Scadenza: " + date(exportJob.expiresAt) : ""}</p>
        <Button onClick={() => void downloadWhenReady(exportJob.id)} disabled={busy}>Verifica stato / scarica archivio</Button>
      </div>}
      <p className="muted">Lo stato viene verificato con il backend prima di iniziare il download.</p>
    </section>
  </div>;
}
function SettingsPage({user,onNotice}){const [displayName,setName]=useState(user.displayName||""),[locale,setLocale]=useState(user.locale||"it"),[timezone,setTimezone]=useState(user.timezone||"Europe/Rome"),[currentPassword,setCurrent]=useState(""),[newPassword,setNew]=useState(""),[email,setEmail]=useState(user.email||""),[busy,setBusy]=useState(false);const save=async(e)=>{e.preventDefault();setBusy(true);try{const body={displayName,locale,timezone};if(email!==user.email||newPassword){body.email=email;body.currentPassword=currentPassword;if(newPassword)body.newPassword=newPassword;}const r=await apiRequest("account",{method:"PATCH",body});onNotice(r.message||"Impostazioni aggiornate.");setCurrent("");setNew("");}catch(err){onNotice(err.message,"error");}finally{setBusy(false);}};return <section className="panel settings-panel"><p className="eyebrow">PROFILO E SICUREZZA</p><h2>Impostazioni account</h2><form className="form-grid" onSubmit={save}><Field label="Nome visualizzato" value={displayName} onChange={e=>setName(e.target.value)} required maxLength="120"/><Field label="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)} required/><SelectField label="Lingua" value={locale} onChange={e=>setLocale(e.target.value)}><option value="it">Italiano</option><option value="en">English</option></SelectField><Field label="Fuso orario IANA" value={timezone} onChange={e=>setTimezone(e.target.value)} required/><Field label="Password attuale (per modifiche sensibili)" type="password" value={currentPassword} onChange={e=>setCurrent(e.target.value)} autoComplete="current-password"/><Field label="Nuova password (facoltativa)" type="password" value={newPassword} onChange={e=>setNew(e.target.value)} autoComplete="new-password" minLength="12"/><div className="form-full"><Button disabled={busy}>{busy?"Salvataggio…":"Salva impostazioni"}</Button></div></form><div className="security-actions"><Button variant="secondary" onClick={async()=>{if(!window.confirm("Revocare tutte le sessioni? Potresti dover accedere di nuovo."))return;try{await apiRequest("auth/sessions/revoke-all",{method:"POST",body:{}});onNotice("Sessioni revocate. Esci e accedi di nuovo.");}catch(e){onNotice(e.message,"error");}}}>Revoca tutte le sessioni</Button></div></section>;}
function Modal({modal,onClose,onSubmit}){return <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="panel-heading"><h2 id="modal-title">{modal.title}</h2><button className="close-button" onClick={onClose} aria-label="Chiudi">×</button></div><form className="form-grid" onSubmit={onSubmit}>{modal.fields.map(([name,label,type,initial])=><div className={type==="textarea"?"form-full":""} key={name}>{type==="select"?<SelectField label={label} name={name} defaultValue={initial} required>{(name==="sex"?[["unknown","Non specificato"],["male","Maschio"],["female","Femmina"]]:name==="category"?[["food","Alimenti"],["substrate","Substrati"],["material","Materiali"],["equipment","Attrezzatura"],["other","Altro"]]:name==="taskCategory"?[["feeding","Alimentazioni"],["weighing","Peso"],["shed_check","Muta"],["cleaning","Pulizia"],["reproduction","Riproduzione"],["document","Documenti"],["inventory","Inventario"],["custom","Personalizzata"]]:name==="movementType"?[["in","Carico"],["out","Scarico"],["adjustment","Rettifica"]]:name==="entryType"?[["income","Entrata"],["expense","Uscita"]]:[]).map(([v,l])=><option key={v} value={v}>{l}</option>)}</SelectField>:type==="textarea"?<label className="field"><span>{label}</span><textarea name={name} rows="3" defaultValue={initial}/></label>:<Field label={label} name={name} type={type} defaultValue={initial} step={type==="number"?"0.001":undefined} required={!label.includes("facoltativo")&&name!=="minimumQuantity"&&name!=="unitCostCents"}/>}</div>)}<div className="form-actions form-full"><Button type="button" variant="secondary" onClick={onClose}>Annulla</Button><Button>Salva</Button></div></form></section></div>;}
export default App;
