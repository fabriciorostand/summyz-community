import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { aDashboard, aGuild, aSettings, chooseOption } from "../tests/test-utils";
import { DashboardLayout, useDashboard } from "./dashboard-layout";

vi.mock("../lib/api", () => ({
  api: {
    getDashboard: vi.fn(),
    getSettings: vi.fn(),
    listGuilds: vi.fn(),
    updatePreferences: vi.fn(),
  },
}));

function Probe() {
  const { controls, dashboard, patchSettings, period, reloadSettings, settings } = useDashboard();
  return (
    <div>
      <span data-testid="period">{period}</span>
      <span data-testid="mode">{settings.accessMode}</span>
      <span data-testid="application-id">{settings.discordApplicationId}</span>
      <span data-testid="openrouter">{String(settings.secrets.openRouterApiKey)}</span>
      <span data-testid="calls">{dashboard === undefined ? "…" : dashboard.totalCalls}</span>
      <button onClick={() => void reloadSettings()} type="button">
        reload
      </button>
      <button
        onClick={() =>
          patchSettings({ secrets: { discordBotToken: true, openRouterApiKey: true } })
        }
        type="button"
      >
        patch
      </button>
      {controls}
    </div>
  );
}

function renderLayout(settings = aSettings()) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<DashboardLayout settings={settings} />}>
          <Route element={<Probe />} index />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(api.listGuilds).mockResolvedValue([aGuild()]);
  vi.mocked(api.getDashboard).mockResolvedValue(aDashboard());
  vi.mocked(api.updatePreferences).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  document.documentElement.removeAttribute("data-theme");
});

describe("DashboardLayout", () => {
  it("groups the navigation the way the design does", async () => {
    renderLayout();
    expect(screen.getByText("Reuniões")).toBeInTheDocument();
    expect(screen.getByText("Configuração")).toBeInTheDocument();
    expect(screen.getByText("Sistema")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Preferências" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("link", { name: "Instalação" })).toHaveAttribute(
      "href",
      "/installation",
    );
    expect(screen.getByRole("img", { name: "Summyz" })).toHaveAttribute("src", "/summyz-logo.png");
    await waitFor(() => expect(api.getDashboard).toHaveBeenCalled());
  });

  it("has no account footer because there are no user accounts", async () => {
    renderLayout(aSettings({ accessMode: "public" }));
    expect(screen.queryByRole("button", { name: "Sair" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Minha conta" })).toBeNull();
    await waitFor(() => expect(api.getDashboard).toHaveBeenCalled());
  });

  it("shares the dashboard and the installation settings with the routes underneath", async () => {
    renderLayout();
    await waitFor(() => expect(screen.getByTestId("calls")).toHaveTextContent("42"));
    expect(screen.getByTestId("period")).toHaveTextContent("30d");
    expect(screen.getByTestId("mode")).toHaveTextContent("local");
  });

  it("feeds the sidebar counters", async () => {
    renderLayout();
    const calls = await screen.findByRole("link", { name: /Calls/ });
    await waitFor(() => expect(calls).toHaveTextContent("42"));
    expect(screen.getByRole("link", { name: /Tarefas/ })).toHaveTextContent("7");
  });

  it("persists a theme change through the installation preferences", async () => {
    renderLayout();
    await waitFor(() => expect(api.getDashboard).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: /tema/i }));
    await waitFor(() => expect(api.updatePreferences).toHaveBeenCalledWith("pt-BR", "light"));
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("outlines the initials of a server without an icon, closed and in the list", async () => {
    renderLayout();
    const picker = await screen.findByRole("combobox", { name: "Servidor" });
    expect(within(picker).getByText("PI")).toHaveClass("bg-action-soft", "border");
    await userEvent.click(picker);
    const option = screen.getByRole("option", { name: "Pixelforge" });
    expect(within(option).getByText("PI")).toHaveClass("bg-action-soft", "border");
  });

  it("persists a language change", async () => {
    renderLayout();
    await waitFor(() => expect(api.getDashboard).toHaveBeenCalled());
    await chooseOption("Idioma do dashboard", "English");
    await waitFor(() => expect(api.updatePreferences).toHaveBeenCalledWith("en", "dark"));
  });

  it("skips the dashboard request when the bot is in no server", async () => {
    vi.mocked(api.listGuilds).mockResolvedValue([]);
    renderLayout();
    await waitFor(() => expect(screen.getByTestId("calls")).toHaveTextContent("…"));
    expect(api.getDashboard).not.toHaveBeenCalled();
  });

  it("reloads the installation settings from the server on demand", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(
      aSettings({
        discordApplicationId: "999",
        secrets: { discordBotToken: true, openRouterApiKey: false },
      }),
    );
    renderLayout();
    await waitFor(() => expect(api.getDashboard).toHaveBeenCalled());
    expect(screen.getByTestId("openrouter")).toHaveTextContent("true");
    await userEvent.click(screen.getByRole("button", { name: "reload" }));
    await waitFor(() => expect(screen.getByTestId("openrouter")).toHaveTextContent("false"));
    expect(screen.getByTestId("application-id")).toHaveTextContent("999");
  });

  it("keeps the current settings when the reload fails", async () => {
    vi.mocked(api.getSettings).mockRejectedValue(new Error("offline"));
    renderLayout();
    await waitFor(() => expect(api.getDashboard).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "reload" }));
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled());
    expect(screen.getByTestId("openrouter")).toHaveTextContent("true");
    expect(screen.getByTestId("mode")).toHaveTextContent("local");
  });

  it("applies a local settings patch shared with every route", async () => {
    renderLayout(aSettings({ secrets: { discordBotToken: true, openRouterApiKey: false } }));
    await waitFor(() => expect(api.getDashboard).toHaveBeenCalled());
    expect(screen.getByTestId("openrouter")).toHaveTextContent("false");
    await userEvent.click(screen.getByRole("button", { name: "patch" }));
    expect(screen.getByTestId("openrouter")).toHaveTextContent("true");
    expect(api.getSettings).not.toHaveBeenCalled();
  });

  it("survives the dashboard request failing", async () => {
    vi.mocked(api.getDashboard).mockRejectedValue(new Error("offline"));
    renderLayout();
    await waitFor(() => expect(api.getDashboard).toHaveBeenCalled());
    expect(screen.getByTestId("calls")).toHaveTextContent("…");
  });
});
