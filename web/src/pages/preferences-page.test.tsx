import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { aSettings, chooseOption, dashboardContext, renderScreen } from "../tests/test-utils";
import { PreferencesPage } from "./preferences-page";

describe("PreferencesPage", () => {
  it("shows the preferences without header helper text", () => {
    renderScreen(<PreferencesPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Preferências" })).toBeInTheDocument();
    expect(screen.queryByText("Valem para a instalação inteira")).not.toBeInTheDocument();
    expect(screen.queryByText(/Não há contas/)).toBeNull();
    expect(screen.queryByText(/senha/i)).toBeNull();
  });

  it("saves the dashboard language", async () => {
    const setPreferences = vi.fn();
    renderScreen(<PreferencesPage />, { context: dashboardContext({ setPreferences }) });
    await chooseOption("Idioma do dashboard", "English");
    expect(setPreferences).toHaveBeenCalledWith({
      dashboardLanguage: "en",
      dashboardTheme: "dark",
    });
  });

  it("saves the theme, including following the system", async () => {
    const setPreferences = vi.fn();
    renderScreen(<PreferencesPage />, {
      context: dashboardContext({
        setPreferences,
        settings: aSettings({ dashboardLanguage: "en" }),
        theme: "light",
      }),
    });
    await chooseOption("Tema", "Seguir o sistema");
    expect(setPreferences).toHaveBeenCalledWith({
      dashboardLanguage: "en",
      dashboardTheme: "system",
    });
  });
});
