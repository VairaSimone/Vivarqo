import type { Dispatch, SetStateAction } from "react";
import { ReproductionHub } from "../ReproductionHub";
import { DocumentsHub } from "../DocumentsHub";
import { NotificationsHub } from "../NotificationsHub";
import { CareRecordsHub } from "../CareRecordsHub";
import { AnimalsHub } from "../AnimalsHub";
import { BillingHub } from "../BillingHub";
import { CalendarHub } from "../CalendarHub";
import { InventoryMovementHistory } from "../InventoryMovementHistory";
import { FinanceSummary } from "../FinanceSummary";
import { Dashboard } from "../components/Dashboard";
import { QuickEntryDialog, type QuickEntryKind } from "../components/QuickEntryDialog";
import { Records } from "../components/Records";
import { DataTools } from "../components/DataTools";
import { SettingsPage } from "../components/SettingsPage";
import { Tutorial } from "../components/Tutorial";
import { InventoryFilters } from "../components/InventoryFilters";
import { MoreHub } from "../components/MoreHub";
import { Button } from "../ui/FormControls";
import { t } from "../i18n";
import type { AccountUser, AnyRecord, InventoryFiltersState, NavigationHandler, NoticeHandler } from "../types";
import type { MeasurementPreferences } from "./useAppPreferences";

export interface AppPageRendererProps {
  active: string;
  user: AccountUser;
  data: AnyRecord | null;
  busy: boolean;
  rows: AnyRecord[];
  dataForDisplay: AnyRecord[];
  query: string;
  historyItem: AnyRecord | null;
  inventoryFilters: InventoryFiltersState;
  financeRefreshKey: number;
  dashboardRefreshKey: number;
  measurementPreferences: MeasurementPreferences;
  targetAnimalId: string | null;
  onNotice: NoticeHandler;
  onNavigate: NavigationHandler;
  onInstall: () => void;
  onLoadData: (section?: string) => Promise<void>;
  onQuickEntry: Dispatch<SetStateAction<QuickEntryKind | null>>;
  onQuickEntrySaved: () => void;
  onHistoryChange: Dispatch<SetStateAction<AnyRecord | null>>;
  onListPageChange: Dispatch<SetStateAction<Record<string, number>>>;
  onInventoryFilterChange: (name: keyof InventoryFiltersState, value: string | boolean) => void;
  onInventoryFiltersReset: () => void;
  onSearch: (value: string) => void;
  onCare: (type: string) => void;
  onTask: (row: AnyRecord) => void;
  onEdit: (row: AnyRecord) => void;
  onDelete: (row: AnyRecord) => void;
  onMovement: (row: AnyRecord) => void;
}

export function AppPageRenderer(props: AppPageRendererProps) {
  const {
    active, user, data, busy, rows, dataForDisplay, query, historyItem, inventoryFilters,
    financeRefreshKey, dashboardRefreshKey, measurementPreferences, targetAnimalId,
    onNotice, onNavigate, onInstall, onLoadData, onQuickEntry, onQuickEntrySaved,
    onHistoryChange, onListPageChange, onInventoryFilterChange, onInventoryFiltersReset,
    onSearch, onCare, onTask, onEdit, onDelete, onMovement
  } = props;
  const owner = user.id || user.email;

  if (busy) {
    return <div className="loading"><span className="spinner" />{t("Caricamento dati dal server…")}</div>;
  }
  if (data?.__error) {
    return <div className="error-panel">
      <h2>{t("Non riesco a caricare questa sezione")}</h2>
      <p>{data.__error}</p>
      <Button variant="secondary" onClick={() => void onLoadData(active)}>{t("Riprova")}</Button>
    </div>;
  }

  if (active === "guide") {
    return <>
      <div className="tutorial-callout"><h3>{t("Impara a usare Vivarqo")}</h3><p>{t("Qui trovi due guide: come gestire i registri dal sito e come installare la PWA sul tuo dispositivo.")}</p></div>
      <p className="eyebrow tutorial-section-label">{t("GUIDA AL SITO")}</p>
      <Tutorial />
      <div className="tutorial-callout"><h3>{t("Flusso consigliato")}</h3><p>{t("1. Crea le schede degli animali. 2. Registra pasti, pesi, mute e note. 3. Pianifica attività e promemoria. 4. Mantieni aggiornati inventario e documenti. 5. Esporta periodicamente una copia dei dati.")}</p></div>
      <p className="eyebrow tutorial-section-label">{t("GUIDA ALLA PWA")}</p>
      <Tutorial pwa />
      <div className="tutorial-callout"><h3>{t("Cosa funziona offline?")}</h3><p>{t("La PWA conserva alcune risorse statiche già caricate, ma in questa versione non consente di modificare i dati offline: le richieste di scrittura vengono bloccate finché non torna la connessione. Le risposte private dell’API non vengono messe in cache.")}</p><Button onClick={onInstall}>＋ {t("Installa la PWA")}</Button></div>
    </>;
  }
  if (active === "guide-sito") {
    return <><Tutorial /><div className="tutorial-callout"><h3>{t("Flusso consigliato")}</h3><p>{t("1. Crea le schede degli animali. 2. Registra pasti, pesi, mute e note. 3. Pianifica attività e promemoria. 4. Mantieni aggiornati inventario e documenti. 5. Esporta periodicamente una copia dei dati.")}</p></div></>;
  }
  if (active === "guide-pwa") {
    return <><Tutorial pwa /><div className="tutorial-callout"><h3>{t("Cosa funziona offline?")}</h3><p>{t("La PWA può conservare alcune risorse statiche già caricate. Le risposte private dell’API non vengono memorizzate dal service worker e in questa versione le modifiche ai dati richiedono una connessione attiva. File, condivisioni e pagamenti restano online-only.")}</p><Button onClick={onInstall}>＋ {t("Installa la PWA")}</Button></div></>;
  }
  if (active === "altro") return <MoreHub onGo={onNavigate} groups={NAV_MORE_GROUPS} nav={NAV}/>;
  if (active === "oggi") return <Dashboard data={data ?? {}} onGo={onNavigate} onRetry={() => void onLoadData("oggi")} onQuickEntry={onQuickEntry} refreshKey={dashboardRefreshKey}/>;
  if (active === "riproduzioni") return <ReproductionHub owner={owner} onNotice={onNotice} temperatureUnit={measurementPreferences.temperatureUnit}/>;
  if (active === "documenti") return <DocumentsHub owner={owner} onNotice={onNotice}/>;
  if (active === "notifiche") return <NotificationsHub owner={owner} onNotice={onNotice}/>;
  if (active === "cure" || active === "peso" || active === "mute" || active === "note" || active === "alimentazioni" || active === "genetica") {
    const initialTab = active === "alimentazioni" ? "feedings"
      : active === "genetica" ? "genetics"
      : active === "mute" ? "sheds"
      : active === "note" ? "notes"
      : "weights";
    return <CareRecordsHub weightUnit={measurementPreferences.weightUnit} owner={owner} onNotice={onNotice} initialTab={initialTab} initialAnimalId={targetAnimalId}/>;
  }
  if (active === "animali") return <AnimalsHub owner={owner} onNotice={onNotice} onGo={onNavigate} initialAnimalId={targetAnimalId}/>;
  if (active === "attivita") return <CalendarHub onNotice={onNotice}/>;
  if (active === "abbonamento") return <BillingHub onNotice={onNotice}/>;
  if (active === "inventario") {
    return <>
      <InventoryFilters filters={inventoryFilters} onChange={onInventoryFilterChange} onReset={onInventoryFiltersReset}/>
      <Records active={active} data={data ?? {}} rows={dataForDisplay} onSearch={onSearch} query={query}
        onCare={onCare} onReload={() => onLoadData(active)} onTask={onTask} onGo={onNavigate}
        onEdit={onEdit} onDelete={onDelete} onHistory={onHistoryChange} onMovement={onMovement}
        onPageChange={page => onListPageChange(current => ({ ...current, [active]: page }))}/>
      {historyItem && <InventoryMovementHistory item={historyItem} onClose={() => onHistoryChange(null)}/>}
    </>;
  }
  if (active === "finanze") {
    return <>
      <FinanceSummary onNotice={onNotice} refreshKey={financeRefreshKey}/>
      <Records active={active} data={data ?? {}} rows={dataForDisplay} onSearch={onSearch} query={query}
        onCare={onCare} onReload={() => onLoadData(active)} onTask={onTask} onGo={onNavigate}
        onEdit={onEdit} onDelete={onDelete}
        onPageChange={page => onListPageChange(current => ({ ...current, [active]: page }))}/>
    </>;
  }
  if (active === "dati") return <DataTools onNotice={onNotice}/>;
  if (active === "impostazioni") return <SettingsPage user={user} onNotice={onNotice}/>;

  return <Records active={active} data={data ?? {}} rows={dataForDisplay} onSearch={onSearch} query={query}
    onCare={onCare} onReload={() => onLoadData(active)} onTask={onTask} onGo={onNavigate}
    onEdit={onEdit} onDelete={onDelete} onMovement={onMovement}
    onPageChange={page => onListPageChange(current => ({ ...current, [active]: page }))}/>;
}
