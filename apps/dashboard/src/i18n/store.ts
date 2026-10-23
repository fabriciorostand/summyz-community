import { useSyncExternalStore } from "react";

import { createFormatter, type Formatter } from "./formatter";
import { en } from "./messages/en";
import { type Messages, ptBR } from "./messages/pt-BR";
import {
  browserLanguages,
  browserTimeZone,
  type DateFormat,
  type DateFormatPreference,
  detectLanguage,
  type Language,
  preferenceStorageKeys,
  readStoredDateFormat,
  readStoredLanguage,
  readStoredTimeFormat,
  resolveDateFormat,
  resolveTimeFormat,
  storeDateFormat,
  storeLanguage,
  storeTimeFormat,
  type TimeFormat,
  type TimeFormatPreference,
} from "./preferences";

export interface I18nSnapshot {
  /** The calendar format in effect, with "auto" already resolved from the browser region. */
  dateFormat: DateFormat;
  dateFormatPreference: DateFormatPreference;
  format: Formatter;
  language: Language;
  t: Messages;
  timeFormat: TimeFormat;
  timeFormatPreference: TimeFormatPreference;
  /** The zone the dashboard asks the API for and shows dates in: always the browser's. */
  timeZone: string;
}

const dictionaries: Record<Language, Messages> = { en, "pt-BR": ptBR };

function build(): I18nSnapshot {
  const browser = browserLanguages();
  const language = readStoredLanguage() ?? detectLanguage(browser);
  const region = browser[0] ?? "en-US";
  const dateFormatPreference = readStoredDateFormat();
  const timeFormatPreference = readStoredTimeFormat();
  const dateFormat =
    dateFormatPreference === "auto" ? resolveDateFormat(region) : dateFormatPreference;
  const timeFormat =
    timeFormatPreference === "auto" ? resolveTimeFormat(region) : timeFormatPreference;
  return {
    dateFormat,
    dateFormatPreference,
    format: createFormatter({ dateFormat, language, timeFormat }),
    language,
    t: dictionaries[language],
    timeFormat,
    timeFormatPreference,
    timeZone: browserTimeZone(),
  };
}

let snapshot: I18nSnapshot | undefined;
const listeners = new Set<() => void>();

export function getI18n(): I18nSnapshot {
  snapshot ??= build();
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reads the browser and the stored choices again and tells every subscriber. */
export function reloadPreferences(): void {
  snapshot = build();
  document.documentElement.lang = snapshot.language;
  for (const listener of listeners) listener();
}

export function setLanguage(value: Language): void {
  storeLanguage(value);
  reloadPreferences();
}

export function setDateFormat(value: DateFormatPreference): void {
  storeDateFormat(value);
  reloadPreferences();
}

export function setTimeFormat(value: TimeFormatPreference): void {
  storeTimeFormat(value);
  reloadPreferences();
}

/** Applies the language to the document and follows choices made in other tabs. */
export function startI18n(): () => void {
  document.documentElement.lang = getI18n().language;
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && preferenceStorageKeys.includes(event.key)) reloadPreferences();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

export function useI18n(): I18nSnapshot {
  return useSyncExternalStore(subscribe, getI18n, getI18n);
}
