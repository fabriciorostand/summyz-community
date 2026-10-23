import type { SelectOption } from "../../components/select";
import { SelectField } from "../../components/ui";
import type { Formatter } from "../../i18n/formatter";
import type { Language } from "../../i18n/preferences";
import { type I18nSnapshot, useI18n } from "../../i18n/store";

export const profileLanguages = [
  "auto",
  "ar",
  "cs",
  "da",
  "de",
  "el",
  "en",
  "en-GB",
  "en-US",
  "es",
  "es-ES",
  "es-MX",
  "fi",
  "fr",
  "fr-CA",
  "he",
  "hi",
  "hu",
  "id",
  "it",
  "ja",
  "ko",
  "nl",
  "no",
  "pl",
  "pt",
  "pt-BR",
  "pt-PT",
  "ro",
  "ru",
  "sv",
  "th",
  "tr",
  "uk",
  "vi",
  "zh",
  "zh-CN",
  "zh-TW",
] as const;

export type ProfileLanguage = (typeof profileLanguages)[number];

/** Names a profile language in the dashboard language; "auto" gets the caller's wording. */
export function languageLabel(
  language: ProfileLanguage,
  autoLabel: string,
  format: Formatter,
): string {
  return language === "auto" ? autoLabel : format.languageName(language);
}

function languageOptions(
  autoLabel: string,
  { format, language: dashboardLanguage }: Pick<I18nSnapshot, "format" | "language">,
): SelectOption<ProfileLanguage>[] {
  const named = profileLanguages
    .filter((language) => language !== "auto")
    .map((language) => ({ label: languageLabel(language, autoLabel, format), value: language }))
    .sort((left, right) => left.label.localeCompare(right.label, dashboardLanguage));
  return [{ label: autoLabel, value: "auto" }, ...named];
}

/**
 * Picks the next unused "<prefix> N" so a new profile never collides with an existing name.
 * The prefix comes from the dashboard language of whoever creates the profile.
 */
export function nextLocalizedProfileName(
  items: ReadonlyArray<{ profile: { name: string } }>,
  prefix: string,
  locale: Language,
): string {
  const taken = new Set(items.map(({ profile }) => profile.name.toLocaleLowerCase(locale)));
  let next = 1;
  while (taken.has(`${prefix} ${String(next)}`.toLocaleLowerCase(locale))) next += 1;
  return `${prefix} ${String(next)}`;
}

export function LanguageSelector({
  autoLabel,
  label,
  onChange,
  value,
}: {
  autoLabel: string;
  label: string;
  onChange: (value: ProfileLanguage) => void;
  value: ProfileLanguage;
}) {
  const i18n = useI18n();
  return (
    <SelectField
      label={label}
      onChange={onChange}
      options={languageOptions(autoLabel, i18n)}
      value={value}
    />
  );
}
