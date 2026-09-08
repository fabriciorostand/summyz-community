import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./app";
import { ApiError, api } from "./lib/api";
import { aDashboard, aGuild, aUser } from "./tests/test-utils";

vi.mock("./lib/api", async () => {
  const actual = await vi.importActual<typeof import("./lib/api")>("./lib/api");
  return {
    ApiError: actual.ApiError,
    api: {
      getDashboard: vi.fn(),
      getSetupStatus: vi.fn(),
      listGuilds: vi.fn(),
      listMeetings: vi.fn(),
      listTasks: vi.fn(),
      me: vi.fn(),
    },
  };
});

function renderApp(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(api.getSetupStatus).mockResolvedValue({
    registrationEnabled: true,
    setupCompleted: true,
  });
  vi.mocked(api.me).mockResolvedValue(aUser());
  vi.mocked(api.listGuilds).mockResolvedValue([aGuild()]);
  vi.mocked(api.getDashboard).mockResolvedValue(aDashboard());
  vi.mocked(api.listMeetings).mockResolvedValue({
    items: [],
    page: 1,
    pageSize: 20,
    timeZone: "America/Sao_Paulo",
    total: 0,
  });
  vi.mocked(api.listTasks).mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("App", () => {
  it("waits for the setup status before routing", () => {
    renderApp("/");
    expect(screen.getByRole("status")).toHaveTextContent("Preparando o Summyz Community…");
  });

  it("offers a retry when the API cannot be reached", async () => {
    vi.mocked(api.getSetupStatus).mockRejectedValueOnce(new Error("offline"));
    renderApp("/");
    expect(
      await screen.findByRole("heading", { name: "Não foi possível falar com o servidor" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Tentar novamente/ }));
    expect(await screen.findByRole("heading", { name: "Visão geral" })).toBeInTheDocument();
  });

  it("forces the setup wizard until the first run is complete", async () => {
    vi.mocked(api.getSetupStatus).mockResolvedValue({
      registrationEnabled: false,
      setupCompleted: false,
    });
    renderApp("/history");
    expect(await screen.findByText("Passo 1 de 3 · Conta administradora")).toBeInTheDocument();
  });

  it("renders the overview once authenticated", async () => {
    renderApp("/");
    expect(await screen.findByRole("heading", { name: "Visão geral" })).toBeInTheDocument();
  });

  it("sends an unauthenticated visitor to the login screen", async () => {
    vi.mocked(api.me).mockRejectedValue(new ApiError(401, "session_expired"));
    renderApp("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Entrar" })).toBeInTheDocument();
  });

  it("keeps waiting when the identity request fails for another reason", async () => {
    vi.mocked(api.me).mockRejectedValue(new Error("offline"));
    renderApp("/");
    await waitFor(() => expect(api.me).toHaveBeenCalled());
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("serves the login screen directly", async () => {
    renderApp("/login");
    expect(await screen.findByRole("heading", { level: 1, name: "Entrar" })).toBeInTheDocument();
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

  it("no longer exposes the registration route", async () => {
    renderApp("/register");
    expect(await screen.findByRole("heading", { name: "Visão geral" })).toBeInTheDocument();
  });

  it("no longer exposes the password recovery route", async () => {
    renderApp("/forgot-password");
    expect(await screen.findByRole("heading", { name: "Visão geral" })).toBeInTheDocument();
  });
});
