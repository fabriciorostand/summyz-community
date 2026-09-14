import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { aSettings, dashboardContext, renderScreen } from "../tests/test-utils";
import { PreferencesPage } from "./preferences-page";

describe("PreferencesPage", () => {
  it("frames the choices as installation-wide", () => {
    renderScreen(<PreferencesPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Preferências" })).toBeInTheDocument();
    expect(screen.getByText("Valem para a instalação inteira")).toBeInTheDocument();
    expect(screen.getByText(/Não há contas/)).toBeInTheDocument();
    expect(screen.queryByText(/senha/i)).toBeNull();
  });

  it("saves the dashboard language", async () => {
    const setPreferences = vi.fn();
    renderScreen(<PreferencesPage />, { context: dashboardContext({ setPreferences }) });
    await userEvent.selectOptions(screen.getByLabelText("Idioma do dashboard"), "en");
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
    await userEvent.selectOptions(screen.getByLabelText("Tema"), "system");
    expect(setPreferences).toHaveBeenCalledWith({
      dashboardLanguage: "en",
      dashboardTheme: "system",
    });
  });
});
