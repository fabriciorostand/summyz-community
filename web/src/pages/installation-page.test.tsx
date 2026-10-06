import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storedSecretMask } from "../components/secret-field";
import { setLanguage } from "../i18n/store";
import { ApiError, api, type DashboardSettings, type InstallationHealth } from "../lib/api";
import {
  aSettings,
  dashboardContext,
  renderScreen,
  renderWithLiveSettings,
} from "../tests/test-utils";
import { InstallationPage } from "./installation-page";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ApiError: actual.ApiError,
    api: {
      changePassword: vi.fn(),
      getInstallationHealth: vi.fn(),
      removeSecret: vi.fn(),
      updateSecret: vi.fn(),
    },
  };
});

function aHealth(overrides: Partial<InstallationHealth> = {}): InstallationHealth {
  return {
    checkedAt: "2026-09-08T17:00:00.000Z",
    components: [
      {
        componentId: "bot-1",
        componentType: "bot",
        details: {},
        heartbeatAt: "2026-09-08T16:59:00.000Z",
        stale: false,
        status: "ready",
      },
      {
        componentId: "ffmpeg-1",
        componentType: "ffmpeg",
        details: {},
        heartbeatAt: null,
        stale: true,
        status: "degraded",
      },
    ],
    database: { status: "ready" },
    externalConfiguration: { openRouterConfigured: true },
    localAiRequired: false,
    queue: { active: 0, failed: 0, oldestPendingAt: null, scheduled: 0 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(api.getInstallationHealth).mockResolvedValue(aHealth());
  vi.mocked(api.updateSecret).mockResolvedValue(undefined);
  vi.mocked(api.removeSecret).mockResolvedValue(undefined);
  vi.mocked(api.changePassword).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("InstallationPage", () => {
  it("reads in English, component health included", async () => {
    setLanguage("en");
    renderScreen(<InstallationPage />, {
      context: dashboardContext({ settings: aSettings({ accessMode: "public" }) }),
    });
    expect(screen.getByRole("heading", { level: 1, name: "Installation" })).toBeInTheDocument();
    expect(screen.getByLabelText("OpenRouter key")).toHaveValue(storedSecretMask);
    expect(screen.getByRole("button", { name: "Edit OpenRouter key" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Dashboard access" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change password" })).toBeInTheDocument();
    expect(await screen.findByText("Bot authenticated on Discord")).toBeInTheDocument();
    expect(screen.getByText("FFmpeg with libopus")).toBeInTheDocument();
    expect(screen.getByText("no recent heartbeat")).toBeInTheDocument();
    expect(screen.getByText("0 queued · 0 failed")).toBeInTheDocument();
  });

  it("omits the requested installation guidance", () => {
    renderScreen(<InstallationPage />);
    expect(screen.getByRole("banner")).not.toHaveTextContent("Cada bloco salva separadamente");
    expect(screen.queryByText(/Não existe client secret/)).not.toBeInTheDocument();
    const access = screen.getByRole("region", { name: "Acesso ao dashboard" });
    expect(within(access).queryByText(/Definido pelo script usado/)).not.toBeInTheDocument();
    expect(within(access).queryByText(/Para publicar: defina o domínio/)).not.toBeInTheDocument();
    expect(screen.queryByText(/O backend descobre o ID/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Sobre o campo/ })).toBeNull();
  });

  it("leaves the Discord application and owner account to their own screen", () => {
    renderScreen(<InstallationPage />);
    expect(screen.queryByRole("region", { name: "Aplicação Discord" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Conta do dono no Discord" })).toBeNull();
    expect(screen.queryByLabelText("Token do bot")).toBeNull();
    expect(screen.queryByLabelText("Client Secret")).toBeNull();
  });

  it("updates and removes the OpenRouter key", async () => {
    // A stand-in server whose answer follows the writes, the way the real one does.
    let stored = false;
    vi.mocked(api.updateSecret).mockImplementation(async () => {
      stored = true;
    });
    vi.mocked(api.removeSecret).mockImplementation(async () => {
      stored = false;
    });
    const serverSettings = vi.fn<() => Promise<DashboardSettings>>().mockImplementation(async () =>
      aSettings({
        secrets: { discordBotToken: true, discordClientSecret: true, openRouterApiKey: stored },
      }),
    );
    renderWithLiveSettings(<InstallationPage />, {
      initialSettings: aSettings({
        secrets: { discordBotToken: true, discordClientSecret: true, openRouterApiKey: false },
      }),
      serverSettings,
    });
    const providers = screen.getByRole("region", { name: "Provedores" });
    const field = within(providers).getByLabelText("Chave OpenRouter");
    await userEvent.type(field, "sk-or-1");
    await userEvent.click(within(providers).getByRole("button", { name: "Atualizar" }));
    await waitFor(() =>
      expect(api.updateSecret).toHaveBeenCalledWith("openrouter_api_key", "sk-or-1"),
    );
    await waitFor(() => expect(field).toHaveValue(storedSecretMask));
    expect(field).toHaveAttribute("readonly");
    await userEvent.click(screen.getByRole("button", { name: "Remover chave OpenRouter" }));
    await waitFor(() => expect(api.removeSecret).toHaveBeenCalledWith("openrouter_api_key"));
    await waitFor(() => expect(field).toHaveAttribute("placeholder", "Ainda não configurado"));
    expect(screen.queryByText(/criptografados/)).toBeNull();
  });

  it("reloads the settings from the server when the page opens", async () => {
    const reloadSettings = vi.fn().mockResolvedValue(undefined);
    renderScreen(<InstallationPage />, { context: dashboardContext({ reloadSettings }) });
    await waitFor(() => expect(reloadSettings).toHaveBeenCalledTimes(1));
  });

  it("shows the OpenRouter key as configured once the server confirms it", async () => {
    const serverSettings = vi.fn<() => Promise<DashboardSettings>>().mockResolvedValue(
      aSettings({
        secrets: { discordBotToken: true, discordClientSecret: true, openRouterApiKey: true },
      }),
    );
    renderWithLiveSettings(<InstallationPage />, {
      initialSettings: aSettings({
        secrets: { discordBotToken: true, discordClientSecret: true, openRouterApiKey: false },
      }),
      serverSettings,
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Chave OpenRouter")).toHaveValue(storedSecretMask),
    );
    expect(serverSettings).toHaveBeenCalledTimes(1);
  });

  it("keeps the key as configured after saving even when the reload fails", async () => {
    const serverSettings = vi
      .fn<() => Promise<DashboardSettings>>()
      .mockRejectedValue(new Error("offline"));
    renderWithLiveSettings(<InstallationPage />, {
      initialSettings: aSettings({
        secrets: { discordBotToken: true, discordClientSecret: true, openRouterApiKey: false },
      }),
      serverSettings,
    });
    const providers = screen.getByRole("region", { name: "Provedores" });
    const field = within(providers).getByLabelText("Chave OpenRouter");
    expect(field).toHaveAttribute("placeholder", "Ainda não configurado");
    await userEvent.type(field, "sk-or-1");
    await userEvent.click(within(providers).getByRole("button", { name: "Atualizar" }));
    await waitFor(() => expect(field).toHaveValue(storedSecretMask));
    await waitFor(() => expect(serverSettings).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Remover chave OpenRouter" })).toBeEnabled();
  });

  it("hides the password block entirely in local mode", () => {
    renderScreen(<InstallationPage />);
    expect(screen.getByRole("banner")).not.toHaveTextContent("Modo local");
    const access = screen.getByRole("region", { name: "Acesso ao dashboard" });
    const local = within(access).getByRole("listitem", { name: "Modo local" });
    expect(local).toHaveTextContent("Ativo");
    expect(local).toHaveTextContent("127.0.0.1:8787");
    expect(local).not.toHaveTextContent("sem TLS");
    expect(within(access).getByRole("listitem", { name: "Modo público" })).not.toHaveTextContent(
      "Ativo",
    );
    expect(screen.queryByRole("heading", { name: "Senha da instalação" })).toBeNull();
    expect(screen.queryByLabelText("Senha atual")).toBeNull();
    expect(screen.queryByText(/recover-access/)).toBeNull();
  });

  it("shows the password block in public mode", () => {
    renderScreen(<InstallationPage />, {
      context: dashboardContext({ settings: aSettings({ accessMode: "public" }) }),
    });
    expect(screen.getByRole("heading", { name: "Senha da instalação" })).toBeInTheDocument();
    expect(screen.getByLabelText("Senha atual")).toBeEnabled();
    expect(screen.getByText(/recover-access/)).toBeInTheDocument();
  });

  it("changes the installation password in public mode", async () => {
    renderScreen(<InstallationPage />, {
      context: dashboardContext({ settings: aSettings({ accessMode: "public" }) }),
    });
    expect(screen.getByRole("banner")).not.toHaveTextContent("Modo público");
    await userEvent.type(screen.getByLabelText("Senha atual"), "senha antiga bem longa");
    await userEvent.type(screen.getByLabelText("Nova senha"), "senha nova ainda mais longa");
    await userEvent.click(screen.getByRole("button", { name: "Trocar senha" }));
    await waitFor(() =>
      expect(api.changePassword).toHaveBeenCalledWith(
        "senha antiga bem longa",
        "senha nova ainda mais longa",
      ),
    );
    expect(await screen.findByText(/Senha trocada/)).toBeInTheDocument();
  });

  it("refuses a short new password before calling the API", async () => {
    renderScreen(<InstallationPage />, {
      context: dashboardContext({ settings: aSettings({ accessMode: "public" }) }),
    });
    await userEvent.type(screen.getByLabelText("Senha atual"), "senha antiga bem longa");
    await userEvent.type(screen.getByLabelText("Nova senha"), "curta");
    await userEvent.click(screen.getByRole("button", { name: "Trocar senha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/15 a 128/);
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it("tells when the current password does not match", async () => {
    vi.mocked(api.changePassword).mockRejectedValue(new ApiError(401, "invalid_password"));
    renderScreen(<InstallationPage />, {
      context: dashboardContext({ settings: aSettings({ accessMode: "public" }) }),
    });
    await userEvent.type(screen.getByLabelText("Senha atual"), "senha antiga bem longa");
    await userEvent.type(screen.getByLabelText("Nova senha"), "senha nova ainda mais longa");
    await userEvent.click(screen.getByRole("button", { name: "Trocar senha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A senha atual não confere");
  });

  it("lists the component health", async () => {
    renderScreen(<InstallationPage />);
    const health = await screen.findByRole("region", { name: "Estado da instalação" });
    await waitFor(() =>
      expect(within(health).getByText("Bot autenticado no Discord")).toBeInTheDocument(),
    );
    expect(within(health).getByText("FFmpeg com libopus")).toBeInTheDocument();
    expect(within(health).queryByText(/migração/)).toBeNull();
    expect(within(health).getByText(/0 na fila/)).toBeInTheDocument();
  });

  it("degrades gracefully when the health check fails", async () => {
    vi.mocked(api.getInstallationHealth).mockRejectedValue(new Error("offline"));
    renderScreen(<InstallationPage />);
    expect(
      await screen.findByText("Não foi possível consultar o estado dos componentes."),
    ).toBeInTheDocument();
  });
});
