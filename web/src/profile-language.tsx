import { useState } from "react";

export function nextLocalizedProfileName(
  items: ReadonlyArray<{ profile: { name: string } }>,
  locale: "en" | "pt-BR",
): string {
  const prefix = locale === "pt-BR" ? "Perfil" : "Profile";
  const existingNames = new Set(items.map(({ profile }) => profile.name.toLocaleLowerCase(locale)));
  let nextNumber = 1;
  while (existingNames.has(`${prefix} ${nextNumber}`.toLocaleLowerCase(locale))) {
    nextNumber += 1;
  }
  return `${prefix} ${nextNumber}`;
}

const profileLanguageOptions = [
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

export function LanguageSelector({
  onChange,
  value,
}: {
  onChange: (value: (typeof profileLanguageOptions)[number]) => void;
  value: (typeof profileLanguageOptions)[number];
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
  const visibleOptions = profileLanguageOptions.filter(
    (language) =>
      language === value ||
      normalizedQuery.length === 0 ||
      language.toLocaleLowerCase("pt-BR").includes(normalizedQuery),
  );
  return (
    <div className="field language-selector">
      <span>Idioma</span>
      <input
        aria-label="Pesquisar idioma"
        autoComplete="off"
        onChange={(event) => setQuery(event.currentTarget.value)}
        placeholder="Pesquisar uma tag BCP 47"
        type="search"
        value={query}
      />
      <select
        aria-label="Idioma"
        onChange={(event) => {
          const selected = profileLanguageOptions.find(
            (language) => language === event.currentTarget.value,
          );
          if (selected !== undefined) onChange(selected);
        }}
        value={value}
      >
        {visibleOptions.map((language) => (
          <option key={language} value={language}>
            {language === "auto" ? "auto — recomendado" : language}
          </option>
        ))}
      </select>
      {visibleOptions.length === 1 && visibleOptions[0] === value && normalizedQuery.length > 0 && (
        <small>Nenhuma outra tag corresponde à pesquisa.</small>
      )}
    </div>
  );
}
