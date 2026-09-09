import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "../lib/api";
import { aUser, dashboardContext, renderScreen } from "../tests/test-utils";
import { AccountPage } from "./account-page";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ApiError: actual.ApiError,
    api: {
      changePassword: vi.fn(),
      connectDiscord: vi.fn(),
      disconnectDiscord: vi.fn(),
      getDiscordConnection: vi.fn(),
    },
  };
});

const getDiscordConnection = vi.mocked(api.getDiscordConnection);

beforeEach(() => {
  getDiscordConnection.mockResolvedValue({ connected: true, discordUsername: "pixelpaladin" });
  vi.mocked(api.changePassword).mockResolvedValue(undefined);
  vi.mocked(api.disconnectDiscord).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AccountPage", () => {
  it("shows the identity and role", async () => {
    renderScreen(<AccountPage />);
    expect(screen.getByRole("heading", { name: "ana@pixelforge.gg" })).toBeInTheDocument();
    expect(screen.getByText("E-mail verificado")).toBeInTheDocument();
    expect(screen.getByText("Administrador da instalação")).toBeInTheDocument();
    await waitFor(() => expect(getDiscordConnection).toHaveBeenCalled());
  });

  it("labels a plain member", async () => {
    renderScreen(<AccountPage />, {
      context: dashboardContext({ user: aUser({ installationRole: "member" }) }),
    });
    expect(screen.getByText("Membro")).toBeInTheDocument();
    await waitFor(() => expect(getDiscordConnection).toHaveBeenCalled());
  });

  it("shows the connected Discord identity", async () => {
    renderScreen(<AccountPage />);
    expect(await screen.findByText(/Conectado como pixelpaladin/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desconectar" })).toBeInTheDocument();
  });

  it("disconnects Discord", async () => {
    renderScreen(<AccountPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Desconectar" }));
    await waitFor(() => expect(api.disconnectDiscord).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: "Conectar ao Discord" })).toBeInTheDocument();
  });

  it("starts the Discord authorization", async () => {
    getDiscordConnection.mockResolvedValue({ connected: false });
    vi.mocked(api.connectDiscord).mockResolvedValue({ authorizationUrl: "https://discord/oauth" });
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    renderScreen(<AccountPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Conectar ao Discord" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://discord/oauth"));
    vi.unstubAllGlobals();
  });

  it("reports a Discord failure", async () => {
    getDiscordConnection.mockRejectedValue(new Error("offline"));
    renderScreen(<AccountPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Não foi possível consultar ou alterar a conexão Discord/,
    );
  });

  it("saves the dashboard language", async () => {
    const setPreferences = vi.fn();
    renderScreen(<AccountPage />, { context: dashboardContext({ setPreferences }) });
    await userEvent.selectOptions(screen.getByLabelText("Idioma do dashboard"), "en");
    expect(setPreferences).toHaveBeenCalledWith({
      dashboardLanguage: "en",
      dashboardTheme: "dark",
    });
  });

  it("saves the theme", async () => {
    const setPreferences = vi.fn();
    renderScreen(<AccountPage />, { context: dashboardContext({ setPreferences }) });
    await userEvent.selectOptions(screen.getByLabelText("Tema"), "system");
    expect(setPreferences).toHaveBeenCalledWith({
      dashboardLanguage: "pt-BR",
      dashboardTheme: "system",
    });
  });

  it("changes the password and warns that the session ends", async () => {
    renderScreen(<AccountPage />);
    await userEvent.type(screen.getByLabelText("Senha atual"), "senha-atual-1");
    await userEvent.type(screen.getByLabelText("Nova senha"), "senha-nova-longa");
    await userEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    await waitFor(() =>
      expect(api.changePassword).toHaveBeenCalledWith("senha-atual-1", "senha-nova-longa"),
    );
    expect(await screen.findByText(/Sua sessão foi encerrada/)).toBeInTheDocument();
  });

  it("reports a wrong current password", async () => {
    vi.mocked(api.changePassword).mockRejectedValue(new ApiError(401, "invalid_credentials"));
    renderScreen(<AccountPage />);
    await userEvent.type(screen.getByLabelText("Senha atual"), "errada-errada");
    await userEvent.type(screen.getByLabelText("Nova senha"), "senha-nova-longa");
    await userEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    expect(await screen.findByText("A senha atual não confere.")).toBeInTheDocument();
  });

  it("reports an unexpected password failure", async () => {
    vi.mocked(api.changePassword).mockRejectedValue(new Error("offline"));
    renderScreen(<AccountPage />);
    await userEvent.type(screen.getByLabelText("Senha atual"), "senha-atual-1");
    await userEvent.type(screen.getByLabelText("Nova senha"), "senha-nova-longa");
    await userEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    expect(await screen.findByText("Não foi possível trocar a senha.")).toBeInTheDocument();
  });
});
