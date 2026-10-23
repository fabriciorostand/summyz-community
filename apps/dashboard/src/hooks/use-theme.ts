import { useCallback, useEffect, useState } from "react";

import { applyTheme, readStoredTheme, storeTheme, type ThemePreference } from "../lib/theme";

/** Keeps the document theme in sync with the preference this browser remembers. */
export function useTheme(): {
  preference: ThemePreference;
  setPreference(value: ThemePreference): void;
} {
  const [preference, setPreferenceState] = useState<ThemePreference>(
    () => readStoredTheme() ?? "system",
  );

  useEffect(() => {
    applyTheme(preference);
    if (preference !== "system" || typeof matchMedia !== "function") return;
    const query = matchMedia("(prefers-color-scheme: light)");
    const listener = () => applyTheme("system");
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, [preference]);

  const setPreference = useCallback((value: ThemePreference) => {
    storeTheme(value);
    setPreferenceState(value);
  }, []);

  return { preference, setPreference };
}
