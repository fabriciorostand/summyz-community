import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLanguage } from "../i18n/store";
import { api } from "../lib/api";
import { leaveDashboardFor } from "../lib/browser-navigation";
import {
  aGuild,
  aSettings,
  dashboardContext,
  guildSelection,
  renderScreen,
} from "../tests/test-utils";
import { ServersPage } from "./servers-page";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  api: {
    getBotInstallation: vi.fn(),
    getDiscordConnection: vi.fn(),
    startDiscordConnection: vi.fn(),
  },
}));
vi.mock("../lib/browser-navigation", () => ({ leaveDashboardFor: vi.fn() }));

const installUrl = "https://discord.com/oauth2/authorize?client_id=123456789012345678";

beforeEach(() => {
  vi.mocked(api.getBotInstallation).mockResolvedValue({
    applicationId: "123456789012345678",
    configured: true,
    installUrl,
  });
  vi.mocked(api.getDiscordConnection).mockResolvedValue({
    connected: true,
    discordUserId: "owner-1",
    discordUsername: "pixel.owner",
  });
  vi.mocked(api.startDiscordConnection).mockResolvedValue("https://discord.com/oauth2/authorize");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ServersPage", () => {
  it("reads in English", async () => {
    setLanguage("en");
    renderScreen(<ServersPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Servers" })).toBeInTheDocument();
    expect(screen.getByText("Installed and configured")).toBeInTheDocument();
    expect(screen.queryByText("Calls in the period")).toBeNull();
    expect(screen.getByRole("button", { name: /Refresh list/ })).toBeInTheDocument();
    await waitFor(() => expect(api.getBotInstallation).toHaveBeenCalled());
  });

  it("lists the servers the bot is in with their essentials", async () => {
    renderScreen(<ServersPage />);
    expect(screen.getByRole("heading", { name: "Pixelforge" })).toBeInTheDocument();
    expect(screen.getByText("Instalado e configurado")).toBeInTheDocument();
    expect(screen.getByText("Padrão OpenRouter")).toBeInTheDocument();
    expect(screen.getByText("#atas-de-reuniao")).toBeInTheDocument();
    expect(screen.queryByText("Calls no período")).toBeNull();
    expect(screen.queryByText("42")).toBeNull();
    expect(screen.getByRole("link", { name: /Configurar/ })).toHaveAttribute("href", "/guilds/g1");
    expect(screen.getByRole("link", { name: /Configurar/ })).toHaveClass(
      "bg-action-gradient",
      "hover:bg-action-gradient-hover",
    );
    const links = await screen.findAllByRole("link", { name: /Adicionar o bot/ });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute("href", installUrl);
  });

  it("leaves the server count out of the header", () => {
    const guilds = [aGuild(), aGuild({ id: "g2", name: "Engine Guild" })];
    renderScreen(<ServersPage />, {
      context: dashboardContext({ guilds: guildSelection({ guilds }) }),
    });
    expect(screen.getByRole("heading", { name: "Engine Guild" })).toBeInTheDocument();
    expect(screen.queryByText(/com o bot/)).toBeNull();
  });

  it("shows what is missing on a server without profile or forum", () => {
    const guild = aGuild({ activeProfile: null, callCount: null, summaryForum: null });
    renderScreen(<ServersPage />, {
      context: dashboardContext({ guilds: guildSelection({ guilds: [guild] }) }),
    });
    expect(screen.getByText("Falta configurar")).toBeInTheDocument();
    expect(screen.getByText("Nenhum")).toBeInTheDocument();
    expect(screen.getByText("Não configurado")).toBeInTheDocument();
    expect(screen.queryByText("Calls no período")).toBeNull();
  });

  it("lets the facts of an installed server fill the card above its action", () => {
    renderScreen(<ServersPage />);
    expect(screen.getByText("Perfil ativo").closest("div.flex-col")).toHaveClass("flex-1");
  });

  it("reloads the list on demand", async () => {
    const reload = vi.fn();
    renderScreen(<ServersPage />, {
      context: dashboardContext({ guilds: guildSelection({ reload }) }),
    });
    await userEvent.click(screen.getByRole("button", { name: /Atualizar lista/ }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("keeps the refresh button at the start when the header wraps", () => {
    renderScreen(<ServersPage />);
    const button = screen.getByRole("button", { name: /Atualizar lista/ });
    expect(button.parentElement).not.toHaveClass("ml-auto");
  });

  it("gives the refresh button the overview control size", () => {
    renderScreen(<ServersPage />);
    expect(screen.getByRole("button", { name: /Atualizar lista/ })).toHaveClass(
      "h-[34px]",
      "text-[12.5px]",
    );
  });

  it("explains that the bot decides the list when it is in no server", async () => {
    renderScreen(<ServersPage />, {
      context: dashboardContext({ guilds: guildSelection({ guilds: [] }) }),
    });
    expect(
      screen.getByRole("heading", { name: "O bot ainda não está em nenhum servidor" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("link", { name: /Adicionar o bot a um servidor/ }),
    ).toHaveAttribute("href", installUrl);
  });

  it("keeps the Discord shortcut inert until the bot is configured", async () => {
    vi.mocked(api.getBotInstallation).mockResolvedValue({ configured: false });
    renderScreen(<ServersPage />);
    await waitFor(() => expect(api.getBotInstallation).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: /Adicionar o bot/ })).toBeNull();
  });

  it("shows loading and error states", () => {
    const { unmount } = renderScreen(<ServersPage />, {
      context: dashboardContext({ guilds: guildSelection({ guilds: undefined }) }),
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    unmount();
    renderScreen(<ServersPage />, {
      context: dashboardContext({ guilds: guildSelection({ error: true, guilds: undefined }) }),
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Servidores indisponíveis");
    expect(screen.getByRole("link", { name: "Ver instalação" })).toHaveAttribute(
      "href",
      "/installation",
    );
  });

  it("offers to install the bot in an owned server that does not have it", () => {
    const guild = aGuild({
      activeProfile: null,
      callCount: null,
      id: "g2",
      installed: false,
      installUrl: `${installUrl}&guild_id=g2`,
      name: "Engine Guild",
      summaryForum: null,
    });
    renderScreen(<ServersPage />, {
      context: dashboardContext({ guilds: guildSelection({ guilds: [guild] }) }),
    });
    expect(screen.getByText("Bot não instalado")).toBeInTheDocument();
    const hint = screen.getByText("Instale o bot para configurá-lo");
    // The hint takes the free space and centers itself vertically, so the action sits at the bottom.
    expect(hint.parentElement).toHaveClass("flex-1", "items-center");
    expect(hint).not.toHaveClass("text-center");
    expect(screen.getByRole("link", { name: /Instalar neste servidor/ })).toHaveAttribute(
      "href",
      `${installUrl}&guild_id=g2`,
    );
    expect(screen.queryByRole("link", { name: /Configurar/ })).toBeNull();
    expect(screen.queryByText("Perfil ativo")).toBeNull();
  });

  it("keeps a server with only recorded history one click away from its calls", async () => {
    const setSelectedGuildId = vi.fn();
    const guild = aGuild({
      activeProfile: null,
      callCount: null,
      id: "g3",
      installed: false,
      name: "Old Guild",
      owned: false,
      summaryForum: null,
    });
    renderScreen(<ServersPage />, {
      context: dashboardContext({
        guilds: guildSelection({ guilds: [guild], setSelectedGuildId }),
      }),
      path: "/servers",
      route: "/servers",
    });
    expect(screen.getByText("Somente histórico")).toBeInTheDocument();
    const body = screen.getByText(/As calls gravadas continuam disponíveis/);
    expect(body.parentElement).toHaveClass("flex-1");
    expect(body.parentElement).not.toHaveClass("items-center");
    expect(screen.queryByRole("link", { name: /Instalar neste servidor/ })).toBeNull();
    const history = screen.getByRole("link", { name: /Ver histórico/ });
    expect(history).toHaveAttribute("href", "/history");
    await userEvent.click(history);
    expect(setSelectedGuildId).toHaveBeenCalledWith("g3");
  });

  it("asks to connect the owner's account when none is connected", async () => {
    vi.mocked(api.getDiscordConnection).mockResolvedValue({ connected: false });
    renderScreen(<ServersPage />);
    expect(await screen.findByText("Conecte a conta Discord do dono")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Conectar conta Discord/ }));
    expect(leaveDashboardFor).toHaveBeenCalledWith("https://discord.com/oauth2/authorize");
  });

  it("points to Installation when the Client Secret is still missing", async () => {
    vi.mocked(api.getDiscordConnection).mockResolvedValue({ connected: false });
    renderScreen(<ServersPage />, {
      context: dashboardContext({
        settings: aSettings({
          secrets: { discordBotToken: true, discordClientSecret: false, openRouterApiKey: true },
        }),
      }),
    });
    expect(
      await screen.findByText("Antes, salve o Client Secret da aplicação em Instalação."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Conectar conta Discord/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Ver instalação" })).toHaveAttribute(
      "href",
      "/installation",
    );
  });

  it("asks nothing once the owner's account is connected", async () => {
    renderScreen(<ServersPage />);
    await waitFor(() => expect(api.getDiscordConnection).toHaveBeenCalled());
    expect(screen.queryByText("Conecte a conta Discord do dono")).toBeNull();
  });

  it.each([
    ["connected", "Conta Discord conectada."],
    ["cancelled", "A conexão foi cancelada no Discord."],
    ["failed", "Não foi possível conectar a conta Discord."],
    ["invalid_state", "O link de conexão expirou"],
  ])("reports the outcome of the Discord authorization (%s)", async (outcome, message) => {
    renderScreen(<ServersPage />, { path: "/servers", route: `/servers?discord=${outcome}` });
    expect(screen.getByText(new RegExp(message))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Fechar aviso" }));
    expect(screen.queryByText(new RegExp(message))).toBeNull();
  });

  it("ignores an unknown authorization outcome", () => {
    renderScreen(<ServersPage />, { path: "/servers", route: "/servers?discord=<script>" });
    expect(screen.queryByRole("button", { name: "Fechar aviso" })).toBeNull();
  });
});
