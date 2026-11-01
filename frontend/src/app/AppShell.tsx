import React, { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { AccountUser } from "../types";
import { getLocale, t } from "../i18n";
import { Icon } from "../ui/Icon";

export type NavigationItem = { id: string; label: string; icon: string; description: string };
export type NavigationGroup = { id: string; label: string; items: string[] };
type AppShellProps = {
  active: string; title: string; nav: NavigationItem[]; groups: NavigationGroup[];
  mobileItems: string[]; user: AccountUser; online: boolean;
  onNavigate: (id: string) => void; onInstall: () => void; onLogout: () => void;
  onSettings: () => void; onLocaleChange: (locale: "it" | "en") => void; children: ReactNode;
};
function Brand() {
  return <div className="app-brand" aria-label="Vivarqo">
    <span className="app-brand-mark"><Icon name="snake" size={22} strokeWidth={2} /></span>
    <span className="app-brand-name">vivarqo<span>.</span></span>
  </div>;
}
export function AppShell({ active, title, nav, groups, mobileItems, user, online, onNavigate, onInstall, onLogout, onSettings, onLocaleChange, children }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [locale, setCurrentLocale] = useState(getLocale());
  const initials = String(user.displayName || user.email || "V").trim().slice(0, 1).toUpperCase();
  const isMoreActive = active === "altro" || !mobileItems.slice(0, -1).includes(active);
  useEffect(() => {
    const syncLocale = (event: Event) => {
      const next = (event as CustomEvent<"it" | "en">).detail;
      setCurrentLocale(next === "en" ? "en" : "it");
    };
    window.addEventListener("vivarqo:locale-change", syncLocale);
    return () => window.removeEventListener("vivarqo:locale-change", syncLocale);
  }, []);
  const navigate = (id: string) => { setDrawerOpen(false); onNavigate(id); };

  return <div className="app-shell app-shell--modern">
    <aside className={"sidebar app-sidebar" + (drawerOpen ? " sidebar--open" : "")} aria-label={t("Navigazione Vivarqo")}>
      <div className="sidebar-brand app-sidebar-brand">
        <Brand />
        <button type="button" className="mobile-close" aria-label={t("Chiudi menu")} onClick={() => setDrawerOpen(false)}><Icon name="close" size={20} /></button>
      </div>
      <div className="app-sidebar-caption">{t("IL TUO ALLEVAMENTO")}</div>
      <nav className="app-navigation" aria-label={t("Sezioni principali")}>
        <div className="nav-primary app-nav-primary">
          {["oggi", "animali", "alimentazioni", "attivita"].map(id => {
            const item = nav.find(entry => entry.id === id);
            if (!item) return null;
            return <button type="button" key={id}
              className={"app-nav-item nav-item" + (active === id ? " is-active active" : "")}
              aria-current={active === id ? "page" : undefined} title={t(item.description)}
              onClick={() => navigate(id)}>
              <span className="app-nav-icon"><Icon name={item.icon} size={18} /></span>
              <span className="app-nav-text">{t(item.label)}</span>
              {active === id && <span className="app-nav-indicator" aria-hidden="true" />}
            </button>;
          })}
        </div>
        <div className="nav-secondary app-nav-secondary">
          <button type="button"
            className={"app-nav-item nav-item" + (active === "altro" ? " is-active active" : "")}
            aria-current={active === "altro" ? "page" : undefined}
            onClick={() => navigate("altro")}>
            <span className="app-nav-icon"><Icon name="more" size={18} /></span>
            <span className="app-nav-text">{t("Altro")}</span>
            <span className="app-nav-indicator" aria-hidden="true" />
          </button>
        </div>
        {groups.map(group => {
          const items = group.items
            .filter(id => !["oggi", "animali", "alimentazioni", "attivita"].includes(id))
            .map(id => nav.find(item => item.id === id))
            .filter((item): item is NavigationItem => Boolean(item));
          if (!items.length) return null;
          return <section className="app-nav-group" key={group.id} aria-labelledby={"nav-group-" + group.id}>
            <h2 className="app-nav-label" id={"nav-group-" + group.id}>{t(group.label)}</h2>
            {items.map(item => <button type="button" key={item.id}
              className={"app-nav-item nav-item" + (active === item.id ? " is-active active" : "")}
              aria-current={active === item.id ? "page" : undefined} title={t(item.description)}
              onClick={() => navigate(item.id)}>
              <span className="app-nav-icon"><Icon name={item.icon} size={18} /></span>
              <span className="app-nav-text">{t(item.label)}</span>
              {active === item.id && <span className="app-nav-indicator" aria-hidden="true" />}
            </button>)}
          </section>;
        })}
      </nav>
      <div className="app-sidebar-bottom">
        <div className="app-sidebar-tip">
          <span className="app-sidebar-tip-icon"><Icon name="leaf" size={17} /></span>
          <div><strong>{t("Un allevamento, sotto controllo.")}</strong><p>{t("Registra gli eventi quando accadono. Lo storico farà il resto.")}</p></div>
        </div>
        <div className="app-sidebar-account">
          <span className="avatar app-account-avatar">{initials}</span>
          <span className="app-account-copy"><strong>{user.displayName || "Il mio account"}</strong><small>{user.email}</small></span>
          <button type="button" className="app-account-menu" onClick={onSettings} aria-label={t("Apri impostazioni account")} title={t("Impostazioni account")}><Icon name="settings" size={17} /></button>
        </div>
      </div>
    </aside>
    {drawerOpen && <button type="button" className="sidebar-backdrop" aria-label={t("Chiudi menu")} onClick={() => setDrawerOpen(false)} />}
    <main className="main-content app-main">
      <header className="topbar app-topbar">
        <div className="app-topbar-start">
          <button type="button" className="menu-toggle" aria-label={t("Apri menu")} aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}><Icon name="menu" size={21} /></button>
          <div className="app-breadcrumb"><span>Vivarqo</span><Icon name="chevron" size={13} /><strong>{title}</strong></div>
        </div>
        <div className="topbar-right app-topbar-actions">
          <span className={"app-connection" + (online ? " is-online" : " is-offline")}><span className="app-connection-dot" />{t(online ? "Online" : "Offline")}</span>
          <label className="app-language-control"><Icon name="globe" size={16} />
            <select aria-label={t("Lingua dell'interfaccia")} value={locale} onChange={event => onLocaleChange(event.target.value === "en" ? "en" : "it")}>
              <option value="it">IT</option><option value="en">EN</option>
            </select>
          </label>
          <button type="button" className="install-button app-install-button" onClick={onInstall}><Icon name="download" size={16} /><span>{t("Installa app")}</span></button>
          <button type="button" className="app-header-account" onClick={onSettings} title={t("Impostazioni account")} aria-label={t("Impostazioni account")}><span className="avatar">{initials}</span><Icon name="chevron" size={14} /></button>
          <button type="button" className="app-logout-button" onClick={onLogout} title={t("Esci")} aria-label={t("Esci")}><Icon name="log-out" size={17} /></button>
        </div>
      </header>
      <div className="app-content">{children}</div>
    </main>
    <nav className="mobile-nav app-mobile-nav" aria-label={t("Navigazione rapida")}>
      {mobileItems.map(id => {
        const item = nav.find(entry => entry.id === id) ?? (id === "altro" ? {
          id: "altro", label: "Altro", icon: "more", description: "Altri moduli e impostazioni"
        } : undefined);
        if (!item) return null;
        const selected = id === "altro" ? isMoreActive : active === id;
        return <button type="button" key={id} className={selected ? "active" : ""} aria-current={selected ? "page" : undefined} onClick={() => navigate(id)}>
          <span className="app-mobile-icon"><Icon name={item.icon} size={20} /></span><span>{t(id === "alimentazioni" ? "Pasti" : item.label)}</span>
        </button>;
      })}
    </nav>
  </div>;
}
