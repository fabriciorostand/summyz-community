import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { aDashboard, aGuild, aUser } from "../tests/test-utils";
import { DashboardLayout, useDashboard } from "./dashboard-layout";

vi.mock("../lib/api", () => ({
  api: {
    getDashboard: vi.fn(),
    listGuilds: vi.fn(),
    logout: vi.fn(),
    updatePreferences: vi.fn(),
  },
}));

function Probe() {
  const { controls, dashboard, period } = useDashboard();
  return (
    <div>
      <span data-testid="period">{period}</span>
      <span data-testid="calls">{dashboard === undefined ? "…" : dashboard.totalCalls}</span>
      {controls}
    </div>
  );
}

function renderLayout(user = aUser()) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<DashboardLayout user={user} />}>
          <Route element={<Probe />} index />
        </Route>
        <Route element={<span>tela de login</span>} path="/login" />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(api.listGuilds).mockResolvedValue([aGuild()]);
  vi.mocked(api.getDashboard).mockResolvedValue(aDashboard());
  vi.mocked(api.logout).mockResolvedValue(undefined);
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
    await waitFor(() => expect(api.getDashboard).toHaveBeenCalled());
  });

  it("shares the dashboard with the routes underneath", async () => {
    renderLayout();
    await waitFor(() => expect(screen.getByTestId("calls")).toHaveTextContent("42"));
    expect(screen.getByTestId("period")).toHaveTextContent("30d");
  });

  it("feeds the sidebar counters", async () => {
    renderLayout();
    const calls = await screen.findByRole("link", { name: /Calls/ });
    await waitFor(() => expect(calls).toHaveTextContent("42"));
    expect(screen.getByRole("link", { name: /Tarefas/ })).toHaveTextContent("7");
  });

  it("hides the installation entry from a plain member", async () => {
    renderLayout(aUser({ installationRole: "member" }));
    expect(screen.queryByRole("link", { name: "Instalação" })).toBeNull();
    await waitFor(() => expect(api.getDashboard).toHaveBeenCalled());
  });

  it("shows the installation entry to an administrator", async () => {
    renderLayout();
    expect(screen.getByRole("link", { name: "Instalação" })).toHaveAttribute(
      "href",
      "/installation",
    );
    await waitFor(() => expect(api.getDashboard).toHaveBeenCalled());
  });

  it("signs the operator out", async () => {
    renderLayout();
    await userEvent.click(screen.getByRole("button", { name: "Sair" }));
    await waitFor(() => expect(api.logout).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("tela de login")).toBeInTheDocument();
  });

  it("persists a theme change through the account preferences", async () => {
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

  it("skips the dashboard request when no server is installed", async () => {
    vi.mocked(api.listGuilds).mockResolvedValue([aGuild({ installed: false })]);
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
