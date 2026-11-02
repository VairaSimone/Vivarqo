import { useState, type ReactNode } from "react";
import { Icon, IconButton } from "../components/ui";
import type { Locale } from "../lib/domain";
import { translate } from "../lib/i18n";

type User = { displayName: string; email: string; locale: Locale };
type NavItem = { path: string; label: string; icon: "home" | "calendar" | "check" | "snake" | "feed" | "leaf" | "box" | "file" | "wallet" | "settings" | "bell" };

const groups: Array<{ title: string; items: NavItem[] }> = [
  { title: "navWorkspace", items: [
    { path: "/today", label: "navToday", icon: "home" },
    { path: "/calendar", label: "navCalendar", icon: "calendar" },
    { path: "/tasks", label: "navTasks", icon: "check" }
  ] },
  { title: "navAnimals", items: [
    { path: "/animals", label: "navAnimals", icon: "snake" },
    { path: "/feeding", label: "navFeeding", icon: "feed" }
  ] },
  { title: "navResources", items: [
    { path: "/reproduction", label: "navBreeding", icon: "leaf" },
    { path: "/inventory", label: "navInventory", icon: "box" },
    { path: "/documents", label: "navDocuments", icon: "file" }
  ] },
  { title: "navAdmin", items: [
    { path: "/finance", label: "navFinance", icon: "wallet" },
    { path: "/imports", label: "navImports", icon: "file" },
    { path: "/exports", label: "navExports", icon: "box" }
  ] },
  { title: "navPreferences", items: [
    { path: "/notifications", label: "navNotifications", icon: "bell" },
    { path: "/billing", label: "navBilling", icon: "wallet" },
    { path: "/settings", label: "navSettings", icon: "settings" }
  ] }
];

const routeTitles: Record<string, string> = {
  "/today": "navToday", "/calendar": "navCalendar", "/tasks": "navTasks",
  "/animals": "navAnimals", "/feeding": "navFeeding", "/reproduction": "navBreeding",
  "/inventory": "navInventory", "/documents": "navDocuments", "/finance": "navFinance",
  "/notifications": "navNotifications", "/imports": "navImports", "/exports": "navExports",
  "/billing": "navBilling", "/settings": "navSettings"
};

export function AppShell({ children, path, user, locale, onNavigate, onLocaleChange, onSignOut, unreadCount = 0 }: {
  children: ReactNode; path: string; user: User; locale: Locale;
  onNavigate: (path: string) => void; onLocaleChange: (locale: Locale) => void;
  onSignOut: () => void; unreadCount?: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const t = (key: string) => translate(locale, key);
  const route = path.split("?")[0] || "/today";
  const titleKey = Object.entries(routeTitles).find(([prefix]) => route === prefix || route.startsWith(prefix + "/"))?.[1] ?? "navToday";

  function renderItem(item: NavItem) {
    const active = route === item.path || (item.path !== "/today" && route.startsWith(item.path + "/"));
    return <button key={item.path} className={`nav-item ${active ? "active" : ""}`} onClick={() => { onNavigate(item.path); setMobileMenu(false); }} title={collapsed ? t(item.label) : undefined} aria-current={active ? "page" : undefined}>
      <Icon name={item.icon} size={18} />
      <span>{t(item.label)}</span>
      {item.path === "/notifications" && unreadCount > 0 && <i className="nav-count">{unreadCount > 9 ? "9+" : unreadCount}</i>}
    </button>;
  }

  return <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
    <aside className={`sidebar ${mobileMenu ? "mobile-open" : ""}`} aria-label={t("navWorkspace")}>
      <button className="brand-lockup" onClick={() => onNavigate("/today")} aria-label="Vivarqo home">
        <span className="brand-mark"><Icon name="leaf" size={21} /></span>
        <span className="brand-copy"><strong>vivarqo</strong><small>{t("brandTagline")}</small></span>
      </button>
      <div className="nav-scroll">
        {groups.map((group) => <div className="nav-section" key={group.title}>
          <span className="nav-caption">{t(group.title)}</span>
          {group.items.map(renderItem)}
        </div>)}
      </div>
      <div className="sidebar-bottom">
        <button className="profile-card" onClick={() => { onNavigate("/settings"); setMobileMenu(false); }}>
          <span className="avatar">{user.displayName.trim().slice(0, 1).toUpperCase() || "V"}</span>
          <span className="profile-copy"><strong>{user.displayName}</strong><small>{user.email}</small></span>
          <Icon name="chevron" size={15} />
        </button>
        <div className="sidebar-tools">
          <button className="nav-item" onClick={() => onLocaleChange(locale === "it" ? "en" : "it")}><Icon name="globe" /><span>{locale === "it" ? "Italiano" : "English"}</span><small className="language-code">{locale.toUpperCase()}</small></button>
          <button className="nav-item" onClick={onSignOut}><Icon name="logout" /><span>{t("signOut")}</span></button>
        </div>
      </div>
      <IconButton className="collapse-button" label={collapsed ? t("expand") : t("collapse")} onClick={() => setCollapsed((value) => !value)}><Icon name="chevron" size={15} /></IconButton>
    </aside>
    {mobileMenu && <button className="mobile-scrim" aria-label={t("close")} onClick={() => setMobileMenu(false)} />}
    <div className="main-column">
      <header className="topbar">
        <button className="mobile-menu-button" onClick={() => setMobileMenu(true)} aria-label={t("expand")}><Icon name="menu" /></button>
        <div className="topbar-context"><span className="topbar-dot" />{t(titleKey)}</div>
        <div className="topbar-actions">
          <button className="global-search" onClick={() => onNavigate("/animals")} aria-label={t("search")}><Icon name="search" size={16} /><span>{t("search")}</span></button>
          <IconButton label={t("notifications")} onClick={() => onNavigate("/notifications")}><Icon name="bell" />{unreadCount > 0 && <i className="notification-dot" />}</IconButton>
          <button className="topbar-avatar" onClick={() => onNavigate("/settings")} aria-label={t("profile")}>{user.displayName.trim().slice(0, 1).toUpperCase() || "V"}</button>
        </div>
      </header>
      <main className="page-content">{children}</main>
      <footer className="app-footer"><span>Vivarqo</span><span>{new Date().getFullYear()}</span></footer>
    </div>
    <nav className="mobile-bottom-nav" aria-label={t("navWorkspace")}>
      {[
        { path: "/today", label: "navToday", icon: "home" as const },
        { path: "/animals", label: "navAnimals", icon: "snake" as const },
        { path: "/feeding", label: "navFeeding", icon: "feed" as const },
        { path: "/tasks", label: "navTasks", icon: "check" as const }
      ].map((item) => <button key={item.path} onClick={() => onNavigate(item.path)} className={route === item.path || route.startsWith(item.path + "/") ? "active" : ""}><Icon name={item.icon} size={18} /><span>{t(item.label)}</span></button>)}
      <button onClick={() => setMobileMenu(true)}><Icon name="more" size={18} /><span>{t("more")}</span></button>
    </nav>
  </div>;
}