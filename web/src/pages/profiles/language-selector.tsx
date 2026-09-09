import { useState } from "react";

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
  onChange,
  value,
}: {
  onChange: (value: ProfileLanguage) => void;
  value: ProfileLanguage;
}) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  const visible = profileLanguages.filter(
    (language) =>
      language === value ||
      normalized.length === 0 ||
      language.toLocaleLowerCase("pt-BR").includes(normalized),
  );
  return (
    <label className="flex flex-col gap-1.5">
      <Label>Idioma do resumo</Label>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
        <input
          aria-label="Pesquisar idioma"
          autoComplete="off"
          className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-[13.5px] outline-none placeholder:text-ink-dim focus:border-action"
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Pesquisar uma tag BCP 47"
          type="search"
          value={query}
        />
        <select
          aria-label="Idioma"
          className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-[13.5px] outline-none focus:border-action"
          onChange={(event) => {
            const selected = profileLanguages.find(
              (language) => language === event.currentTarget.value,
            );
            if (selected !== undefined) onChange(selected);
          }}
          value={value}
        >
          {visible.map((language) => (
            <option key={language} value={language}>
              {language === "auto" ? "auto — usa o idioma predominante" : language}
            </option>
          ))}
        </select>
      </div>
      {visible.length === 1 && visible[0] === value && normalized.length > 0 && (
        <small className="text-[11px] text-ink-dim">
          Nenhuma outra tag corresponde à pesquisa.
        </small>
      )}
    </label>
  );
}
