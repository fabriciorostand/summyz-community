import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLanguage } from "../i18n/store";
import { api } from "../lib/api";
import { aGuild, dashboardContext, guildSelection, renderScreen } from "../tests/test-utils";
import { ServersPage } from "./servers-page";

vi.mock("../lib/api", () => ({ api: { getBotInstallation: vi.fn() } }));

const installUrl = "https://discord.com/oauth2/authorize?client_id=1289443021764919306";

beforeEach(() => {
  vi.mocked(api.getBotInstallation).mockResolvedValue({
    applicationId: "1289443021764919306",
    configured: true,
    installUrl,
  });
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
    expect(screen.getByText("Calls in the period")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Refresh list/ })).toBeInTheDocument();
    await waitFor(() => expect(api.getBotInstallation).toHaveBeenCalled());
  });

  it("lists the servers the bot is in with their essentials", async () => {
    renderScreen(<ServersPage />);
    expect(screen.getByRole("heading", { name: "Pixelforge" })).toBeInTheDocument();
    expect(screen.getByText("Instalado e configurado")).toBeInTheDocument();
    expect(screen.getByText("Padrão OpenRouter")).toBeInTheDocument();
    expect(screen.getByText("#atas-de-reuniao")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
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
    expect(screen.getByText("—")).toBeInTheDocument();
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
});
