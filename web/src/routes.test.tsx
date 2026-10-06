import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLanguage } from "./i18n/store";
import { api } from "./lib/api";
import { routes } from "./routes";
import { aDashboard, aGuild, aSettings } from "./tests/test-utils";

vi.mock("./lib/api", async () => {
  const actual = await vi.importActual<typeof import("./lib/api")>("./lib/api");
  return {
    ApiError: actual.ApiError,
    api: {
      getAccessStatus: vi.fn(),
      getCostDetail: vi.fn(),
      getDashboard: vi.fn(),
      getDiscordConnection: vi.fn(),
      getSettings: vi.fn(),
      listGuilds: vi.fn(),
    },
    subscribeToSessionExpiry: vi.fn(() => () => undefined),
  };
});

// A deploy removed the old chunks while the dashboard was open.
vi.mock("./pages/commands-page", () => {
  throw new Error("Failed to fetch dynamically imported module");
});
vi.mock("./pages/setup-page", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

const reload = vi.fn();

function renderApp(route: string) {
  return render(
    <RouterProvider router={createMemoryRouter(routes, { initialEntries: [route] })} />,
  );
}

beforeEach(() => {
  vi.mocked(api.getAccessStatus).mockResolvedValue({
    accessMode: "local",
    authenticated: true,
    passwordConfigured: false,
    setupCompleted: true,
  });
  vi.mocked(api.getSettings).mockResolvedValue(aSettings());
  vi.mocked(api.listGuilds).mockResolvedValue([aGuild()]);
  vi.mocked(api.getDashboard).mockResolvedValue(aDashboard());
  vi.mocked(api.getDiscordConnection).mockResolvedValue({ connected: false });
  vi.stubGlobal("location", { ...window.location, reload });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("a screen that fails to load", () => {
  it("keeps the sidebar and offers to reload inside the content area", async () => {
    renderApp("/commands");

    expect(
      await screen.findByRole("heading", { name: "Não foi possível abrir esta tela" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Tela indisponível" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Preferências" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Recarregar/ }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith("dashboard_route_failed", expect.any(Error));
  });

  it("speaks the dashboard language", async () => {
    setLanguage("en");
    renderApp("/commands");

    expect(
      await screen.findByRole("heading", { name: "Unable to open this screen" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reload/ })).toBeInTheDocument();
  });

  it("fills the page when the screen has no sidebar, like the first-run setup", async () => {
    vi.mocked(api.getAccessStatus).mockResolvedValue({
      accessMode: "local",
      authenticated: true,
      passwordConfigured: false,
      setupCompleted: false,
    });
    renderApp("/setup");

    expect(
      await screen.findByRole("heading", { name: "Não foi possível abrir esta tela" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Preferências" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Recarregar/ }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("still opens the other screens", async () => {
    renderApp("/settings");
    expect(await screen.findByRole("heading", { name: "Preferências" })).toBeInTheDocument();
  });

  it("opens the cost detail at its own path, outside the sidebar", async () => {
    vi.mocked(api.getCostDetail).mockReturnValue(new Promise(() => undefined));
    renderApp("/costs");
    expect(await screen.findByRole("heading", { level: 1, name: "Custos" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Custos" })).toBeNull();
  });

  it("opens the Bot tab at its own path", async () => {
    renderApp("/bot");
    expect(await screen.findByRole("heading", { level: 1, name: "Bot" })).toBeInTheDocument();
  });
});
