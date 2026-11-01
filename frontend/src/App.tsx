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
import { QuickEntryDialog, type QuickEntryKind } from "./components/QuickEntryDialog";
import { Records } from "./components/Records";
import { DataTools } from "./components/DataTools";
import { SettingsPage } from "./components/SettingsPage";
import { Tutorial } from "./components/Tutorial";
import { InventoryFilters } from "./components/InventoryFilters";
import { MoreHub } from "./components/MoreHub";
import { useConfirmDialog } from "./ui/ConfirmDialog";
import { useRef } from "react";
import { Modal, type ModalForm } from "./app/AppModals";
import type { AnyRecord, AccountUser, InventoryFiltersState, NoticeKind } from "./types";
import { errorMessage } from "./types";
import { readFormValues } from "./types";
import { getIntlLocale, getLocale, setLocale, t } from "./i18n";
import { AppShell } from "./app/AppShell";
import { DESCRIPTIONS, NAV, NAV_GROUPS, NAV_MORE_GROUPS, TITLES } from "./app/navigation";
import { useAppData } from "./app/useAppData";
import { useAppNavigation } from "./app/useAppNavigation";
import { useAppPreferences } from "./app/useAppPreferences";

const value = (obj: AnyRecord | null | undefined, keys: string[], fallback="—") => { for (const k of keys) if (obj?.[k] !== undefined && obj?.[k] !== null && obj?.[k] !== "") return obj[k]; return fallback; };
const date = (v: string | number | Date | null | undefined) => { if (!v || v==="—") return "—"; const d=new Date(v); return Number.isNaN(d.getTime())?String(v):new Intl.DateTimeFormat(getIntlLocale(),{dateStyle:"medium"}).format(d); };
const localDateTime = (v?: string | Date | null) => { const d=v?new Date(v):new Date(); if(Number.isNaN(d.getTime()))return ""; const p=(n:number)=>String(n).padStart(2,"0"); return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+"T"+p(d.getHours())+":"+p(d.getMinutes()); };
const money = (v: string | number | null | undefined) => { if (v === null || v === undefined || v === "" || v === "—") return "—"; const n = Number(v); return Number.isFinite(n) ? new Intl.NumberFormat(getIntlLocale(), { style: "currency", currency: "EUR" }).format(n / 100) : "—"; };

function Button({children,variant="",...props}: React.ButtonHTMLAttributes<HTMLButtonElement> & {variant?:string}){return <button className={"button "+variant} {...props}>{typeof children==="string"?t(children):children}</button>;}
function Notice({notice}:{notice:{text:string;kind?:NoticeKind}|null}){return notice?<div className={"notice "+(notice.kind||"info")} role="status">{notice.text}</div>:null;}




type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
type NoticeState = { text: string; kind: NoticeKind };

function App() {
const [,setLocaleVersion]=useState(0);
const [user,setUser]=useState<AccountUser|null>(null),[notice,setNotice]=useState<NoticeState|null>(null),[query,setQuery]=useState(""),[modal,setModal]=useState<ModalForm|null>(null),[installEvent,setInstallEvent]=useState<BeforeInstallPromptEvent|null>(null),[online,setOnline]=useState(navigator.onLine),[listPages,setListPages]=useState<Record<string,number>>({}),[historyItem,setHistoryItem]=useState<AnyRecord|null>(null),[pwaUpdateRegistration,setPwaUpdateRegistration]=useState<ServiceWorkerRegistration|null>(null);
 const [inventoryFilters,setInventoryFilters]=useState<InventoryFiltersState>({active:"true",category:"",lowStock:false});
 const [financeRefreshKey,setFinanceRefreshKey]=useState(0);
 const [quickEntryKind,setQuickEntryKind]=useState<QuickEntryKind|null>(null);
 const [dashboardRefreshKey,setDashboardRefreshKey]=useState(0);
 const confirmAction=useConfirmDialog();
 const noticeTimer=useRef<number | null>(null);
 const resetNavigationState=useCallback(()=>{setQuery("");setModal(null);setHistoryItem(null);},[]);
 const {active,targetAnimalId,go}=useAppNavigation(resetNavigationState);
 const {measurementPreferences}=useAppPreferences(user);
 const handleUnauthorized=useCallback(()=>setUser(null),[]);
 const {data,busy,rows,loadData,clearData}=useAppData({user,active,query,listPages,inventoryFilters,onUnauthorized:handleUnauthorized});
 useEffect(()=>{const onLocaleChange=(event:Event)=>{setLocaleVersion(version=>version+1);const locale=(event as CustomEvent<"it"|"en">).detail;setUser(current=>current?{...current,locale}:current);};window.addEventListener("vivarqo:locale-change",onLocaleChange);return()=>window.removeEventListener("vivarqo:locale-change",onLocaleChange);},[]);
 const showNotice=useCallback((text: string,kind: NoticeKind="info")=>{setNotice({text:t(text),kind});if(noticeTimer.current)window.clearTimeout(noticeTimer.current);noticeTimer.current=window.setTimeout(()=>setNotice(null),5000);},[]);
 useEffect(()=>{const onInstall=(event:Event)=>{event.preventDefault();setInstallEvent(event as BeforeInstallPromptEvent);};const onOnline=()=>setOnline(true);const onOffline=()=>setOnline(false);window.addEventListener("beforeinstallprompt",onInstall);window.addEventListener("online",onOnline);window.addEventListener("offline",onOffline);return()=>{window.removeEventListener("beforeinstallprompt",onInstall);window.removeEventListener("online",onOnline);window.removeEventListener("offline",onOffline);};},[]);
 useEffect(()=>{const onUpdateReady=(event: Event)=>setPwaUpdateRegistration((event as CustomEvent<{registration?: ServiceWorkerRegistration}>).detail?.registration??null);window.addEventListener("vivarqo:pwa-update-ready",onUpdateReady);return()=>window.removeEventListener("vivarqo:pwa-update-ready",onUpdateReady);},[]);
 const loadMe=useCallback(async()=>{try{const r=await apiRequest("auth/me");const accountUser=(r.user??r) as AccountUser;setUser(accountUser);if(accountUser.locale==="it"||accountUser.locale==="en")setLocale(accountUser.locale);return true;}catch(e){setUser(null);return false;}},[]);
 useEffect(()=>{void loadMe();},[loadMe]);

 
 const logout=async()=>{try{await apiRequest("auth/logout",{method:"POST",body:{}});}catch{}setUser(null);clearData();go("oggi");showNotice("Hai terminato la sessione.");};
 const updateLocale=useCallback(async(nextLocale:"it"|"en")=>{
   const previous=getLocale();
   setLocale(nextLocale);
   try{await apiRequest("account",{method:"PATCH",body:{locale:nextLocale}});}
   catch(error){setLocale(previous);showNotice(errorMessage(error),"error");}
 },[showNotice]);
 const updateInventoryFilter=(name:keyof InventoryFiltersState,value:string|boolean)=>{setInventoryFilters(current=>name==="lowStock"?{...current,lowStock:Boolean(value)}:{...current,[name]:String(value)});setListPages(current=>({...current,inventario:1}));setHistoryItem(null);};
 const resetInventoryFilters=()=>{setInventoryFilters({active:"true",category:"",lowStock:false});setListPages(current=>({...current,inventario:1}));setHistoryItem(null);};
 const updateRecordSearch=(next:string)=>{setQuery(next);setListPages(current=>({...current,[active]:1}));};
 const saveEntity=async(e:React.FormEvent<HTMLFormElement>)=>{e.preventDefault();const raw=readFormValues(e.currentTarget);const currentModal=modal;if(!currentModal)return;const {endpoint,method="POST",transform}=currentModal;try{await apiRequest(endpoint,{method,body:transform?transform(raw):raw});setModal(null);showNotice("Modifiche salvate.");if(active==="finanze")setFinanceRefreshKey(key=>key+1);await loadData(active);}catch(err){showNotice(errorMessage(err),"error");}};
 const addAnimal=()=>setModal({title:"Nuovo animale",endpoint:"animals",fields:[["name","Nome","text"],["identifier","Identificativo (facoltativo)","text"],["species","Specie","text"],["sex","Sesso","select"],["morph","Morph","text"],["birthDate","Data di nascita","date"],["locationLabel","Stabulazione / posizione","text"],["notes","Note","textarea"]],transform:v=>({...v,identifier:v.identifier||null,morph:v.morph||null,birthDate:v.birthDate||null,locationLabel:v.locationLabel||null,notes:v.notes||null})});
 const addInventory=()=>setModal({title:"Nuovo articolo",endpoint:"inventory/items",fields:[["name","Nome","text"],["category","Categoria","select"],["unit","Unità","text"],["quantityOnHand","Quantità iniziale","number"],["minimumQuantity","Soglia minima","number"],["notes","Note","textarea"]],transform:v=>({...v,quantityOnHand:Number(v.quantityOnHand||0),minimumQuantity:v.minimumQuantity===""?null:Number(v.minimumQuantity),notes:v.notes||null})});
 const addFinance=()=>setModal({title:"Nuova voce economica",endpoint:"finance/entries",fields:[["entryType","Tipo","select"],["occurredOn","Data","date"],["amount","Importo (€)","number"],["category","Categoria","text"],["description","Descrizione","text"]],transform:v=>({entryType:v.entryType,occurredOn:v.occurredOn,amountCents:Math.round(Number(v.amount)*100),currency:"EUR",category:v.category,description:v.description})});
 const addTask=()=>setModal({title:"Nuova attività",endpoint:"tasks",fields:[["title","Titolo","text"],["taskCategory","Categoria","select","custom"],["dueAt","Scadenza","datetime-local"],["description","Descrizione","text"]],transform:v=>({title:v.title,category:v.taskCategory,dueAt:new Date(v.dueAt).toISOString(),description:v.description||null})});
   const openEditRecord=(row:AnyRecord)=>{if(!["animali","inventario","attivita","finanze"].includes(active))return;
    if(active==="animali")return setModal({title:"Modifica animale",endpoint:"animals/"+row.id,method:"PATCH",fields:[["name","Nome","text",row.name],["identifier","Identificativo (facoltativo)","text",row.identifier||""],["species","Specie","text",row.species],["sex","Sesso","select",row.sex||"unknown"],["morph","Morph","text",row.morph||""],["birthDate","Data di nascita","date",row.birthDate?String(row.birthDate).slice(0,10):""],["locationLabel","Stabulazione / posizione","text",row.locationLabel||""],["notes","Note","textarea",row.notes||""]],transform:v=>({name:v.name,identifier:v.identifier||null,species:v.species,sex:v.sex,morph:v.morph||null,birthDate:v.birthDate||null,locationLabel:v.locationLabel||null,notes:v.notes||null})});
    if(active==="inventario")return setModal({title:"Modifica articolo",endpoint:"inventory/items/"+row.id,method:"PATCH",fields:[["name","Nome","text",row.name],["category","Categoria","select",row.category],["unit","Unità","text",row.unit],["minimumQuantity","Soglia minima","number",row.minimumQuantity??""],["notes","Note","textarea",row.notes||""]],transform:v=>({name:v.name,category:v.category,unit:v.unit,minimumQuantity:v.minimumQuantity===""?null:Number(v.minimumQuantity),notes:v.notes||null})});
    if(active==="attivita")return setModal({title:"Modifica attività",endpoint:"tasks/"+row.id,method:"PATCH",fields:[["title","Titolo","text",row.title],["taskCategory","Categoria","select",row.category||"custom"],["dueAt","Scadenza","datetime-local",row.dueAt?new Date(row.dueAt).toISOString().slice(0,16):""],["description","Descrizione","textarea",row.description||""]],transform:v=>({title:v.title,category:v.taskCategory,dueAt:new Date(v.dueAt).toISOString(),description:v.description||null})});
    if(active==="finanze")return setModal({title:"Modifica voce economica",endpoint:"finance/entries/"+row.id,method:"PATCH",fields:[["entryType","Tipo","select",row.entryType],["occurredOn","Data","date",row.occurredOn?String(row.occurredOn).slice(0,10):""],["amount","Importo (€)","number",Number(row.amountCents||0)/100],["category","Categoria","text",row.category],["description","Descrizione","text",row.description]],transform:v=>({entryType:v.entryType,occurredOn:v.occurredOn,amountCents:Math.round(Number(v.amount)*100),category:v.category,description:v.description})});
  };
  const deleteRecord=async(row:AnyRecord)=>{if(!["animali","inventario","attivita","finanze"].includes(active))return;
    const inventory=active==="inventario";
    if(!(await confirmAction({title:inventory?"Archiviare l’articolo?":"Eliminare il record?",message:inventory?"L’articolo verrà archiviato e lo storico resterà consultabile.":"L’operazione non è reversibile. Se esistono record collegati, il server potrebbe impedirla.",confirmLabel:inventory?"Archivia articolo":"Elimina record",danger:!inventory})))return;
    const endpoint=active==="animali"?"animals/"+row.id:inventory?"inventory/items/"+row.id+"/archive":active==="attivita"?"tasks/"+row.id:"finance/entries/"+row.id;
    const method=inventory?"POST":"DELETE";
    try{
      const result=await apiRequest(endpoint,{method,body:inventory?{}:undefined});
      showNotice(inventory?"Articolo archiviato.":"Record eliminato.");if(active==="finanze")setFinanceRefreshKey(key=>key+1);await loadData(active);
    }catch(err){showNotice(errorMessage(err),"error");}
  };
  const createInventoryMovement=(row:AnyRecord)=>setModal({title:"Movimento di magazzino · "+row.name,endpoint:"inventory/items/"+row.id+"/movements",fields:[["movementType","Tipo movimento","select","in"],["quantity","Quantità","number","1"],["occurredAt","Data e ora","datetime-local",localDateTime()],["unitCostCents","Costo unitario (centesimi, facoltativo)","number",""],["reference","Riferimento (facoltativo)","text",""],["notes","Note","textarea",""]],transform:v=>({movementType:v.movementType,quantity:Number(v.quantity),occurredAt:new Date(v.occurredAt).toISOString(),unitCostCents:v.unitCostCents===""?null:Number(v.unitCostCents),reference:v.reference||null,notes:v.notes||null})});
const actionButton: [string, () => void] | null = active==="inventario"?["＋ Nuovo articolo",addInventory]:active==="finanze"?["＋ Nuova voce",addFinance]:null;
 const dataForDisplay = useMemo(()=>rows.filter(row=>JSON.stringify(row).toLowerCase().includes(query.toLowerCase())),[rows,query]);
 const displayRecord = (r:AnyRecord)=>active==="animali"?{Nome:value(r,["name"]),Identificativo:value(r,["identifier"]),Specie:value(r,["species"]),Sesso:value(r,["sex"]),Morph:value(r,["morph"]),Stabulazione:value(r,["locationLabel"]),Stato:value(r,["status"])}:active==="inventario"?{Articolo:value(r,["name"]),Categoria:value(r,["category"]),Disponibile:value(r,["quantityOnHand"]),Unità:value(r,["unit"]),Soglia:value(r,["minimumQuantity"]),Stato:r.isActive===false?"Archiviato":"Attivo",Scorte:r.minimumQuantity==null?"Soglia non impostata":Number(r.quantityOnHand)<=Number(r.minimumQuantity)?"Sotto soglia":"Adeguate"}:active==="finanze"?{Descrizione:value(r,["description"]),Tipo:value(r,["entryType"]),Data:date(value(r,["occurredOn"],"—")),Importo:money(value(r,["amountCents"],"—")),Categoria:value(r,["category"])}:active==="alimentazioni"?{Data:date(value(r,["performedAt","fedAt","createdAt"])),Animale:value(r,["animalName","animalId"]),Esito:value(r,["outcome"]),Cibo:value(r,["foodType"]),Dettagli:value(r,["notes"])}:active==="attivita"?{Attività:value(r,["title","name"]),Scadenza:date(value(r,["dueAt"])),Stato:value(r,["status"]),Animale:value(r,["animalName"])}:active==="notifiche"?{Titolo:value(r,["title"]),Messaggio:value(r,["body"]),Data:date(value(r,["createdAt"])),Stato:value(r,["readAt"],"Non letta")}:Object.fromEntries(Object.entries(r).filter(([k,v])=>!["userId","updatedAt","createdAt","id"].includes(k)&&["string","number","boolean"].includes(typeof v)).slice(0,6).map(([k,v])=>[k.replace(/([A-Z])/g," $1"),String(v)]));
 const markTask=async(row:AnyRecord,status:string)=>{try{await apiRequest("tasks/"+row.id+"/complete",{method:"POST",body:{}});showNotice("Attività aggiornata.");await loadData(active);}catch(e){showNotice(errorMessage(e),"error");}};
 const createCare=async(type:string)=>{const destination=type==="weights"?"peso":type==="sheds"?"mute":"note";go(destination);showNotice("Seleziona l'animale e completa il modulo dedicato per registrare il dato.","info");};
 const doInstall=async()=>{if(!installEvent){showNotice("Usa il menu Condividi del browser e scegli “Aggiungi alla schermata Home” o “Installa app”.");return;}await installEvent.prompt();await installEvent.userChoice;setInstallEvent(null);};
 const headerTitle=t(active==="guide-sito"?"Tutorial per usare il sito":active==="guide-pwa"?"Tutorial per installare e usare la PWA":TITLES[active]||"Vivarqo");
 const authFlowPath = /^\/(verify-email|reset-password)\/?$/.test(window.location.pathname);if(!user || authFlowPath)return <><AuthFlowScreen onLogin={loadMe}/><Notice notice={notice}/></>;
 return (
  <AppShell
    active={active}
    title={headerTitle}
    nav={NAV.map(([id, label, icon, description]) => ({ id, label, icon, description }))}
    groups={NAV_GROUPS}
    mobileItems={["oggi", "animali", "alimentazioni", "riproduzioni", "altro"]}
    user={user}
    online={online}
    onNavigate={go}
    onInstall={doInstall}
    onLogout={logout}
    onSettings={() => go("impostazioni")}
    onLocaleChange={updateLocale}
  >
    <div className="page-wrap"><Notice notice={notice}/>{pwaUpdateRegistration&&<div className="notice pwa-update-notice" role="status"><span>{t("È disponibile una nuova versione di Vivarqo.")}</span><Button variant="secondary" onClick={()=>{const waiting=pwaUpdateRegistration.waiting;if(waiting)waiting.postMessage({type:"SKIP_WAITING"});else setPwaUpdateRegistration(null);}}>{t("Aggiorna ora")}</Button></div>}{!online&&<div className="notice warning">{t("Sei offline. Per leggere o modificare i dati devi ripristinare la connessione; Vivarqo non salva modifiche offline.")}</div>}
 <section className="page-heading"><div><p className="eyebrow">GESTIONE ALLEVAMENTO · {new Intl.DateTimeFormat(getIntlLocale(),{weekday:"long",day:"numeric",month:"long"}).format(new Date())}</p><h1><span className="page-heading-icon"><Icon name={NAV.find(item=>item[0]===active)?.[2]||"home"} size={24}/></span>{t(active==="oggi"?"Il tuo allevamento, sotto controllo.":headerTitle)}</h1><p>{t(active==="altro"?"Tutte le funzioni, organizzate per area.":DESCRIPTIONS[active]||"Una guida pratica per gestire il tuo allevamento.")}</p></div><div className="heading-actions">{actionButton&&<Button onClick={actionButton[1]}>{t(actionButton[0])}</Button>}{active==="guide-pwa"&&<Button onClick={doInstall}>{t("Installa la PWA")}</Button>}</div></section>
 {busy?<div className="loading"><span className="spinner"/>{t("Caricamento dati dal server…")}</div>:data?.__error?<div className="error-panel"><h2>{t("Non riesco a caricare questa sezione")}</h2><p>{data.__error}</p><Button variant="secondary" onClick={()=>loadData(active)}>{t("Riprova")}</Button></div>:active==="guide"?<><div className="tutorial-callout"><h3>{t("Impara a usare Vivarqo")}</h3><p>{t("Qui trovi due guide: come gestire i registri dal sito e come installare la PWA sul tuo dispositivo.")}</p></div><p className="eyebrow tutorial-section-label">{t("GUIDA AL SITO")}</p><Tutorial/><div className="tutorial-callout"><h3>{t("Flusso consigliato")}</h3><p>{t("1. Crea le schede degli animali. 2. Registra pasti, pesi, mute e note. 3. Pianifica attività e promemoria. 4. Mantieni aggiornati inventario e documenti. 5. Esporta periodicamente una copia dei dati.")}</p></div><p className="eyebrow tutorial-section-label">{t("GUIDA ALLA PWA")}</p><Tutorial pwa/><div className="tutorial-callout"><h3>{t("Cosa funziona offline?")}</h3><p>{t("La PWA conserva alcune risorse statiche già caricate, ma in questa versione non consente di modificare i dati offline: le richieste di scrittura vengono bloccate finché non torna la connessione. Le risposte private dell’API non vengono messe in cache.")}</p><Button onClick={doInstall}>＋ {t("Installa la PWA")}</Button></div></>:active==="guide-sito"?<><Tutorial/><div className="tutorial-callout"><h3>{t("Flusso consigliato")}</h3><p>{t("1. Crea le schede degli animali. 2. Registra pasti, pesi, mute e note. 3. Pianifica attività e promemoria. 4. Mantieni aggiornati inventario e documenti. 5. Esporta periodicamente una copia dei dati.")}</p></div></>:active==="guide-pwa"?<><Tutorial pwa/><div className="tutorial-callout"><h3>{t("Cosa funziona offline?")}</h3><p>{t("La PWA può conservare alcune risorse statiche già caricate. Le risposte private dell’API non vengono memorizzate dal service worker e in questa versione le modifiche ai dati richiedono una connessione attiva. File, condivisioni e pagamenti restano online-only.")}</p><Button onClick={doInstall}>＋ {t("Installa la PWA")}</Button></div></>:active==="altro"?<MoreHub onGo={go} groups={NAV_MORE_GROUPS} nav={NAV}/>:active==="oggi"?<Dashboard data={data ?? {}} onGo={go} onRetry={()=>loadData("oggi")} onQuickEntry={setQuickEntryKind} refreshKey={dashboardRefreshKey}/>:active==="riproduzioni"?<ReproductionHub owner={user.id||user.email} onNotice={showNotice} temperatureUnit={measurementPreferences.temperatureUnit}/>:active==="documenti"?<DocumentsHub owner={user.id||user.email} onNotice={showNotice}/>:active==="notifiche"?<NotificationsHub owner={user.id||user.email} onNotice={showNotice}/>:active==="cure"?<CareRecordsHub weightUnit={measurementPreferences.weightUnit} owner={user.id||user.email} onNotice={showNotice} initialTab="weights" initialAnimalId={targetAnimalId}/>:active==="alimentazioni"?<CareRecordsHub weightUnit={measurementPreferences.weightUnit} owner={user.id||user.email} onNotice={showNotice} initialTab="feedings" initialAnimalId={targetAnimalId}/>:active==="genetica"?<CareRecordsHub weightUnit={measurementPreferences.weightUnit} owner={user.id||user.email} onNotice={showNotice} initialTab="genetics" initialAnimalId={targetAnimalId}/>:active==="peso"||active==="mute"||active==="note"?<CareRecordsHub weightUnit={measurementPreferences.weightUnit} owner={user.id||user.email} onNotice={showNotice} initialTab={active==="peso"?"weights":active==="mute"?"sheds":"notes"} initialAnimalId={targetAnimalId}/>:active==="animali"?<AnimalsHub owner={user.id||user.email} onNotice={showNotice} onGo={go} initialAnimalId={targetAnimalId}/>:active==="attivita"?<CalendarHub onNotice={showNotice}/>:active==="abbonamento"?<BillingHub onNotice={showNotice}/>:active==="inventario"?<><InventoryFilters filters={inventoryFilters} onChange={updateInventoryFilter} onReset={resetInventoryFilters}/><Records active={active} data={data ?? {}} rows={dataForDisplay} onSearch={updateRecordSearch} query={query} onCare={createCare} onReload={()=>loadData(active)} onTask={markTask} onGo={go} onEdit={openEditRecord} onDelete={deleteRecord} onHistory={setHistoryItem} onMovement={createInventoryMovement} onPageChange={(page:number)=>setListPages(p=>({...p,[active]:page}))}/>{historyItem&&<InventoryMovementHistory item={historyItem} onClose={()=>setHistoryItem(null)}/>}</>:active==="finanze"?<><FinanceSummary onNotice={showNotice} refreshKey={financeRefreshKey}/><Records active={active} data={data ?? {}} rows={dataForDisplay} onSearch={updateRecordSearch} query={query} onCare={createCare} onReload={()=>loadData(active)} onTask={markTask} onGo={go} onEdit={openEditRecord} onDelete={deleteRecord} onPageChange={(page:number)=>setListPages(p=>({...p,[active]:page}))}/></>:active==="dati"?<DataTools onNotice={showNotice}/>:active==="impostazioni"?<SettingsPage user={user} onNotice={showNotice}/>:<Records active={active} data={data ?? {}} rows={dataForDisplay} onSearch={updateRecordSearch} query={query} onCare={createCare} onReload={()=>loadData(active)} onTask={markTask} onGo={go} onEdit={openEditRecord} onDelete={deleteRecord} onMovement={createInventoryMovement} onPageChange={page=>setListPages(p=>({...p,[active]:page}))}/>} 
 <footer className="page-footer"><span>{t("Vivarqo · Crescere con cura.")}</span><span>{t("Sessione protetta · Dati caricati dal backend")}</span></footer></div>
    {modal&&<Modal modal={modal} onClose={()=>setModal(null)} onSubmit={saveEntity}/>} {quickEntryKind&&<QuickEntryDialog kind={quickEntryKind} weightUnit={measurementPreferences.weightUnit} onClose={()=>setQuickEntryKind(null)} onNotice={showNotice} onSaved={()=>{setDashboardRefreshKey(key=>key+1);void loadData("oggi");}}/>}
  </AppShell>
);
}




export default App;
