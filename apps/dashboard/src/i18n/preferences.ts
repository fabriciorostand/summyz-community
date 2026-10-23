export const languages = ["pt-BR", "en"] as const;
export type Language = (typeof languages)[number];

/** Each language keeps its own name in pickers, whatever language the dashboard is in. */
export const languageNames: Record<Language, string> = {
  en: "English",
  "pt-BR": "Português (Brasil)",
};

/** The API accepts exactly these calendar and clock formats, so the dashboard offers the same. */
export const dateFormats = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"] as const;
export type DateFormat = (typeof dateFormats)[number];
export const timeFormats = ["24h", "12h"] as const;
export type TimeFormat = (typeof timeFormats)[number];

/** "auto" follows the region of the browser's first language. */
export type DateFormatPreference = "auto" | DateFormat;
export type TimeFormatPreference = "auto" | TimeFormat;

const storageKeys = {
  dateFormat: "summyz:date-format",
  language: "summyz:language",
  timeFormat: "summyz:time-format",
} as const;

/**
 * Picks the first supported language in the browser's order of preference. Only Brazilian
 * Portuguese counts as Portuguese; every English variant counts as English.
 */
export function detectLanguage(browserLanguages: readonly string[]): Language {
  for (const tag of browserLanguages) {
    const normalized = tag.toLowerCase();
    if (normalized === "pt-br") return "pt-BR";
    if (normalized === "en" || normalized.startsWith("en-")) return "en";
  }
  return "en";
}

export function browserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  if (navigator.languages.length > 0) return navigator.languages;
  return navigator.language.length > 0 ? [navigator.language] : [];
}

export function resolveDateFormat(regionLocale: string): DateFormat {
  let order: Intl.DateTimeFormatPartTypes[];
  try {
    order = new Intl.DateTimeFormat(regionLocale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
      .formatToParts(new Date(Date.UTC(2026, 11, 31, 12)))
      .map((part) => part.type)
      .filter((type) => type === "day" || type === "month" || type === "year");
  } catch {
    return "DD/MM/YYYY";
  }
  if (order[0] === "year") return "YYYY-MM-DD";
  return order[0] === "month" ? "MM/DD/YYYY" : "DD/MM/YYYY";
}

export function resolveTimeFormat(regionLocale: string): TimeFormat {
  try {
    const { hourCycle } = new Intl.DateTimeFormat(regionLocale, {
      hour: "numeric",
    }).resolvedOptions();
    return hourCycle === "h11" || hourCycle === "h12" ? "12h" : "24h";
  } catch {
    return "24h";
  }
}

/** Same rule as the API: UTC or a regional IANA identifier this runtime knows. */
export function isAcceptedTimeZone(value: string): boolean {
  if (value !== "UTC" && !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/u.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

/** The zone every calendar query and date on screen uses; UTC when the API would refuse it. */
export function browserTimeZone(): string {
  const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isAcceptedTimeZone(zone) ? zone : "UTC";
}

function readStored<T extends string>(key: string, accepted: readonly T[]): T | undefined {
  try {
    const stored = localStorage.getItem(key);
    return accepted.find((value) => value === stored);
  } catch {
    // Private windows and blocked site data are expected, not exceptional.
    return undefined;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The choice still applies to this session; persistence is best-effort.
  }
}

export function readStoredLanguage(): Language | undefined {
  return readStored(storageKeys.language, languages);
}

export function readStoredDateFormat(): DateFormatPreference {
  return readStored(storageKeys.dateFormat, dateFormats) ?? "auto";
}

export function readStoredTimeFormat(): TimeFormatPreference {
  return readStored(storageKeys.timeFormat, timeFormats) ?? "auto";
}

export function storeLanguage(value: Language): void {
  store(storageKeys.language, value);
}

export function storeDateFormat(value: DateFormatPreference): void {
  store(storageKeys.dateFormat, value);
}

export function storeTimeFormat(value: TimeFormatPreference): void {
  store(storageKeys.timeFormat, value);
}

export const preferenceStorageKeys: readonly string[] = Object.values(storageKeys);
