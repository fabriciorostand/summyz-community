export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const storageKey = "summyz:theme";
const preferences: readonly ThemePreference[] = ["system", "light", "dark"];

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== "system") return preference;
  // A browser that cannot answer the query still deserves the default palette.
  if (typeof matchMedia !== "function") return "dark";
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference);
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

export function readStoredTheme(): ThemePreference | undefined {
  try {
    const stored = localStorage.getItem(storageKey);
    return preferences.find((preference) => preference === stored);
  } catch {
    // Private windows and blocked site data are expected, not exceptional.
    return undefined;
  }
}

export function storeTheme(preference: ThemePreference): void {
  try {
    localStorage.setItem(storageKey, preference);
  } catch {
    // The preference still applies to this session; persistence is best-effort.
  }
}
