import React, { useCallback, useMemo } from "react";
import { apiRequest } from "./api/api";
import { AuthScreen as AuthFlowScreen } from "./AuthScreen";
import { Icon } from "./ui/Icon";
import { QuickEntryDialog } from "./components/QuickEntryDialog";
import { AppPageRenderer } from "./app/AppPageRenderer";
import { useConfirmDialog } from "./ui/ConfirmDialog";
import { Modal } from "./app/AppModals";
import { getIntlLocale, t, useLocale } from "./i18n";
import { AppShell } from "./app/AppShell";
import { DESCRIPTIONS, NAV, NAV_GROUPS, TITLES } from "./app/navigation";
import { useAppData } from "./app/useAppData";
import { useAppRecordActions } from "./app/useAppRecordActions";
import { useAppNavigation } from "./app/useAppNavigation";
import { useAppPreferences } from "./app/useAppPreferences";
import { useAppNotice } from "./app/useAppNotice";
import { useAppPlatform } from "./app/useAppPlatform";
import { useAppSession } from "./app/useAppSession";
import { useAppViewState } from "./app/useAppViewState";

function Button({
  children,
  variant = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) {
  return <button className={"button " + variant} {...props}>
    {typeof children === "string" ? t(children) : children}
  </button>;
}

function Notice({ notice }: { notice: { text: string; kind?: string } | null }) {
  return notice
    ? <div className={"notice " + (notice.kind || "info")} role="status">{t(notice.text)}</div>
    : null;
}

function SessionChecking({ hasError, onRetry }: { hasError: boolean; onRetry: () => void }) {
  return <main className="auth-wrap">
    <section className="auth-card session-checking" aria-labelledby="session-checking-title">
      <p className="eyebrow">{t("VIVARQO")}</p>
      <h2 id="session-checking-title">{t("Verifica della sessione…")}</h2>
      {!hasError && <div className="loading" role="status"><span className="spinner"/>{t("Verifica della sessione…")}</div>}
      {hasError && <>
        <p className="form-message error-text" role="alert">{t("Non riesco a verificare la sessione al momento.")}</p>
        <p>{t("Controlla la connessione e riprova. Non ti abbiamo disconnesso.")}</p>
        <Button onClick={onRetry}>{t("Riprova")}</Button>
      </>}
    </section>
  </main>;
}

function App() {
  // Subscribing at the root rerenders all translated application components on locale changes.
  useLocale();

  const { notice, showNotice } = useAppNotice();
  const session = useAppSession(showNotice);
  const view = useAppViewState();
  const {
    query, setQuery, modal, setModal, listPages, setListPages, historyItem, setHistoryItem,
    inventoryFilters, setInventoryFilters, financeRefreshKey, setFinanceRefreshKey,
    quickEntryKind, setQuickEntryKind, dashboardRefreshKey, setDashboardRefreshKey,
    resetNavigationState
  } = view;
  const notifyInstallUnavailable = useCallback(() => {
    showNotice("Usa il menu Condividi del browser e scegli “Aggiungi alla schermata Home” o “Installa app”.");
  }, [showNotice]);
  const { online, pwaUpdateRegistration, installApp, clearPwaUpdate } =
    useAppPlatform(notifyInstallUnavailable);

  const { user, loadMe, handleUnauthorized, endSession, sessionStatus, sessionError, updateLocale, syncLocale } = session;
  const confirmAction = useConfirmDialog();
  const { active, targetAnimalId, go } = useAppNavigation(resetNavigationState);
  const { measurementPreferences } = useAppPreferences(user);
  const { data, busy, rows, loadData, clearData } = useAppData({
    user, active, query, listPages, inventoryFilters, onUnauthorized: handleUnauthorized
  });
  const dataForDisplay = useMemo(
    () => rows.filter(row => JSON.stringify(row).toLowerCase().includes(query.toLowerCase())),
    [rows, query]
  );

  const showSessionNotice = showNotice;
  const {
    updateInventoryFilter, resetInventoryFilters, updateRecordSearch, saveEntity,
    addInventory, addFinance, openEditRecord, deleteRecord, createInventoryMovement,
    markTask, createCare, actionButton
  } = useAppRecordActions({
    active, modal, query, inventoryFilters, setModal, setQuery, setListPages,
    setInventoryFilters, setHistoryItem, setFinanceRefreshKey, loadData, go,
    onNotice: showSessionNotice, confirm: confirmAction
  });

  const logout = async () => {
    try {
      await apiRequest("auth/logout", { method: "POST", body: {} });
    } catch {
      // The local session must still be cleared when the server is unreachable.
    }
    endSession();
    clearData();
    go("oggi");
    showNotice("Hai terminato la sessione.");
  };

  const headerTitle = t(
    active === "guide-sito" ? "Tutorial per usare il sito"
      : active === "guide-pwa" ? "Tutorial per installare e usare la PWA"
      : TITLES[active] || "Vivarqo"
  );
  const authFlowPath = /^\/(verify-email|reset-password)\/?$/.test(window.location.pathname);

  if (authFlowPath) {
    return <><AuthFlowScreen onLogin={loadMe} /><Notice notice={notice} /></>;
  }
  if (sessionStatus === "checking") {
    return <SessionChecking hasError={Boolean(sessionError)} onRetry={() => void loadMe()}/>;
  }
  if (sessionStatus === "unauthenticated" || !user) {
    return <><AuthFlowScreen onLogin={loadMe} /><Notice notice={notice} /></>;
  }

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
      onInstall={installApp}
      onLogout={logout}
      onSettings={() => go("impostazioni")}
      onLocaleChange={updateLocale}
    >
      <div className="page-wrap">
        <Notice notice={notice} />
        {pwaUpdateRegistration && (
          <div className="notice pwa-update-notice" role="status">
            <span>{t("È disponibile una nuova versione di Vivarqo.")}</span>
            <Button variant="secondary" onClick={() => {
              const waiting = pwaUpdateRegistration.waiting;
              if (waiting) waiting.postMessage({ type: "SKIP_WAITING" });
              else clearPwaUpdate();
            }}>
              {t("Aggiorna ora")}
            </Button>
          </div>
        )}
        {!online && (
          <div className="notice warning">
            {t("Sei offline. Per leggere o modificare i dati devi ripristinare la connessione; Vivarqo non salva modifiche offline.")}
          </div>
        )}

        <section className="page-heading">
          <div>
            <p className="eyebrow">
              GESTIONE ALLEVAMENTO · {new Intl.DateTimeFormat(getIntlLocale(), {
                weekday: "long", day: "numeric", month: "long"
              }).format(new Date())}
            </p>
            <h1>
              <span className="page-heading-icon">
                <Icon name={NAV.find(item => item[0] === active)?.[2] || "home"} size={24} />
              </span>
              {t(active === "oggi" ? "Il tuo allevamento, sotto controllo." : headerTitle)}
            </h1>
            <p>{t(active === "altro"
              ? "Tutte le funzioni, organizzate per area."
              : DESCRIPTIONS[active] || "Una guida pratica per gestire il tuo allevamento.")}</p>
          </div>
          <div className="heading-actions">
            {actionButton && <Button onClick={actionButton[1]}>{actionButton[0]}</Button>}
            {active === "guide-pwa" && <Button onClick={installApp}>{t("Installa la PWA")}</Button>}
          </div>
        </section>

        <AppPageRenderer
          active={active}
          user={user}
          data={data}
          busy={busy}
          rows={rows}
          dataForDisplay={dataForDisplay}
          query={query}
          historyItem={historyItem}
          inventoryFilters={inventoryFilters}
          financeRefreshKey={financeRefreshKey}
          dashboardRefreshKey={dashboardRefreshKey}
          measurementPreferences={measurementPreferences}
          targetAnimalId={targetAnimalId}
          onNotice={showNotice}
          onLocaleApplied={syncLocale}
          onNavigate={go}
          onInstall={installApp}
          onLoadData={loadData}
          onQuickEntry={setQuickEntryKind}
          onHistoryChange={setHistoryItem}
          onListPageChange={setListPages}
          onInventoryFilterChange={updateInventoryFilter}
          onInventoryFiltersReset={resetInventoryFilters}
          onSearch={updateRecordSearch}
          onCare={createCare}
          onTask={markTask}
          onEdit={openEditRecord}
          onDelete={deleteRecord}
          onMovement={createInventoryMovement}
        />

        <footer className="page-footer">
          <span>{t("Vivarqo · Crescere con cura.")}</span>
          <span>{t("Sessione protetta · Dati caricati dal backend")}</span>
        </footer>
      </div>
      {modal && <Modal modal={modal} onClose={() => setModal(null)} onSubmit={saveEntity} />}
      {quickEntryKind && (
        <QuickEntryDialog
          kind={quickEntryKind}
          weightUnit={measurementPreferences.weightUnit}
          onClose={() => setQuickEntryKind(null)}
          onNotice={showNotice}
          onSaved={() => {
            setDashboardRefreshKey(key => key + 1);
            void loadData("oggi");
          }}
        />
      )}
    </AppShell>
  );
}

export default App;
