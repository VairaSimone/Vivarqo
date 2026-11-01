import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../api/api";
import { errorMessage, type AccountUser, type NoticeKind } from "../types";
import { getLocale, setLocale, type AppLocale } from "../i18n";

type NoticeHandler = (text: string, kind?: NoticeKind) => void;

/** Owns account loading, authentication expiry and the persisted account locale. */
export function useAppSession(onNotice: NoticeHandler) {
  const [user, setUser] = useState<AccountUser | null>(null);

  const handleUnauthorized = useCallback(() => setUser(null), []);

  const loadMe = useCallback(async () => {
    try {
      const response = await apiRequest("auth/me");
      const accountUser = (response.user ?? response) as AccountUser;
      setUser(accountUser);
      if (accountUser.locale === "it" || accountUser.locale === "en") {
        setLocale(accountUser.locale);
      }
      return true;
    } catch {
      setUser(null);
      return false;
    }
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  const syncLocale = useCallback((nextLocale: AppLocale) => {
    setLocale(nextLocale);
    setUser(current => current ? { ...current, locale: nextLocale } : current);
  }, []);

  const updateLocale = useCallback(async (nextLocale: AppLocale) => {
    const previousLocale = getLocale();
    syncLocale(nextLocale);

    try {
      await apiRequest("account", { method: "PATCH", body: { locale: nextLocale } });
    } catch (error) {
      syncLocale(previousLocale);
      onNotice(errorMessage(error), "error");
    }
  }, [onNotice, syncLocale]);

  return { user, setUser, loadMe, handleUnauthorized, updateLocale, syncLocale };
}
