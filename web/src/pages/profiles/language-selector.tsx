import { Label } from "../../components/ui";

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
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div className="grid gap-3 sm:grid-cols-2">
        <select
          aria-label={label}
          className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-[13.5px] outline-none focus:border-action"
          onChange={(event) => {
            const selected = profileLanguages.find(
              (language) => language === event.currentTarget.value,
            );
            if (selected !== undefined) onChange(selected);
          }}
          value={value}
        >
          {profileLanguages.map((language) => (
            <option key={language} value={language}>
              {language}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
