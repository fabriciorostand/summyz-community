import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { aDashboard, aGuild, aSettings } from "../tests/test-utils";
import { DashboardLayout, useDashboard } from "./dashboard-layout";

vi.mock("../lib/api", () => ({
  api: {
    getDashboard: vi.fn(),
    listGuilds: vi.fn(),
    updatePreferences: vi.fn(),
  },
}));

function Probe() {
  const { controls, dashboard, period, settings } = useDashboard();
  return (
    <div>
      <span data-testid="period">{period}</span>
      <span data-testid="mode">{settings.accessMode}</span>
      <span data-testid="calls">{dashboard === undefined ? "…" : dashboard.totalCalls}</span>
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

  it("persists a language change", async () => {
    renderLayout();
    await waitFor(() => expect(api.getDashboard).toHaveBeenCalled());
    await userEvent.selectOptions(screen.getByLabelText("Idioma do dashboard"), "en");
    await waitFor(() => expect(api.updatePreferences).toHaveBeenCalledWith("en", "dark"));
  });

  it("skips the dashboard request when the bot is in no server", async () => {
    vi.mocked(api.listGuilds).mockResolvedValue([]);
    renderLayout();
    await waitFor(() => expect(screen.getByTestId("calls")).toHaveTextContent("…"));
    expect(api.getDashboard).not.toHaveBeenCalled();
  });

  it("survives the dashboard request failing", async () => {
    vi.mocked(api.getDashboard).mockRejectedValue(new Error("offline"));
    renderLayout();
    await waitFor(() => expect(api.getDashboard).toHaveBeenCalled());
    expect(screen.getByTestId("calls")).toHaveTextContent("…");
  });
});
