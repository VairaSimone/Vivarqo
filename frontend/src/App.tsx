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
import { getIntlLocale, getLocale, setLocale, t } from "./i18n";
import { AppShell } from "./app/AppShell";
import { NAV, NAV_GROUPS, TITLES } from "./app/navigation";
import { useAppData } from "./app/useAppData";
import { useAppRecordActions } from "./app/useAppRecordActions";
import { useAppNavigation } from "./app/useAppNavigation";
import { useAppPreferences } from "./app/useAppPreferences";

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
 const showNotice=useCallback((text: string,kind: NoticeKind="info")=>{setNotice({text,kind});if(noticeTimer.current)window.clearTimeout(noticeTimer.current);noticeTimer.current=window.setTimeout(()=>setNotice(null),5000);},[]);
 const {
   updateInventoryFilter,resetInventoryFilters,updateRecordSearch,saveEntity,
   addInventory,addFinance,openEditRecord,deleteRecord,createInventoryMovement,
   markTask,createCare,actionButton
 }=useAppRecordActions({
   active,modal,query,inventoryFilters,setModal,setQuery,setListPages,
   setInventoryFilters,setHistoryItem,setFinanceRefreshKey,loadData,go,
   onNotice:showNotice,confirm:confirmAction
 });
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
 <AppPageRenderer
  active={active} user={user} data={data} busy={busy} rows={rows} dataForDisplay={dataForDisplay}
  query={query} historyItem={historyItem} inventoryFilters={inventoryFilters}
  financeRefreshKey={financeRefreshKey} dashboardRefreshKey={dashboardRefreshKey}
  measurementPreferences={measurementPreferences} targetAnimalId={targetAnimalId}
  onNotice={showNotice} onNavigate={go} onInstall={doInstall} onLoadData={loadData}
  onQuickEntry={setQuickEntryKind}
  onHistoryChange={setHistoryItem} onListPageChange={setListPages}
  onInventoryFilterChange={updateInventoryFilter} onInventoryFiltersReset={resetInventoryFilters}
  onSearch={updateRecordSearch} onCare={createCare} onTask={markTask} onEdit={openEditRecord}
  onDelete={deleteRecord} onMovement={createInventoryMovement}
 />
 {quickEntryKind&&<QuickEntryDialog kind={quickEntryKind} weightUnit={measurementPreferences.weightUnit} onClose={()=>setQuickEntryKind(null)} onNotice={showNotice} onSaved={()=>{setDashboardRefreshKey(key=>key+1);void loadData("oggi");}}/>}

 <footer className="page-footer"><span>{t("Vivarqo · Crescere con cura.")}</span><span>{t("Sessione protetta · Dati caricati dal backend")}</span></footer></div>
    {modal&&<Modal modal={modal} onClose={()=>setModal(null)} onSubmit={saveEntity}/>} {quickEntryKind&&<QuickEntryDialog kind={quickEntryKind} weightUnit={measurementPreferences.weightUnit} onClose={()=>setQuickEntryKind(null)} onNotice={showNotice} onSaved={()=>{setDashboardRefreshKey(key=>key+1);void loadData("oggi");}}/>}
  </AppShell>
);
}




export default App;
