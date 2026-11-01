import { useCallback, useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

/** Owns browser connectivity, install prompts and service-worker update events. */
export function useAppPlatform(onInstallUnavailable: () => void) {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const [pwaUpdateRegistration, setPwaUpdateRegistration] =
    useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);

    window.addEventListener("beforeinstallprompt", onInstall);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("beforeinstallprompt", onInstall);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    const onUpdateReady = (event: Event) => {
      const detail = (event as CustomEvent<{ registration?: ServiceWorkerRegistration }>).detail;
      setPwaUpdateRegistration(detail?.registration ?? null);
    };
    window.addEventListener("vivarqo:pwa-update-ready", onUpdateReady);
    return () => window.removeEventListener("vivarqo:pwa-update-ready", onUpdateReady);
  }, []);

  const installApp = useCallback(async () => {
    if (!installEvent) {
      onInstallUnavailable();
      return;
    }
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
  }, [installEvent, onInstallUnavailable]);

  return { online, pwaUpdateRegistration, installApp, clearPwaUpdate: () => setPwaUpdateRegistration(null) };
}
