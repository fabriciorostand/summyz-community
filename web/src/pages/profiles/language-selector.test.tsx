import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { chooseOption } from "../../tests/test-utils";
import { LanguageSelector, languageLabel } from "./language-selector";

describe("language selector", () => {
  it("names languages instead of showing their codes", () => {
    expect(languageLabel("pt-BR", "Detectar automaticamente")).toBe("Português (Brasil)");
    expect(languageLabel("en", "Detectar automaticamente")).toBe("Inglês");
    expect(languageLabel("auto", "Mesmo idioma da reunião")).toBe("Mesmo idioma da reunião");
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
});
