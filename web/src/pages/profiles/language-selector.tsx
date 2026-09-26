import type { SelectOption } from "../../components/select";
import { SelectField } from "../../components/ui";

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

const languageOptions: readonly SelectOption<ProfileLanguage>[] = profileLanguages.map(
  (language) => ({ label: language, value: language }),
);

/** Picks the next unused "Perfil N" so a new profile never collides with an existing name. */
export function nextLocalizedProfileName(
  items: ReadonlyArray<{ profile: { name: string } }>,
  locale: "en" | "pt-BR",
): string {
  const prefix = locale === "pt-BR" ? "Perfil" : "Profile";
  const taken = new Set(items.map(({ profile }) => profile.name.toLocaleLowerCase(locale)));
  let next = 1;
  while (taken.has(`${prefix} ${String(next)}`.toLocaleLowerCase(locale))) next += 1;
  return `${prefix} ${String(next)}`;
}

export function LanguageSelector({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: ProfileLanguage) => void;
  value: ProfileLanguage;
}) {
  return <SelectField label={label} onChange={onChange} options={languageOptions} value={value} />;
}
