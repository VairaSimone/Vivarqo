import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { Icon, IconButton, Input, Modal } from "../components/ui";
import { getArray, getString, queryString } from "../lib/domain";
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
  "/reproduction-cycles": "navBreeding", "/clutches": "navBreeding",
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ id: string; title: string; subtitle: string; group: string; path: string }>>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const mobileMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const t = (key: string) => translate(locale, key);
  const route = path.split("?")[0] || "/today";
  const titleKey = Object.entries(routeTitles).find(([prefix]) => route === prefix || route.startsWith(prefix + "/"))?.[1] ?? "navToday";

  useEffect(() => {
    if (!mobileMenu) return;
    const sidebar = document.getElementById("application-sidebar");
    const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = () => Array.from(sidebar?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
      .filter((element) => !element.closest('[hidden], [inert], [aria-hidden="true"]') && element.getClientRects().length > 0);
    const first = () => focusable()[0] ?? sidebar;
    first()?.focus();

    const onFocusIn = (event: FocusEvent) => {
      if (sidebar && event.target instanceof Node && !sidebar.contains(event.target)) first()?.focus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileMenu(false);
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (!elements.length) {
        event.preventDefault();
        sidebar?.focus();
        return;
      }
      const firstElement = elements[0]!;
      const lastElement = elements[elements.length - 1]!;
      if (event.shiftKey && (document.activeElement === firstElement || !sidebar?.contains(document.activeElement))) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && (document.activeElement === lastElement || !sidebar?.contains(document.activeElement))) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("focusin", onFocusIn);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("keydown", onKeyDown);
      mobileMenuTriggerRef.current?.focus();
    };
  }, [mobileMenu]);

  useEffect(() => {
    const query = searchTerm.trim();
    if (!searchOpen || query.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchFailed(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(async () => {
      setSearchLoading(true);
      setSearchFailed(false);
      const requests = await Promise.allSettled([
        api.get<Record<string, unknown>>("/animals" + queryString({ page: 1, pageSize: 5, status: "all", q: query }), { signal: controller.signal }),
        api.get<Record<string, unknown>>("/tasks" + queryString({ page: 1, pageSize: 5, status: "all", q: query }), { signal: controller.signal }),
        api.get<Record<string, unknown>>("/documents" + queryString({ page: 1, pageSize: 5, q: query }), { signal: controller.signal }),
        api.get<Record<string, unknown>>("/reproduction-cycles" + queryString({ page: 1, pageSize: 5, status: "all", q: query }), { signal: controller.signal }),
      ]);
      if (!active || controller.signal.aborted) return;
      const [animalResponse, taskResponse, documentResponse, cycleResponse] = requests;
      const results = [
        ...(animalResponse.status === "fulfilled" ? getArray<Record<string, unknown>>(animalResponse.value, "animals").map((item) => ({
          id: getString(item, "id"), title: getString(item, "name"), subtitle: getString(item, "species"), group: t("navAnimals"), path: "/animals/" + getString(item, "id")
        })) : []),
        ...(taskResponse.status === "fulfilled" ? getArray<Record<string, unknown>>(taskResponse.value, "tasks").map((item) => ({
          id: getString(item, "id"), title: getString(item, "title"), subtitle: getString(item.animal, "name") || getString(item, "status"), group: t("navTasks"), path: "/tasks?q=" + encodeURIComponent(query)
        })) : []),
        ...(documentResponse.status === "fulfilled" ? getArray<Record<string, unknown>>(documentResponse.value, "documents").map((item) => ({
          id: getString(item, "id"), title: getString(item, "originalFilename"), subtitle: getString(item, "category"), group: t("navDocuments"), path: "/documents?q=" + encodeURIComponent(query)
        })) : []),
        ...(cycleResponse.status === "fulfilled" ? getArray<Record<string, unknown>>(cycleResponse.value, "cycles").map((item) => ({
          id: getString(item, "id"), title: getString(item, "name") || t("cycles"), subtitle: getString(item, "status"), group: t("navBreeding"), path: "/reproduction-cycles/" + getString(item, "id")
        })) : []),
      ].filter((item) => item.id && item.title).slice(0, 20);
      setSearchResults(results);
      setSearchFailed(requests.every((result) => result.status === "rejected"));
      setSearchLoading(false);
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [searchOpen, searchTerm, locale]);

  function closeSearch() {
    setSearchOpen(false);
    setSearchTerm("");
    setSearchResults([]);
  }

  function renderItem(item: NavItem) {
    const active = route === item.path || (item.path !== "/today" && route.startsWith(item.path + "/"))
      || (item.path === "/reproduction" && (route.startsWith("/reproduction-cycles") || route.startsWith("/clutches")));
    return <button key={item.path} className={`nav-item ${active ? "active" : ""}`} onClick={() => { onNavigate(item.path); setMobileMenu(false); }} title={collapsed ? t(item.label) : undefined} aria-current={active ? "page" : undefined}>
      <Icon name={item.icon} size={18} />
      <span>{t(item.label)}</span>
      {item.path === "/notifications" && unreadCount > 0 && <i className="nav-count">{unreadCount > 9 ? "9+" : unreadCount}</i>}
    </button>;
  }

  return <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
    <a className="skip-link" href="#main-content">{locale === "en" ? "Skip to main content" : "Vai al contenuto principale"}</a>
    <aside id="application-sidebar" className={`sidebar ${mobileMenu ? "mobile-open" : ""}`} aria-label={t("navWorkspace")} role={mobileMenu ? "dialog" : undefined} aria-modal={mobileMenu || undefined} tabIndex={mobileMenu ? -1 : undefined}>
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
    {mobileMenu && <button className="mobile-scrim" aria-label={t("close")} tabIndex={-1} onClick={() => setMobileMenu(false)} />}
    <div className="main-column" inert={mobileMenu}>
      <header className="topbar">
        <button ref={mobileMenuTriggerRef} className="mobile-menu-button" onClick={() => setMobileMenu(true)} aria-label={t("expand")} aria-expanded={mobileMenu} aria-controls="application-sidebar"><Icon name="menu" /></button>
        <div className="topbar-context"><span className="topbar-dot" />{t(titleKey)}</div>
        <div className="topbar-actions">
          <button className="global-search" onClick={() => setSearchOpen(true)} aria-label={t("search")} aria-haspopup="dialog"><Icon name="search" size={16} /><span>{t("search")}</span></button>
          <IconButton label={t("notifications")} onClick={() => onNavigate("/notifications")}><Icon name="bell" />{unreadCount > 0 && <i className="notification-dot" />}</IconButton>
          <button className="topbar-avatar" onClick={() => onNavigate("/settings")} aria-label={t("profile")}>{user.displayName.trim().slice(0, 1).toUpperCase() || "V"}</button>
        </div>
      </header>
      <main id="main-content" className="page-content" tabIndex={-1}>{children}</main>
      <footer className="app-footer"><span>Vivarqo</span><span>{new Date().getFullYear()}</span></footer>
    </div>
    <nav className="mobile-bottom-nav" aria-label={t("navWorkspace")} inert={mobileMenu}>
      {[
        { path: "/today", label: "navToday", icon: "home" as const },
        { path: "/animals", label: "navAnimals", icon: "snake" as const },
        { path: "/feeding", label: "navFeeding", icon: "feed" as const },
        { path: "/tasks", label: "navTasks", icon: "check" as const }
      ].map((item) => <button key={item.path} onClick={() => onNavigate(item.path)} className={route === item.path || route.startsWith(item.path + "/") ? "active" : ""}><Icon name={item.icon} size={18} /><span>{t(item.label)}</span></button>)}
      <button onClick={() => setMobileMenu(true)}><Icon name="more" size={18} /><span>{t("more")}</span></button>
    </nav>
    {searchOpen && <Modal title={t("search")} onClose={closeSearch} wide>
      <div className="global-search-panel">
        <Input type="search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} />
        {searchTerm.trim().length < 2
          ? <p className="muted-note">{t("searchMinChars")}</p>
          : searchLoading ? <p className="muted-note" role="status">{t("loading")}</p>
          : searchFailed ? <p className="muted-note" role="alert">{t("searchFailed")}</p>
          : searchResults.length ? <div className="global-search-results" role="list">
              {searchResults.map((result) => <button type="button" role="listitem" className="global-search-result" key={result.group + result.id}
                onClick={() => { onNavigate(result.path); closeSearch(); }}>
                <span className="global-search-result-group">{result.group}</span>
                <strong>{result.title}</strong>
                {result.subtitle && <small>{result.subtitle}</small>}
              </button>)}
            </div>
          : <p className="muted-note">{t("searchNoResults")}</p>}
      </div>
    </Modal>}
  </div>;
}