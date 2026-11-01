import { useEffect, useState } from "react";
import { apiRequest } from "../api/api";
import type { AccountUser, AnyRecord } from "../types";

export interface MeasurementPreferences {
  weightUnit: "g" | "kg" | "oz" | "lb";
  temperatureUnit: "C" | "F";
}

/** Loads account display preferences and applies the chosen global theme. */
export function useAppPreferences(user: AccountUser | null): { measurementPreferences: MeasurementPreferences } {
  const [measurementPreferences, setMeasurementPreferences] = useState<MeasurementPreferences>({
    weightUnit: "g",
    temperatureUnit: "C"
  });
  const [themePreference, setThemePreference] = useState<"system" | "light" | "dark">("system");

  useEffect(() => {
    let active = true;
    const applyPreferences = (value?: AnyRecord) => {
      const prefs = value ?? {};
      const candidate = String(prefs.weightUnit ?? "g");
      const weightUnit = (["g", "kg", "oz", "lb"].includes(candidate) ? candidate : "g") as MeasurementPreferences["weightUnit"];
      const temperatureUnit = String(prefs.temperatureUnit ?? "c").toLowerCase() === "f" ? "F" : "C";
      setMeasurementPreferences({ weightUnit, temperatureUnit });

      const theme = String(prefs.theme ?? "system");
      setThemePreference(theme === "dark" || theme === "light" ? theme : "system");
    };

    const loadPreferences = async () => {
      if (!user) {
        applyPreferences();
        return;
      }
      try {
        const response = await apiRequest<AnyRecord>("account/preferences");
        if (active) applyPreferences(response.preferences);
      } catch {
        if (active) applyPreferences();
      }
    };

    const onPreferencesUpdated = (event: Event) => {
      const detail = (event as CustomEvent<AnyRecord>).detail;
      if (detail && typeof detail === "object") applyPreferences(detail);
    };

    void loadPreferences();
    window.addEventListener("vivarqo:preferences-updated", onPreferencesUpdated);
    return () => {
      active = false;
      window.removeEventListener("vivarqo:preferences-updated", onPreferencesUpdated);
    };
  }, [user?.id]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolved = themePreference === "system" ? (media.matches ? "dark" : "light") : themePreference;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    };

    applyTheme();
    if (themePreference === "system") media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [themePreference]);

  return { measurementPreferences };
}
