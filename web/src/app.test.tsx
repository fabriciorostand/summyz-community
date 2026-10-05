import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, subscribeToSessionExpiry } from "./lib/api";
import { routes } from "./routes";
import { aConnectedAccount, aDashboard, aGuild, aSettings } from "./tests/test-utils";

vi.mock("./lib/api", async () => {
  const actual = await vi.importActual<typeof import("./lib/api")>("./lib/api");
  return {
    ApiError: actual.ApiError,
    api: {
      getAccessStatus: vi.fn(),
      getBotInstallation: vi.fn(),
      getDashboard: vi.fn(),
      getDiscordConnection: vi.fn(),
      getSettings: vi.fn(),
      getSetupStatus: vi.fn(),
      listCommands: vi.fn(),
      listGuilds: vi.fn(),
      listMeetings: vi.fn(),
      listTasks: vi.fn(),
      login: vi.fn(),
    },
    subscribeToSessionExpiry: vi.fn(),
  };
});

function renderApp(route: string | { pathname: string; state: unknown }) {
  return render(
    <RouterProvider router={createMemoryRouter(routes, { initialEntries: [route] })} />,
  );
}

beforeEach(() => {
  vi.mocked(subscribeToSessionExpiry).mockReturnValue(() => undefined);
  vi.mocked(api.getAccessStatus).mockResolvedValue({
    accessMode: "local",
    authenticated: true,
    passwordConfigured: false,
    setupCompleted: true,
  });
  vi.mocked(api.getSetupStatus).mockResolvedValue({
    accessMode: "local",
    discordRedirectUri: "http://127.0.0.1:8787/api/discord/callback",
    passwordConfigured: false,
    setupCompleted: false,
    technicalSetupCompleted: false,
  });
  vi.mocked(api.getSettings).mockResolvedValue(aSettings());
  vi.mocked(api.getBotInstallation).mockResolvedValue({ configured: false });
  vi.mocked(api.listGuilds).mockResolvedValue([aGuild()]);
  vi.mocked(api.getDashboard).mockResolvedValue(aDashboard());
  vi.mocked(api.getDiscordConnection).mockResolvedValue(aConnectedAccount());
  vi.mocked(api.listMeetings).mockResolvedValue({
    items: [],
    page: 1,
    pageSize: 20,
    timeZone: "America/Sao_Paulo",
    total: 0,
  });
  vi.mocked(api.listTasks).mockResolvedValue([]);
  vi.mocked(api.listCommands).mockResolvedValue([
    {
      commands: [{ description: "Starts recording the voice channel you are in", name: "/record" }],
      id: "recording",
      label: "Recording",
    },
  ]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("App", () => {
  it("waits for the access status before routing", () => {
    renderApp("/");
    expect(screen.getByRole("status")).toHaveTextContent("Preparando o Summyz Community…");
  });

  it("offers a retry when the API cannot be reached", async () => {
    vi.mocked(api.getAccessStatus).mockRejectedValueOnce(new Error("offline"));
    renderApp("/");
    expect(
      await screen.findByRole("heading", { name: "Não foi possível falar com o servidor" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Tentar novamente/ }));
    expect(await screen.findByRole("heading", { name: "Visão geral" })).toBeInTheDocument();
  });

  it("forces the first-run setup until it is complete", async () => {
    vi.mocked(api.getAccessStatus).mockResolvedValue({
      accessMode: "local",
      authenticated: true,
      passwordConfigured: false,
      setupCompleted: false,
    });
    renderApp("/history");
    expect(await screen.findByRole("heading", { name: "Cole o token do bot" })).toBeInTheDocument();
  });

  it("renders the overview straight away in local mode", async () => {
    renderApp("/");
    expect(await screen.findByRole("heading", { name: "Visão geral" })).toBeInTheDocument();
    expect(api.getSettings).toHaveBeenCalled();
  });

  it("asks for the installation password in public mode until unlocked", async () => {
    vi.mocked(api.getAccessStatus).mockResolvedValue({
      accessMode: "public",
      authenticated: false,
      passwordConfigured: true,
      setupCompleted: true,
    });
    renderApp("/tasks");
    expect(await screen.findByRole("heading", { name: "Desbloquear" })).toBeInTheDocument();
    expect(api.getSettings).not.toHaveBeenCalled();
  });

  it("sends an unlocked public visitor away from the login screen", async () => {
    vi.mocked(api.getAccessStatus).mockResolvedValue({
      accessMode: "public",
      authenticated: true,
      passwordConfigured: true,
      setupCompleted: true,
    });
    renderApp("/login");
    expect(await screen.findByRole("heading", { name: "Visão geral" })).toBeInTheDocument();
  });

  it("returns to the Discord authorization outcome after signing in again", async () => {
    // Connecting the owner ends the public session, so the callback lands on the lock screen.
    vi.mocked(api.getAccessStatus)
      .mockResolvedValueOnce({
        accessMode: "public",
        authenticated: false,
        passwordConfigured: true,
        setupCompleted: true,
      })
      .mockResolvedValue({
        accessMode: "public",
        authenticated: true,
        passwordConfigured: true,
        setupCompleted: true,
      });
    vi.mocked(api.login).mockResolvedValue(undefined);
    renderApp("/servers?discord=connected");
    await userEvent.type(
      await screen.findByLabelText("Senha da instalação"),
      "uma frase bem longa mesmo",
    );
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await userEvent.click(await screen.findByRole("button", { name: "Ir para o dashboard" }));
    expect(await screen.findByRole("heading", { name: "Servidores" })).toBeInTheDocument();
    expect(screen.getByText(/Conta Discord conectada/)).toBeInTheDocument();
  });

  it("never follows a return path that leaves the dashboard", async () => {
    vi.mocked(api.getAccessStatus).mockResolvedValue({
      accessMode: "public",
      authenticated: true,
      passwordConfigured: true,
      setupCompleted: true,
    });
    renderApp({ pathname: "/login", state: { from: "//evil.example/servers" } });
    expect(await screen.findByRole("heading", { name: "Visão geral" })).toBeInTheDocument();
  });

  it("shows the expired-session state when a request loses the session", async () => {
    vi.mocked(api.getAccessStatus).mockResolvedValue({
      accessMode: "public",
      authenticated: true,
      passwordConfigured: true,
      setupCompleted: true,
    });
    renderApp("/");
    expect(await screen.findByRole("heading", { name: "Visão geral" })).toBeInTheDocument();
    const [listener] = vi.mocked(subscribeToSessionExpiry).mock.calls.at(-1) ?? [];
    if (listener === undefined) throw new Error("expected a session expiry listener");
    act(() => listener());
    expect(await screen.findByRole("heading", { name: "Sua sessão expirou" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: /Desbloquear/ }));
    expect(await screen.findByRole("heading", { name: "Desbloquear" })).toBeInTheDocument();
  });

  it("keeps waiting when the settings request fails for another reason", async () => {
    vi.mocked(api.getSettings).mockRejectedValue(new Error("offline"));
    renderApp("/");
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled());
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("treats a 401 from the settings request as an expired session", async () => {
    vi.mocked(api.getAccessStatus).mockResolvedValue({
      accessMode: "public",
      authenticated: true,
      passwordConfigured: true,
      setupCompleted: true,
    });
    vi.mocked(api.getSettings).mockRejectedValue(new ApiError(401, "session_expired"));
    renderApp("/");
    expect(await screen.findByRole("heading", { name: "Sua sessão expirou" })).toBeInTheDocument();
  });

  it("redirects an unknown route back to the overview", async () => {
    renderApp("/nao-existe");
    expect(await screen.findByRole("heading", { name: "Visão geral" })).toBeInTheDocument();
  });

  it("routes to the tasks screen", async () => {
    renderApp("/tasks");
    expect(await screen.findByRole("heading", { name: "Tarefas" })).toBeInTheDocument();
  });

  it("routes to the commands reference", async () => {
    renderApp("/commands");
    expect(await screen.findByRole("heading", { name: "Comandos" })).toBeInTheDocument();
  });

  it("routes to the preferences screen", async () => {
    renderApp("/settings");
    expect(await screen.findByRole("heading", { name: "Preferências" })).toBeInTheDocument();
  });

  it("no longer exposes the account route", async () => {
    renderApp("/account");
    expect(await screen.findByRole("heading", { name: "Visão geral" })).toBeInTheDocument();
  });

  it("sends a finished installation away from the setup screen", async () => {
    renderApp("/setup");
    expect(await screen.findByRole("heading", { name: "Visão geral" })).toBeInTheDocument();
  });

  it("loads the next screen when the sidebar navigates", async () => {
    renderApp("/settings");
    expect(await screen.findByRole("heading", { name: "Preferências" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: "Comandos" }));

    expect(await screen.findByRole("heading", { name: "Comandos" })).toBeInTheDocument();
  });
});
