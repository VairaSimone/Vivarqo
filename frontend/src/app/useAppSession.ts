import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../api/api";
import { errorMessage, type AccountUser, type NoticeKind } from "../types";
import { getLocale, setLocale, type AppLocale } from "../i18n";

type NoticeHandler = (text: string, kind?: NoticeKind) => void;
export type SessionStatus = "checking" | "authenticated" | "unauthenticated";

/** Owns account loading, authentication expiry and the persisted account locale. */
export function useAppSession(onNotice: NoticeHandler) {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("checking");
  const [sessionError, setSessionError] = useState<string | null>(null);

  const handleUnauthorized = useCallback(() => {
    setUser(null);
    setSessionError(null);
    setSessionStatus("unauthenticated");
  }, []);

  const loadMe = useCallback(async () => {
    setSessionStatus("checking");
    setSessionError(null);
    try {
      const response = await apiRequest("auth/me");
      const accountUser = (response.user ?? response) as AccountUser;
      setUser(accountUser);
      if (accountUser.locale === "it" || accountUser.locale === "en") {
        setLocale(accountUser.locale);
      }
      setSessionStatus("authenticated");
      return true;
    } catch (error) {
      const status = typeof error === "object" && error !== null && "status" in error
        ? (error as { status?: number }).status
        : undefined;
      if (status === 401) {
        setUser(null);
        setSessionError(null);
        setSessionStatus("unauthenticated");
      } else {
        // A network/server failure does not prove that the session is invalid.
        setSessionError(errorMessage(error));
        setSessionStatus("checking");
      }
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

  return {
    user, setUser, sessionStatus, sessionError, loadMe,
    handleUnauthorized, endSession: handleUnauthorized, updateLocale, syncLocale
  };
}
