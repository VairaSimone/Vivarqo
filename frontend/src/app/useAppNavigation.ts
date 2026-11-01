import { useCallback, useEffect, useState } from "react";
import type { NavigationHandler } from "../types";
import { animalIdFromLocation, initialSectionFromPath, SECTION_PATHS } from "./navigation";

export interface AppNavigationState {
  active: string;
  targetAnimalId: string | null;
  go: NavigationHandler;
}

/**
 * Keeps the selected section and the browser URL in sync.
 * Route parsing is centralized so direct links and Back/Forward behave identically.
 */
export function useAppNavigation(onRouteChange: () => void): AppNavigationState {
  const [active, setActive] = useState(() => initialSectionFromPath(window.location.pathname));
  const [targetAnimalId, setTargetAnimalId] = useState<string | null>(() => animalIdFromLocation());

  const syncFromLocation = useCallback(() => {
    setActive(initialSectionFromPath(window.location.pathname));
    setTargetAnimalId(animalIdFromLocation());
    onRouteChange();
  }, [onRouteChange]);

  useEffect(() => {
    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, [syncFromLocation]);

  const go = useCallback<NavigationHandler>((section, options = {}) => {
    const animalId = options.animalId || null;
    const basePath = section === "animali" && animalId
      ? "/animals/" + encodeURIComponent(animalId)
      : SECTION_PATHS[section] || "/";
    const nextPath = animalId && section !== "animali"
      ? basePath + "?animal=" + encodeURIComponent(animalId)
      : basePath;

    if (window.location.pathname + window.location.search !== nextPath) {
      window.history.pushState({ section }, "", nextPath);
    }

    setActive(section);
    setTargetAnimalId(animalId);
    onRouteChange();
  }, [onRouteChange]);

  return { active, targetAnimalId, go };
}
