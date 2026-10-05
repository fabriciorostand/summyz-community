import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { getI18n } from "../i18n/store";
import { chooseOption, dashboardContext, openOptions, renderScreen } from "../tests/test-utils";
import { PreferencesPage } from "./preferences-page";

describe("PreferencesPage", () => {
  it("shows the preferences without header helper text", () => {
    renderScreen(<PreferencesPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Preferências" })).toBeInTheDocument();
    expect(screen.queryByText("Valem para a instalação inteira")).not.toBeInTheDocument();
    expect(screen.queryByText(/Não há contas/)).toBeNull();
    expect(screen.queryByText(/senha/i)).toBeNull();
  });

  it("gives language, theme, and date and time a section each", () => {
    renderScreen(<PreferencesPage />);
    expect(screen.queryByRole("heading", { name: "Idioma, data e tema" })).toBeNull();
    const language = screen.getByRole("region", { name: "Idioma" });
    const theme = screen.getByRole("region", { name: "Tema" });
    const dateTime = screen.getByRole("region", { name: "Data e hora" });
    expect(within(language).getByRole("combobox", { name: "Idioma" })).toBeInTheDocument();
    expect(within(theme).getByRole("combobox", { name: "Tema" })).toBeInTheDocument();
    expect(within(dateTime).getByRole("combobox", { name: "Formato de data" })).toBeInTheDocument();
    expect(within(dateTime).getByRole("combobox", { name: "Formato de hora" })).toBeInTheDocument();
  });

  it("keeps the language section to its select, with no explanatory text", () => {
    renderScreen(<PreferencesPage />);
    const language = screen.getByRole("region", { name: "Idioma" });
    expect(within(language).queryByText(/têm idioma próprio/)).toBeNull();
    expect(within(language).queryByRole("paragraph")).toBeNull();
    expect(within(language).getByRole("combobox", { name: "Idioma" })).not.toHaveAttribute(
      "aria-describedby",
    );
  });

  it("stacks the sections in a single column", () => {
    renderScreen(<PreferencesPage />);
    const sections = ["Idioma", "Tema", "Data e hora"].map((name) =>
      screen.getByRole("region", { name }),
    );
    const column = sections[0]?.parentElement;
    expect(column).toHaveClass("flex-col");
    expect(column).not.toHaveClass("sm:grid-cols-2");
    expect([...(column?.children ?? [])]).toEqual(sections);
    for (const section of sections) expect(section).not.toHaveClass("sm:col-span-2");
  });

  it("keeps date and time side by side, with single selects in the same first column", () => {
    renderScreen(<PreferencesPage />);
    const dateTime = screen.getByRole("region", { name: "Data e hora" });
    const date = within(dateTime).getByRole("combobox", { name: "Formato de data" });
    const pair = date.closest(".grid");
    expect(pair).toHaveClass("sm:grid-cols-2", "gap-3");
    expect(pair).toContainElement(
      within(dateTime).getByRole("combobox", { name: "Formato de hora" }),
    );
    for (const name of ["Idioma", "Tema"]) {
      expect(screen.getByRole("combobox", { name }).closest(".grid")).toHaveClass(
        "sm:grid-cols-2",
        "gap-3",
      );
    }
  });

  it("switches the dashboard language in this browser", async () => {
    renderScreen(<PreferencesPage />);
    await chooseOption("Idioma", "English");

    expect(getI18n().language).toBe("en");
    expect(localStorage.getItem("summyz:language")).toBe("en");
    expect(screen.getByRole("heading", { level: 1, name: "Preferences" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Date and time" })).toBeInTheDocument();
  });

  it("offers the automatic date format and the three formats the API accepts", async () => {
    renderScreen(<PreferencesPage />);
    const list = await openOptions("Formato de data");
    expect([...list.querySelectorAll("[role=option]")].map((option) => option.textContent)).toEqual(
      ["Automático (região do navegador)", "31/12/2026", "12/31/2026", "2026-12-31"],
    );
  });

  it("saves an explicit date format and can go back to automatic", async () => {
    renderScreen(<PreferencesPage />);
    await chooseOption("Formato de data", "2026-12-31");
    expect(getI18n()).toMatchObject({
      dateFormat: "YYYY-MM-DD",
      dateFormatPreference: "YYYY-MM-DD",
    });

    await chooseOption("Formato de data", "Automático (região do navegador)");
    expect(getI18n()).toMatchObject({ dateFormat: "DD/MM/YYYY", dateFormatPreference: "auto" });
  });

  it("saves the time format", async () => {
    renderScreen(<PreferencesPage />);
    await chooseOption("Formato de hora", "11:30 PM");
    expect(getI18n()).toMatchObject({ timeFormat: "12h", timeFormatPreference: "12h" });
  });

  it("saves the theme, including following the system", async () => {
    const setTheme = vi.fn();
    renderScreen(<PreferencesPage />, {
      context: dashboardContext({ setTheme, theme: "light" }),
    });
    await chooseOption("Tema", "Seguir o sistema");
    expect(setTheme).toHaveBeenCalledWith("system");
  });
});
