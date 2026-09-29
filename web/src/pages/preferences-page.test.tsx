import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { getI18n } from "../i18n/store";
import { chooseOption, dashboardContext, openOptions, renderScreen } from "../tests/test-utils";
import { PreferencesPage } from "./preferences-page";

describe("PreferencesPage", () => {
  it("shows the preferences without header helper text", () => {
    renderScreen(<PreferencesPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Preferências" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Idioma, data e tema" })).toBeInTheDocument();
    expect(screen.queryByText("Valem para a instalação inteira")).not.toBeInTheDocument();
    expect(screen.queryByText(/Não há contas/)).toBeNull();
    expect(screen.queryByText(/senha/i)).toBeNull();
  });

  it("switches the dashboard language in this browser", async () => {
    renderScreen(<PreferencesPage />);
    await chooseOption("Idioma do dashboard", "English");

    expect(getI18n().language).toBe("en");
    expect(localStorage.getItem("summyz:language")).toBe("en");
    expect(screen.getByRole("heading", { level: 1, name: "Preferences" })).toBeInTheDocument();
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
