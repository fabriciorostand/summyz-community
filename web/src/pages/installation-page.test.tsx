import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCallback, useState } from "react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLanguage } from "../i18n/store";
import { ApiError, api, type DashboardSettings, type InstallationHealth } from "../lib/api";
import { leaveDashboardFor } from "../lib/browser-navigation";
import { aSettings, dashboardContext, renderScreen } from "../tests/test-utils";
import { InstallationPage } from "./installation-page";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ApiError: actual.ApiError,
    api: {
      changePassword: vi.fn(),
      getDiscordConnection: vi.fn(),
      getInstallationHealth: vi.fn(),
      removeSecret: vi.fn(),
      replaceBotToken: vi.fn(),
      startDiscordConnection: vi.fn(),
      updateSecret: vi.fn(),
    },
  };
});
vi.mock("../lib/browser-navigation", () => ({ leaveDashboardFor: vi.fn() }));

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

/**
 * The real layout owns the settings; this stand-in keeps them in state so the page can be
 * observed reacting to its own patches and to what the server answers on reload.
 */
function SettingsHarness({
  initialSettings,
  serverSettings,
}: {
  initialSettings: DashboardSettings;
  serverSettings: () => Promise<DashboardSettings>;
}) {
  const [settings, setSettings] = useState(initialSettings);
  // Stable like the real layout callbacks, otherwise the page would refresh on every render.
  const patchSettings = useCallback(
    (patch: Partial<DashboardSettings>) => setSettings((current) => ({ ...current, ...patch })),
    [],
  );
  const reloadSettings = useCallback(
    () =>
      serverSettings().then(
        (next) => {
          setSettings(next);
          return next;
        },
        () => undefined,
      ),
    [serverSettings],
  );
  const context = dashboardContext({ patchSettings, reloadSettings, settings });
  return (
    <MemoryRouter initialEntries={["/installation"]}>
      <Routes>
        <Route element={<Outlet context={context} />}>
          <Route element={<InstallationPage />} path="/installation" />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.mocked(api.getInstallationHealth).mockResolvedValue(aHealth());
  vi.mocked(api.replaceBotToken).mockResolvedValue(undefined);
  vi.mocked(api.updateSecret).mockResolvedValue(undefined);
  vi.mocked(api.removeSecret).mockResolvedValue(undefined);
  vi.mocked(api.changePassword).mockResolvedValue(undefined);
  vi.mocked(api.getDiscordConnection).mockResolvedValue({
    connected: true,
    discordUserId: "owner-1",
    discordUsername: "pixel.owner",
  });
  vi.mocked(api.startDiscordConnection).mockResolvedValue("https://discord.com/oauth2/authorize");
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
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
    expect(screen.getByLabelText("Bot token")).toHaveAttribute(
      "placeholder",
      "Configured — type to replace",
    );
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
  });

  it("shows the read-only Application ID with a copy action", async () => {
    renderScreen(<InstallationPage />);
    expect(screen.getByText("123456789012345678")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Copiar Application ID" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("123456789012345678");
    expect(screen.queryByText(/SMTP/)).toBeNull();
  });

  it("replaces the bot token through the dedicated route after confirmation", async () => {
    renderScreen(<InstallationPage />, {
      context: dashboardContext({ reloadSettings: () => Promise.resolve(aSettings()) }),
    });
    const field = screen.getByLabelText("Token do bot");
    expect(field).toHaveAttribute("placeholder", "Configurado — digite para substituir");
    expect(screen.queryByText(/Reinicie o processo/)).toBeNull();
    await userEvent.type(field, "new-token");
    await userEvent.click(screen.getByRole("button", { name: "Substituir" }));
    const dialog = screen.getByRole("dialog", { name: "Substituir o token do bot?" });
    expect(dialog).toHaveTextContent(/Token de outra aplicação/);
    expect(api.replaceBotToken).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Substituir token" }));
    await waitFor(() => expect(api.replaceBotToken).toHaveBeenCalledWith("new-token"));
    expect(await screen.findByText(/Token salvo/)).toBeInTheDocument();
    expect(field).toHaveValue("");
  });

  it("keeps the token untouched when the replacement is cancelled", async () => {
    renderScreen(<InstallationPage />);
    await userEvent.type(screen.getByLabelText("Token do bot"), "new-token");
    await userEvent.click(screen.getByRole("button", { name: "Substituir" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.replaceBotToken).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Token do bot")).toHaveValue("new-token");
  });

  it.each([
    ["invalid_discord_bot_token", 400, "Token recusado pelo Discord"],
    ["active_recording", 409, "Há uma gravação em andamento"],
    ["pending_meetings", 409, "Ainda há reuniões em processamento"],
    ["internal_error", 500, "Não foi possível substituir o token."],
  ])("explains why the token was not replaced (%s)", async (code, status, message) => {
    vi.mocked(api.replaceBotToken).mockRejectedValue(new ApiError(status, code));
    renderScreen(<InstallationPage />);
    await userEvent.type(screen.getByLabelText("Token do bot"), "bad");
    await userEvent.click(screen.getByRole("button", { name: "Substituir" }));
    await userEvent.click(screen.getByRole("button", { name: "Substituir token" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
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
    render(
      <SettingsHarness
        initialSettings={aSettings({
          secrets: { discordBotToken: true, discordClientSecret: true, openRouterApiKey: false },
        })}
        serverSettings={serverSettings}
      />,
    );
    const providers = screen.getByRole("region", { name: "Provedores" });
    const field = within(providers).getByLabelText("Chave OpenRouter");
    await userEvent.type(field, "sk-or-1");
    await userEvent.click(within(providers).getByRole("button", { name: "Atualizar" }));
    await waitFor(() =>
      expect(api.updateSecret).toHaveBeenCalledWith("openrouter_api_key", "sk-or-1"),
    );
    await waitFor(() =>
      expect(field).toHaveAttribute("placeholder", "Configurado — digite para substituir"),
    );
    expect(field).toHaveValue("");
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
    render(
      <SettingsHarness
        initialSettings={aSettings({
          secrets: { discordBotToken: true, discordClientSecret: true, openRouterApiKey: false },
        })}
        serverSettings={serverSettings}
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Chave OpenRouter")).toHaveAttribute(
        "placeholder",
        "Configurado — digite para substituir",
      ),
    );
    expect(serverSettings).toHaveBeenCalledTimes(1);
  });

  it("keeps the key as configured after saving even when the reload fails", async () => {
    const serverSettings = vi
      .fn<() => Promise<DashboardSettings>>()
      .mockRejectedValue(new Error("offline"));
    render(
      <SettingsHarness
        initialSettings={aSettings({
          secrets: { discordBotToken: true, discordClientSecret: true, openRouterApiKey: false },
        })}
        serverSettings={serverSettings}
      />,
    );
    const providers = screen.getByRole("region", { name: "Provedores" });
    const field = within(providers).getByLabelText("Chave OpenRouter");
    expect(field).toHaveAttribute("placeholder", "Ainda não configurado");
    await userEvent.type(field, "sk-or-1");
    await userEvent.click(within(providers).getByRole("button", { name: "Atualizar" }));
    await waitFor(() =>
      expect(field).toHaveAttribute("placeholder", "Configurado — digite para substituir"),
    );
    await waitFor(() => expect(serverSettings).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Remover chave OpenRouter" })).toBeEnabled();
  });

  it("follows the server after the bot token is replaced", async () => {
    const serverSettings = vi
      .fn<() => Promise<DashboardSettings>>()
      .mockResolvedValueOnce(aSettings())
      .mockResolvedValue(aSettings({ discordApplicationId: "222" }));
    render(<SettingsHarness initialSettings={aSettings()} serverSettings={serverSettings} />);
    await waitFor(() => expect(serverSettings).toHaveBeenCalledTimes(1));
    expect(screen.getByText("123456789012345678")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Token do bot"), "new-token");
    await userEvent.click(screen.getByRole("button", { name: "Substituir" }));
    await userEvent.click(screen.getByRole("button", { name: "Substituir token" }));
    expect(await screen.findByText("222")).toBeInTheDocument();
    expect(serverSettings).toHaveBeenCalledTimes(2);
    // Another application took over: the owner connection and the Client Secret are gone.
    expect(screen.getByText(/Aplicação trocada/)).toBeInTheDocument();
  });

  it("stops showing the old owner once another application replaces the bot", async () => {
    vi.mocked(api.getDiscordConnection)
      .mockResolvedValueOnce({ connected: true, discordUserId: "u1", discordUsername: "old.owner" })
      .mockResolvedValue({ connected: false });
    const serverSettings = vi
      .fn<() => Promise<DashboardSettings>>()
      .mockResolvedValueOnce(aSettings())
      .mockResolvedValue(aSettings({ discordApplicationId: "222" }));
    render(<SettingsHarness initialSettings={aSettings()} serverSettings={serverSettings} />);
    const owner = screen.getByRole("region", { name: "Conta do dono no Discord" });
    expect(await within(owner).findByText("Conectada como old.owner")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Token do bot"), "new-token");
    await userEvent.click(screen.getByRole("button", { name: "Substituir" }));
    await userEvent.click(screen.getByRole("button", { name: "Substituir token" }));
    expect(await within(owner).findByText("Nenhuma conta conectada")).toBeInTheDocument();
    expect(within(owner).queryByText("Conectada como old.owner")).toBeNull();
  });

  it("shows the owner's connected account and the redirect URL to register", async () => {
    renderScreen(<InstallationPage />);
    const owner = screen.getByRole("region", { name: "Conta do dono no Discord" });
    expect(
      within(owner).getByText("http://127.0.0.1:8787/api/discord/callback"),
    ).toBeInTheDocument();
    await userEvent.click(
      within(owner).getByRole("button", { name: "Copiar URL de redirecionamento" }),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/discord/callback",
    );
    expect(within(owner).getByLabelText("Client Secret")).toHaveAttribute(
      "placeholder",
      "Configurado — digite para substituir",
    );
    expect(await within(owner).findByText("Conectada como pixel.owner")).toBeInTheDocument();
    await userEvent.click(within(owner).getByRole("button", { name: /Trocar conta/ }));
    expect(leaveDashboardFor).toHaveBeenCalledWith("https://discord.com/oauth2/authorize");
    expect(within(owner).queryByText(/encerra as sessões/)).toBeNull();
  });

  it("asks for the Client Secret before connecting the owner's account", async () => {
    vi.mocked(api.getDiscordConnection).mockResolvedValue({ connected: false });
    renderScreen(<InstallationPage />, {
      context: dashboardContext({
        settings: aSettings({
          accessMode: "public",
          secrets: { discordBotToken: true, discordClientSecret: false, openRouterApiKey: true },
        }),
      }),
    });
    const owner = screen.getByRole("region", { name: "Conta do dono no Discord" });
    expect(await within(owner).findByText("Nenhuma conta conectada")).toBeInTheDocument();
    expect(within(owner).getByRole("button", { name: /Conectar conta Discord/ })).toBeDisabled();
    expect(within(owner).getByText("Salve o Client Secret antes de conectar.")).toBeInTheDocument();
    expect(within(owner).getByText(/encerra as sessões do dashboard/)).toBeInTheDocument();
  });

  it("saves and removes the Discord Client Secret", async () => {
    let stored = false;
    vi.mocked(api.updateSecret).mockImplementation(async () => {
      stored = true;
    });
    vi.mocked(api.removeSecret).mockImplementation(async () => {
      stored = false;
    });
    const secrets = () => ({
      discordBotToken: true,
      discordClientSecret: stored,
      openRouterApiKey: true,
    });
    const serverSettings = vi
      .fn<() => Promise<DashboardSettings>>()
      .mockImplementation(async () => aSettings({ secrets: secrets() }));
    render(
      <SettingsHarness
        initialSettings={aSettings({ secrets: secrets() })}
        serverSettings={serverSettings}
      />,
    );
    const owner = screen.getByRole("region", { name: "Conta do dono no Discord" });
    const field = within(owner).getByLabelText("Client Secret");
    await userEvent.type(field, "client-secret");
    await userEvent.click(within(owner).getByRole("button", { name: "Atualizar" }));
    await waitFor(() =>
      expect(api.updateSecret).toHaveBeenCalledWith("discord_client_secret", "client-secret"),
    );
    await waitFor(() =>
      expect(within(owner).getByRole("button", { name: /Trocar conta/ })).toBeEnabled(),
    );
    await userEvent.click(within(owner).getByRole("button", { name: "Remover Client Secret" }));
    await waitFor(() => expect(api.removeSecret).toHaveBeenCalledWith("discord_client_secret"));
    await waitFor(() => expect(field).toHaveAttribute("placeholder", "Ainda não configurado"));
  });

  it("reports when the owner's account cannot be checked", async () => {
    vi.mocked(api.getDiscordConnection).mockRejectedValue(new Error("offline"));
    renderScreen(<InstallationPage />);
    expect(
      await screen.findByText("Não foi possível consultar a conta conectada."),
    ).toBeInTheDocument();
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
