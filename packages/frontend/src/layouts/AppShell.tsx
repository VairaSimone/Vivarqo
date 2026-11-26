import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AnimalDto } from "@vivarqo/contracts/animals";
import type { DocumentDto } from "@vivarqo/contracts/inventory";
import type { ReproductionCycleSummaryDto } from "@vivarqo/contracts/reproduction";
import type { TaskDto } from "@vivarqo/contracts/operations";
import { api } from "../lib/api";
import { Icon, IconButton, Input, Modal } from "../components/ui";
import { getString, queryString } from "../lib/domain";
import type { Locale } from "../lib/domain";
import { translate } from "../lib/i18n";
import { OnboardingTour } from "../components/OnboardingTour";
import { openCookiePreferences } from "../lib/cookieConsent";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};
type User = { displayName: string; email: string; locale: Locale };
type NavItem = { path: string; label: string; icon: "home" | "calendar" | "check" | "snake" | "feed" | "leaf" | "box" | "file" | "wallet" | "settings" | "bell" | "help" };

function groupsForCategories(categories: string[]): Array<{ title: string; items: NavItem[] }> {
  const has = (category: string) => categories.includes(category);
  const animalItems: NavItem[] = [
    { path: "/animals", label: "navAnimals", icon: "snake" },
    { path: "/feeding", label: "navFeeding", icon: "feed" },
  ];
  if (has("reptiles") || has("birds")) animalItems.push({ path: "/reproduction", label: "navBreeding", icon: "leaf" });
  if (has("reptiles")) animalItems.push({ path: "/genetics", label: "navGenetics", icon: "leaf" });
  if (has("fish")) animalItems.push({ path: "/aquariums", label: "navAquariums", icon: "box" });
  if (has("birds")) animalItems.push({ path: "/aviaries", label: "navAviaries", icon: "leaf" });
  if (has("dogs_cats")) animalItems.push({ path: "/companion-care", label: "navCompanionCare", icon: "check" });
  return [
    { title: "navWorkspace", items: [
      { path: "/today", label: "navToday", icon: "home" },
      { path: "/calendar", label: "navCalendar", icon: "calendar" },
      { path: "/tasks", label: "navTasks", icon: "check" }
    ] },
    { title: "navAnimals", items: animalItems },
    { title: "navAdmin", items: [
      { path: "/inventory", label: "navInventory", icon: "box" },
      { path: "/documents", label: "navDocuments", icon: "file" },
      { path: "/finance", label: "navFinance", icon: "wallet" },
      { path: "/imports", label: "navImports", icon: "file" },
      { path: "/exports", label: "navExports", icon: "box" }
    ] },
    { title: "navPreferences", items: [
      { path: "/help", label: "navHelp", icon: "help" },
      { path: "/notifications", label: "navNotifications", icon: "bell" },
      { path: "/billing", label: "navBilling", icon: "wallet" },
      { path: "/settings/categories", label: "navCategories", icon: "settings" },
      { path: "/settings", label: "navSettings", icon: "settings" }
    ] }
  ];
}

const routeTitles: Record<string, string> = {
  "/today": "navToday", "/calendar": "navCalendar", "/tasks": "navTasks",
  "/animals": "navAnimals", "/feeding": "navFeeding", "/reproduction": "navBreeding",
  "/aquariums": "navAquariums", "/aviaries": "navAviaries", "/companion-care": "navCompanionCare",
  "/reproduction-cycles": "navBreeding", "/clutches": "navBreeding", "/genetics": "navGenetics",
  "/inventory": "navInventory", "/documents": "navDocuments", "/finance": "navFinance",
  "/notifications": "navNotifications", "/imports": "navImports", "/exports": "navExports",
  "/billing": "navBilling", "/settings/categories": "navCategories", "/settings": "navSettings", "/help": "navHelp"
};

export function AppShell({ children, path, user, locale, onNavigate, onLocaleChange, onSignOut, unreadCount = 0 }: {
  children: ReactNode; path: string; user: User; locale: Locale;
  onNavigate: (path: string) => void; onLocaleChange: (locale: Locale) => void;
  onSignOut: () => void; unreadCount?: number;
}) {
  const [animalCategories, setAnimalCategories] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ id: string; title: string; subtitle: string; group: string; path: string }>>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [searchRetry, setSearchRetry] = useState(0);
  const [showTour, setShowTour] = useState(false);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [appInstalled, setAppInstalled] = useState(false);
  const [iosDevice, setIosDevice] = useState(false);
  const mobileMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const t = (key: string) => translate(locale, key);

  useEffect(() => {
    let active = true;
    if (path !== "/settings/categories") {
      api.get<{ categories: string[] }>("/onboarding/configuration")
        .then((configuration) => { if (active) setAnimalCategories(configuration.categories); })
        .catch(() => { if (active) setAnimalCategories([]); });
    }
    return () => { active = false; };
  }, [path]);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    setAppInstalled(standalone);
    const userAgent = navigator.userAgent;
    setIosDevice(/iPad|iPhone|iPod/.test(userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    const readInstallPrompt = () => {
      const deferred = (window as Window & { __deferredPwaInstallPrompt?: BeforeInstallPromptEvent }).__deferredPwaInstallPrompt;
      if (deferred) setInstallPrompt(deferred);
    };
    const onAppInstalled = () => {
      setAppInstalled(true);
      setInstallPrompt(null);
      setInstallHelpOpen(false);
    };
    readInstallPrompt();
    window.addEventListener("pwa-install-available", readInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("pwa-install-available", readInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  useEffect(() => {
    if (!installHelpOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setInstallHelpOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [installHelpOpen]);

  async function installApplication() {
    if (!installPrompt) return;
    const promptEvent = installPrompt;
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === "accepted") setAppInstalled(true);
    } catch {
      // Keep the manual installation instructions available if the browser prompt fails.
    } finally {
      setInstallPrompt(null);
      delete (window as Window & { __deferredPwaInstallPrompt?: BeforeInstallPromptEvent }).__deferredPwaInstallPrompt;
    }
  }
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
        api.get<{ animals: AnimalDto[] }>("/animals" + queryString({ page: 1, pageSize: 5, status: "all", q: query }), { signal: controller.signal }),
        api.get<{ tasks: TaskDto[] }>("/tasks" + queryString({ page: 1, pageSize: 5, status: "all", q: query }), { signal: controller.signal }),
        api.get<{ documents: DocumentDto[] }>("/documents" + queryString({ page: 1, pageSize: 5, q: query }), { signal: controller.signal }),
        api.get<{ cycles: ReproductionCycleSummaryDto[] }>("/reproduction-cycles" + queryString({ page: 1, pageSize: 5, status: "all", q: query }), { signal: controller.signal }),
        api.get<{ sessions: Array<Record<string, unknown>> }>("/feeding-sessions" + queryString({ page: 1, pageSize: 5, q: query }), { signal: controller.signal }),
        api.get<{ items: Array<Record<string, unknown>> }>("/inventory/items" + queryString({ page: 1, pageSize: 5, active: "all", q: query }), { signal: controller.signal }),
        api.get<{ entries: Array<Record<string, unknown>> }>("/finance/entries" + queryString({ page: 1, pageSize: 5, q: query }), { signal: controller.signal }),
        api.get<{ genes: Array<Record<string, unknown>> }>("/genetics/catalog", { signal: controller.signal }),
      ]);
      if (!active || controller.signal.aborted) return;
      const [animalResponse, taskResponse, documentResponse, cycleResponse, feedingResponse, inventoryResponse, financeResponse, geneticsResponse] = requests;
      const results = [
        ...(animalResponse.status === "fulfilled" ? animalResponse.value.animals.map((item) => ({
          id: getString(item, "id"), title: getString(item, "name"), subtitle: getString(item, "species"), group: t("navAnimals"), path: "/animals/" + getString(item, "id")
        })) : []),
        ...(taskResponse.status === "fulfilled" ? taskResponse.value.tasks.map((item) => ({
          id: getString(item, "id"), title: getString(item, "title"), subtitle: getString(item.animal, "name") || getString(item, "status"), group: t("navTasks"), path: "/tasks/" + getString(item, "id")
        })) : []),
        ...(documentResponse.status === "fulfilled" ? documentResponse.value.documents.map((item) => ({
          id: getString(item, "id"), title: getString(item, "originalFilename"), subtitle: getString(item, "category"), group: t("navDocuments"), path: "/documents?q=" + encodeURIComponent(query)
        })) : []),
        ...(cycleResponse.status === "fulfilled" ? cycleResponse.value.cycles.map((item) => ({
          id: getString(item, "id"), title: getString(item, "name") || t("cycles"), subtitle: getString(item, "status"), group: t("navBreeding"), path: "/reproduction-cycles/" + getString(item, "id")
        })) : []),
        ...(feedingResponse.status === "fulfilled" ? feedingResponse.value.sessions.map((item) => {
          const entries = Array.isArray(item.entries) ? item.entries as Array<Record<string, unknown>> : [];
          const firstEntry = entries[0];
          const animal = firstEntry?.animal;
          return { id: getString(item, "id"), title: entries.length === 1 ? getString(animal, "name") : (locale === "it" ? "Sessione di alimentazione" : "Feeding session"), subtitle: getString(firstEntry, "foodType") || getString(item, "performedAt"), group: t("navFeeding"), path: "/feeding?q=" + encodeURIComponent(query) };
        }) : []),
        ...(inventoryResponse.status === "fulfilled" ? inventoryResponse.value.items.map((item) => ({
          id: getString(item, "id"), title: getString(item, "name"), subtitle: getString(item, "category"), group: t("navInventory"), path: "/inventory?q=" + encodeURIComponent(query)
        })) : []),
        ...(financeResponse.status === "fulfilled" ? financeResponse.value.entries.map((item) => ({
          id: getString(item, "id"), title: getString(item, "description") || getString(item, "category"), subtitle: getString(item, "occurredOn"), group: t("navFinance"), path: "/finance?q=" + encodeURIComponent(query)
        })) : []),
        ...(geneticsResponse.status === "fulfilled" ? geneticsResponse.value.genes
          .filter((gene) => [getString(gene, "name"), getString(gene, "symbol"), getString(gene, "species")].some((value) => value.toLocaleLowerCase().includes(query.toLocaleLowerCase())))
          .slice(0, 5).map((gene) => ({
            id: getString(gene, "id"), title: getString(gene, "name"), subtitle: getString(gene, "species") + " · " + getString(gene, "symbol"), group: t("navGenetics"), path: "/genetics"
          })) : []),
      ].filter((item) => item.id && item.title).slice(0, 30);
      setSearchResults(results);
      setSearchFailed(requests.every((result) => result.status === "rejected"));
      setSearchLoading(false);
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [searchOpen, searchTerm, locale, searchRetry]);

  function closeSearch() {
    setSearchOpen(false);
    setSearchTerm("");
    setSearchResults([]);
  }

  function renderItem(item: NavItem) {
    const active = route === item.path || (item.path !== "/today" && route.startsWith(item.path + "/"))
      || (item.path === "/reproduction" && (route.startsWith("/reproduction-cycles") || route.startsWith("/clutches")));
    return <button key={item.path} className={`nav-item ${active ? "active" : ""}`} aria-label={t(item.label)} onClick={() => { onNavigate(item.path); setMobileMenu(false); }} title={collapsed ? t(item.label) : undefined} aria-current={active ? "page" : undefined}>
      <Icon name={item.icon} size={18} />
      <span>{t(item.label)}</span>
      {item.path === "/notifications" && unreadCount > 0 && <i className="nav-count">{unreadCount > 9 ? "9+" : unreadCount}</i>}
    </button>;
  }

  return <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
    <a className="skip-link" href="#main-content">{locale === "en" ? "Skip to main content" : "Vai al contenuto principale"}</a>
    <aside id="application-sidebar" className={`sidebar ${mobileMenu ? "mobile-open" : ""}`} aria-label={locale === "it" ? "Navigazione principale" : "Main navigation"} role={mobileMenu ? "dialog" : undefined} aria-modal={mobileMenu || undefined} tabIndex={mobileMenu ? -1 : undefined}>
      <button className="brand-lockup" onClick={() => onNavigate("/today")} aria-label="Vivarqo home">
        <span className="brand-mark"><Icon name="brand" size={23} /></span>
        <span className="brand-copy"><strong>Vivarqo</strong><small>{t("brandTagline")}</small></span>
      </button>
      <div className="nav-scroll">
        {groupsForCategories(animalCategories).map((group) => <div className="nav-section" key={group.title}>
          <span className="nav-caption">{group.title === "navAdmin" ? (locale === "it" ? "GESTIONE" : "MANAGEMENT") : group.title === "navPreferences" ? (locale === "it" ? "ACCOUNT" : "ACCOUNT") : t(group.title)}</span>
          {group.items.map(renderItem)}
        </div>)}
      </div>
      <div className="sidebar-bottom">
        <button className="profile-card" onClick={() => { onNavigate("/settings"); setMobileMenu(false); }}>
          <span className="avatar">{user.displayName.trim().slice(0, 1).toUpperCase() || "S"}</span>
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
          <button type="button" className="pwa-install-trigger" onClick={() => setInstallHelpOpen(true)} aria-haspopup="dialog" aria-label={t("pwaInstallTitle")}>
            <Icon name="download" size={16} /><span>{appInstalled ? t("pwaInstalled") : t("pwaInstallButton")}</span>
          </button>
          <button type="button" className="tour-trigger" onClick={() => setShowTour(true)}><Icon name="alert" size={16} /><span>{locale === "it" ? "Guida" : "Guide"}</span></button>
          <IconButton label={t("notifications")} onClick={() => onNavigate("/notifications")}><Icon name="bell" />{unreadCount > 0 && <i className="notification-dot" />}</IconButton>
          <button className="topbar-avatar" onClick={() => onNavigate("/settings")} aria-label={t("profile")}>{user.displayName.trim().slice(0, 1).toUpperCase() || "S"}</button>
        </div>
      </header>
      <main id="main-content" className="page-content" tabIndex={-1}>{children}</main>
      <footer className="app-footer"><span>Vivarqo · {new Date().getFullYear()}</span><nav aria-label={locale === "it" ? "Informazioni legali" : "Legal information"}><button type="button" onClick={() => onNavigate("/settings/privacy")}>{locale === "it" ? "Centro privacy" : "Privacy centre"}</button><button type="button" onClick={() => onNavigate("/legal/privacy")}>Privacy</button><button type="button" onClick={() => onNavigate("/legal/cookies")}>Cookie</button><button type="button" onClick={openCookiePreferences}>{locale === "it" ? "Preferenze cookie" : "Cookie preferences"}</button><button type="button" onClick={() => onNavigate("/legal/terms")}>{locale === "it" ? "Termini" : "Terms"}</button><button type="button" onClick={() => onNavigate("/legal/accessibility")}>{locale === "it" ? "Accessibilità" : "Accessibility"}</button></nav></footer>
    </div>
    <nav className="mobile-bottom-nav" aria-label={t("navWorkspace")} inert={mobileMenu}>
      {[
        { path: "/today", label: "navToday", icon: "home" as const },
        { path: "/animals", label: "navAnimals", icon: "snake" as const },
        { path: "/feeding", label: "navFeeding", icon: "feed" as const },
        { path: "/tasks", label: "navTasks", icon: "check" as const }
      ].map((item) => {
        const active = route === item.path || route.startsWith(item.path + "/");
        return <button
          type="button"
          key={item.path}
          onClick={() => onNavigate(item.path)}
          className={active ? "active" : ""}
          aria-current={active ? "page" : undefined}
          aria-label={t(item.label)}
        >
          <Icon name={item.icon} size={18} />
          {item.path === "/feeding"
            ? <span><span className="mobile-nav-label-full">{t(item.label)}</span><span className="mobile-nav-label-short">{t("navFeedingShort")}</span></span>
            : <span>{t(item.label)}</span>}
        </button>;
      })}
      <button type="button" aria-label={t("more")} onClick={() => setMobileMenu(true)}><Icon name="more" size={18} /><span>{t("more")}</span></button>
    </nav>
    {installHelpOpen && <div className="pwa-install-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setInstallHelpOpen(false); }}>
      <section className="pwa-install-dialog" role="dialog" aria-modal="true" aria-labelledby="pwa-install-title">
        <button autoFocus className="pwa-install-close" type="button" onClick={() => setInstallHelpOpen(false)} aria-label={t("close")}>×</button>
        <div className="pwa-install-icon"><Icon name="download" size={25} /></div>
        <p className="pwa-install-eyebrow">{t("pwaInstallEyebrow")}</p>
        <h2 id="pwa-install-title">{appInstalled ? t("pwaInstalledTitle") : t("pwaInstallTitle")}</h2>
        <p className="pwa-install-description">{t("pwaInstallDescription")}</p>
        {appInstalled ? <div className="pwa-install-success" role="status">{t("pwaInstalledDescription")}</div> : <>
          {installPrompt && <button className="btn btn-primary pwa-install-action" type="button" onClick={() => void installApplication()}><Icon name="download" size={17} />{t("pwaInstallNow")}</button>}
          <div className="pwa-install-steps">
            {iosDevice ? <>
              <h3>{t("pwaIosTitle")}</h3>
              <ol><li>{t("pwaIosStep1")}</li><li>{t("pwaIosStep2")}</li><li>{t("pwaIosStep3")}</li></ol>
            </> : <>
              <h3>{t("pwaAndroidTitle")}</h3>
              <ol><li>{t("pwaAndroidStep1")}</li><li>{t("pwaAndroidStep2")}</li></ol>
              <h3>{t("pwaDesktopTitle")}</h3>
              <ol><li>{t("pwaDesktopStep1")}</li><li>{t("pwaDesktopStep2")}</li><li>{t("pwaDesktopStep3")}</li></ol>
            </>}
          </div>
          <p className="pwa-install-footnote">{t("pwaInstallFootnote")}</p>
        </>}
      </section>
    </div>}
    {showTour && <OnboardingTour locale={locale} onNavigate={(next) => { onNavigate(next); setShowTour(false); }} onClose={() => setShowTour(false)} />}
    {searchOpen && <Modal title={t("search")} onClose={closeSearch} wide>
      <div className="global-search-panel">
        <Input type="search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} />
        {searchTerm.trim().length < 2
          ? <p className="muted-note">{t("searchMinChars")}</p>
          : searchLoading ? <p className="muted-note" role="status">{t("loading")}</p>
          : searchFailed ? <div className="remote-select-error" role="alert"><p className="muted-note">{t("searchFailed")}</p><button type="button" className="btn btn-secondary btn-sm" onClick={() => setSearchRetry((value) => value + 1)}>{locale === "it" ? "Riprova" : "Retry"}</button></div>
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