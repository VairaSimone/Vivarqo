import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api, ApiError, clearCsrfCache, setApiLocale, setUnauthorizedHandler } from "../lib/api";
import { AppShell } from "../layouts/AppShell";
const AuthPage = lazy(() => import("../features/AuthPage").then((module) => ({ default: module.AuthPage })));
const DashboardPage = lazy(() => import("../features/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const AnimalsPage = lazy(() => import("../features/AnimalsPage").then((module) => ({ default: module.AnimalsPage })));
const CarePage = lazy(() => import("../features/CarePage").then((module) => ({ default: module.CarePage })));
const OperationsPage = lazy(() => import("../features/OperationsPage").then((module) => ({ default: module.OperationsPage })));
const ReproductionPage = lazy(() => import("../features/ReproductionPage").then((module) => ({ default: module.ReproductionPage })));
const InventoryDocumentsPage = lazy(() => import("../features/InventoryDocumentsPage").then((module) => ({ default: module.InventoryDocumentsPage })));
const FinancePage = lazy(() => import("../features/FinancePage").then((module) => ({ default: module.FinancePage })));
const SettingsPage = lazy(() => import("../features/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const DataTransferPage = lazy(() => import("../features/DataTransferPage").then((module) => ({ default: module.DataTransferPage })));
const PublicAnimalPage = lazy(() => import("../features/PublicAnimalPage").then((module) => ({ default: module.PublicAnimalPage })));
import type { Locale } from "../lib/domain";
import { browserLocale, translate } from "../lib/i18n";
import { getString } from "../lib/domain";
import { useResource } from "../hooks/useResource";
import { Alert, Button, ErrorState, Icon, LoadingState } from "../components/ui";

type User = { id: string; displayName: string; email: string; locale: Locale; timezone: string };
type AccountPreferences = { preferences: Record<string, unknown> };

function currentPath(): string {
  return window.location.pathname + window.location.search;
}
function routeOnly(path: string): string {
  return path.split("?")[0] || "/";
}
function isPublicPath(path: string): boolean {
  return routeOnly(path).startsWith("/public/animals/");
}
function authMode(path: string): "login" | "register" | "forgot" | "reset" | "verify" | "resend" | null {
  const route = routeOnly(path);
  if (route === "/login") return "login";
  if (route === "/register") return "register";
  if (route === "/forgot-password") return "forgot";
  if (route === "/reset-password") return "reset";
  if (route === "/verify-email") return "verify";
  if (route === "/resend-verification") return "resend";
  return null;
}

export function App() {
  const [path, setPath] = useState(currentPath);
  const [locale, setLocale] = useState<Locale>(browserLocale());
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const t = (key: string) => translate(locale, key);
  const isPublic = isPublicPath(path);
  const authRoute = authMode(path);
  const timezone = user?.timezone || "Europe/Rome";
  const accountPrefs = useResource<AccountPreferences>(user ? "/account/preferences" : null);
  const notifications = useResource<{ unreadCount: number }>(user ? "/notifications?page=1&pageSize=1&unreadOnly=true" : null);

  const navigate = useCallback((nextPath: string) => {
    if (!nextPath.startsWith("/")) return;
    window.history.pushState({}, "", nextPath);
    setPath(currentPath());
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearCsrfCache();
      setUser(null);
      setAuthError("");
      navigate("/login");
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate]);

  useEffect(() => {
    const handlePopState = () => setPath(currentPath());
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("popstate", handlePopState);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    setApiLocale(locale);
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (!authRoute || !user) return;
    let active = true;
    api.get("/auth/me").then(() => {
      if (active) navigate("/today");
    }).catch((reason: unknown) => {
      if (!active) return;
      if (reason instanceof ApiError && reason.status === 401) {
        clearCsrfCache();
        setUser(null);
      } else {
        setAuthError(reason instanceof ApiError ? reason.message : t("operationFailed"));
        navigate("/today");
      }
    });
    return () => { active = false; };
  }, [authRoute, user, navigate]);

  useEffect(() => {
    if (isPublic) {
      setAuthReady(true);
      return;
    }
    let active = true;
    setAuthReady(false);
    api.get<{ user: User }>("/auth/me").then((result) => {
      if (!active) return;
      setUser(result.user);
      setLocale(result.user.locale === "en" ? "en" : "it");
      setAuthError("");
    }).catch((reason: unknown) => {
      if (!active) return;
      setUser(null);
      if (reason instanceof ApiError && reason.status !== 401) setAuthError(reason.message);
    }).finally(() => {
      if (active) setAuthReady(true);
    });
    return () => { active = false; };
  }, [isPublic]);

  useEffect(() => {
    if (!accountPrefs.data?.preferences) return;
    const theme = getString(accountPrefs.data.preferences, "theme", "system");
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => { document.documentElement.dataset.theme = theme === "system" ? (media.matches ? "dark" : "light") : theme; };
    apply();
    if (theme === "system") media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [accountPrefs.data]);

  async function changeLocale(nextLocale: Locale) {
    setLocale(nextLocale);
    setApiLocale(nextLocale);
    if (!user) return;
    try {
      const result = await api.patch<{ user?: User }>("/account", { locale: nextLocale });
      if (result.user) setUser(result.user);
      else {
        const latest = await api.get<{ user: User }>("/auth/me");
        setUser(latest.user);
      }
    } catch (reason) {
      setAuthError(reason instanceof ApiError ? reason.message : t("operationFailed"));
    }
  }

  async function signOut() {
    try { await api.post("/auth/logout"); }
    catch { /* The local session view is cleared when the server session has already expired. */ }
    clearCsrfCache();
    setUser(null);
    navigate("/login");
  }

  async function loginSuccess() {
    setAuthError("");
    try {
      const result = await api.get<{ user: User }>("/auth/me");
      setUser(result.user);
      setLocale(result.user.locale === "en" ? "en" : "it");
      const preferenceResult = await api.get<AccountPreferences>("/account/preferences").catch(() => null);
      const landing = getString(preferenceResult?.preferences, "defaultLandingPage", "today");
      navigate(landing === "animals" || landing === "calendar" ? "/" + landing : "/today");
    } catch (reason) {
      setAuthError(reason instanceof ApiError ? reason.message : t("operationFailed"));
    }
  }

  if (isPublic) {
    const slug = routeOnly(path).split("/").filter(Boolean).at(-1) ?? "";
    return <Suspense fallback={<div className="app-boot" role="status"><LoadingState /></div>}><PublicAnimalPage slug={slug} locale={locale} /></Suspense>;
  }

  if (authRoute && !user) {
    return <Suspense fallback={<div className="app-boot" role="status"><LoadingState /></div>}><AuthPage mode={authRoute} locale={locale} onSuccess={() => void loginSuccess()} navigate={navigate} onLocaleChange={setLocale} /></Suspense>;
  }

  if (!authReady) return <div className="app-boot"><span className="brand-mark"><Icon name="leaf" /></span><LoadingState /></div>;

  if (!user && routeOnly(path) === "/") {
    return <Suspense fallback={<div className="app-boot" role="status"><LoadingState /></div>}><AuthPage mode="login" locale={locale} onSuccess={() => void loginSuccess()} navigate={navigate} onLocaleChange={setLocale} /></Suspense>;
  }

  if (!user) {
    return <div className="auth-fallback"><Alert tone="danger">{authError || t("networkOffline")}</Alert><div className="inline-actions"><Button onClick={() => navigate("/login")}>{t("signIn")}</Button><Button variant="secondary" onClick={() => window.location.reload()}>{t("retry")}</Button></div></div>;
  }

  const route = routeOnly(path);
  let page;
  if (route === "/today" || route === "/") page = <DashboardPage locale={locale} timezone={timezone} navigate={navigate} />;
  else if (route.startsWith("/animals")) page = <AnimalsPage locale={locale} path={path} navigate={navigate} />;
  else if (route.startsWith("/feeding")) page = <CarePage locale={locale} path={path} />;
  else if (route.startsWith("/tasks") || route.startsWith("/calendar")) page = <OperationsPage locale={locale} path={path} timezone={timezone} navigate={navigate} />;
  else if (route.startsWith("/reproduction") || route.startsWith("/reproduction-cycles") || route.startsWith("/clutches")) page = <ReproductionPage locale={locale} path={path} navigate={navigate} />;
  else if (route.startsWith("/inventory") || route.startsWith("/documents")) page = <InventoryDocumentsPage locale={locale} path={path} navigate={navigate} />;
  else if (route.startsWith("/finance")) page = <FinancePage locale={locale} />;
  else if (route.startsWith("/imports")) page = <DataTransferPage locale={locale} mode="import" />;
  else if (route.startsWith("/exports")) page = <DataTransferPage locale={locale} mode="export" />;
  else if (route.startsWith("/notifications") || route.startsWith("/settings") || route.startsWith("/billing")) page = <SettingsPage locale={locale} path={path} user={user} onLocaleChange={changeLocale} onUserUpdated={setUser} navigate={navigate} />;
  else page = <ErrorState message={locale === "it" ? "Pagina non trovata." : "Page not found."} retry={() => navigate("/today")} />;

  return <AppShell path={path} user={user} locale={locale} onNavigate={navigate} onLocaleChange={changeLocale} onSignOut={() => void signOut()} unreadCount={notifications.data?.unreadCount ?? 0}>
    {!online && <div className="offline-banner" role="status"><Icon name="alert" size={15} />{t("networkOffline")}</div>}
    {authError && <div className="global-alert"><Alert tone="danger">{authError}</Alert><button onClick={() => setAuthError("")}>{t("close")}</button></div>}
    <Suspense fallback={<div className="app-boot" role="status"><LoadingState /></div>}>{page}</Suspense>
  </AppShell>;
}
