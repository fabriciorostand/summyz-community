import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { getI18n, setLanguage } from "../../i18n/store";
import { chooseOption, openOptions } from "../../tests/test-utils";
import { LanguageSelector, languageLabel, nextLocalizedProfileName } from "./language-selector";

describe("language selector", () => {
  it("names languages instead of showing their codes", () => {
    const { format } = getI18n();
    expect(languageLabel("pt-BR", "Detectar automaticamente", format)).toBe("Português (Brasil)");
    expect(languageLabel("en", "Detectar automaticamente", format)).toBe("Inglês");
    expect(languageLabel("auto", "Mesmo idioma da reunião", format)).toBe(
      "Mesmo idioma da reunião",
    );
  });

  it("names languages in the dashboard language", () => {
    setLanguage("en");
    const { format } = getI18n();
    expect(languageLabel("pt-BR", "Detect automatically", format)).toBe("Brazilian Portuguese");
    expect(languageLabel("de", "Detect automatically", format)).toBe("German");
  });

  it("shows the automatic choice first and saves the language code", async () => {
    const onChange = vi.fn();
    render(
      <LanguageSelector
        autoLabel="Detectar automaticamente"
        label="Idioma falado na reunião"
        onChange={onChange}
        value="auto"
      />,
    );

    expect(screen.getByRole("combobox", { name: "Idioma falado na reunião" })).toHaveTextContent(
      "Detectar automaticamente",
    );
    await userEvent.click(screen.getByRole("combobox", { name: "Idioma falado na reunião" }));
    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Detectar automaticamente");
    await userEvent.keyboard("{Escape}");
    await chooseOption("Idioma falado na reunião", "Português (Brasil)");

    expect(onChange).toHaveBeenCalledWith("pt-BR");
  });

  it("sorts the named languages alphabetically in the dashboard language", async () => {
    setLanguage("en");
    render(
      <LanguageSelector
        autoLabel="Detect automatically"
        label="Summary language"
        onChange={vi.fn()}
        value="auto"
      />,
    );
    const labels = [...(await openOptions("Summary language")).querySelectorAll("[role=option]")]
      .slice(1)
      .map((option) => option.textContent ?? "");
    expect(labels).toEqual([...labels].sort((left, right) => left.localeCompare(right, "en")));
    expect(labels[0]).toBe("American English");
  });
});

describe("nextLocalizedProfileName", () => {
  const named = (...names: string[]) => names.map((name) => ({ profile: { name } }));

  it("picks the first unused number with the prefix of the dashboard language", () => {
    expect(nextLocalizedProfileName(named("Perfil 1", "perfil 2"), "Perfil", "pt-BR")).toBe(
      "Perfil 3",
    );
    expect(nextLocalizedProfileName(named("Perfil 1"), "Profile", "en")).toBe("Profile 1");
  });
});
