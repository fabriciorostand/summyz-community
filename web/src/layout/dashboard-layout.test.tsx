import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { aDashboard, aGuild, aSettings, chooseOption } from "../tests/test-utils";
import { DashboardLayout, useDashboard } from "./dashboard-layout";
import { TopBar } from "./top-bar";

vi.mock("../lib/api", () => ({
  api: {
    getDashboard: vi.fn(),
    getSettings: vi.fn(),
    listGuilds: vi.fn(),
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

function Page({ title }: { title: string }) {
  return <TopBar title={title} />;
}

function renderWithTopBar() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<DashboardLayout settings={aSettings()} />}>
          <Route element={<Page title="Visão geral" />} index />
          <Route element={<Page title="Tarefas abertas" />} path="tasks" />
        </Route>
      </Routes>
    </MemoryRouter>,
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

  it("asks for the metrics in the browser time zone", async () => {
    renderLayout();
    await waitFor(() =>
      expect(api.getDashboard).toHaveBeenCalledWith("g1", "30d", "America/Sao_Paulo"),
    );
  });

  it("feeds the sidebar counters", async () => {
    renderLayout();
    const calls = await screen.findByRole("link", { name: /Calls/ });
    await waitFor(() => expect(calls).toHaveTextContent("42"));
    expect(screen.getByRole("link", { name: /Tarefas/ })).toHaveTextContent("7");
  });

  it("remembers a theme change in this browser", async () => {
    localStorage.setItem("summyz:theme", "dark");
    renderLayout();
    await waitFor(() => expect(api.getDashboard).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: /tema/i }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("summyz:theme")).toBe("light");
  });

  it("outlines the initials of a server without an icon, closed and in the list", async () => {
    renderLayout();
    const picker = await screen.findByRole("combobox", { name: "Servidor" });
    expect(within(picker).getByText("PI")).toHaveClass("bg-action-soft", "border");
    await userEvent.click(picker);
    const option = screen.getByRole("option", { name: "Pixelforge" });
    expect(within(option).getByText("PI")).toHaveClass("bg-action-soft", "border");
  });

  it("gives the server, language and theme controls the same height", async () => {
    renderLayout();
    expect(await screen.findByRole("combobox", { name: "Servidor" })).toHaveClass("h-[34px]");
    expect(screen.getByRole("combobox", { name: "Idioma do dashboard" })).toHaveClass("h-[34px]");
    expect(screen.getByRole("button", { name: /tema/i })).toHaveClass("size-[34px]");
  });

  it("switches the whole dashboard to the chosen language and remembers it here", async () => {
    renderLayout();
    await waitFor(() => expect(api.getDashboard).toHaveBeenCalled());
    await chooseOption("Idioma do dashboard", "English");
    expect(screen.getByRole("link", { name: "Preferences" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Dashboard language" })).toHaveTextContent("EN");
    expect(localStorage.getItem("summyz:language")).toBe("en");
    expect(document.documentElement.lang).toBe("en");
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

describe("Navigation drawer", () => {
  it("opens the navigation from the menu button in the top bar", async () => {
    renderWithTopBar();
    const menu = screen.getByRole("button", { name: "Abrir menu de navegação" });
    expect(menu).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(menu);
    const drawer = screen.getByRole("dialog", { name: "Navegação" });
    expect(within(drawer).getByRole("link", { name: "Preferências" })).toBeInTheDocument();
    expect(menu).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(api.getDashboard).toHaveBeenCalled());
  });

  it("closes with its close button", async () => {
    renderWithTopBar();
    await userEvent.click(screen.getByRole("button", { name: "Abrir menu de navegação" }));
    await userEvent.click(screen.getByRole("button", { name: "Fechar menu" }));
    expect(screen.queryByRole("dialog", { name: "Navegação" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abrir menu de navegação" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("closes when the backdrop around the panel is pressed", async () => {
    renderWithTopBar();
    await userEvent.click(screen.getByRole("button", { name: "Abrir menu de navegação" }));
    await userEvent.click(screen.getByRole("dialog", { name: "Navegação" }));
    expect(screen.queryByRole("dialog", { name: "Navegação" })).not.toBeInTheDocument();
  });

  it("stays open when the panel itself is pressed", async () => {
    renderWithTopBar();
    await userEvent.click(screen.getByRole("button", { name: "Abrir menu de navegação" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByText("Reuniões"));
    expect(screen.getByRole("dialog", { name: "Navegação" })).toBeInTheDocument();
  });

  it("closes after a destination is chosen", async () => {
    renderWithTopBar();
    await userEvent.click(screen.getByRole("button", { name: "Abrir menu de navegação" }));
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Navegação" })).getByRole("link", {
        name: /Tarefas/,
      }),
    );
    expect(await screen.findByRole("heading", { name: "Tarefas abertas" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Navegação" })).not.toBeInTheDocument();
  });

  it("locks the page scroll behind the open drawer and releases it on close", async () => {
    renderWithTopBar();
    expect(document.documentElement.style.overflow).toBe("");
    await userEvent.click(screen.getByRole("button", { name: "Abrir menu de navegação" }));
    expect(document.documentElement.style.overflow).toBe("hidden");
    await userEvent.click(screen.getByRole("button", { name: "Fechar menu" }));
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("releases the page scroll when the layout unmounts with the drawer open", async () => {
    const { unmount } = renderWithTopBar();
    await userEvent.click(screen.getByRole("button", { name: "Abrir menu de navegação" }));
    unmount();
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("follows the browser when it closes the dialog, as on Escape", async () => {
    renderWithTopBar();
    await userEvent.click(screen.getByRole("button", { name: "Abrir menu de navegação" }));
    const drawer = screen.getByRole("dialog", { name: "Navegação" });
    act(() => {
      if (drawer instanceof HTMLDialogElement) drawer.close();
    });
    expect(screen.queryByRole("dialog", { name: "Navegação" })).not.toBeInTheDocument();
  });
});

describe("TopBar outside the dashboard layout", () => {
  it("has no menu button when there is no navigation to open", () => {
    render(<TopBar title="Configuração inicial" />);
    expect(screen.queryByRole("button", { name: "Abrir menu de navegação" })).toBeNull();
  });

  it("pushes wrapped actions to the end by default", () => {
    render(<TopBar actions={<button type="button">Ação</button>} title="Tela" />);
    expect(screen.getByRole("button", { name: "Ação" }).parentElement).toHaveClass(
      "ml-auto",
      "justify-end",
    );
  });

  it("can keep wrapped actions at the start", () => {
    render(
      <TopBar
        actions={<button type="button">Ação</button>}
        title="Tela"
        wrappedActionsAlign="start"
      />,
    );
    const actions = screen.getByRole("button", { name: "Ação" }).parentElement;
    expect(actions).toHaveClass("justify-start");
    expect(actions).not.toHaveClass("ml-auto");
  });
});
