import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLanguage } from "../i18n/store";
import { api } from "../lib/api";
import { leaveDashboardFor } from "../lib/browser-navigation";
import { aConnectedAccount, aSettings, renderWithRouter } from "../tests/test-utils";
import { SidebarAccount } from "./sidebar-account";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  api: { getDiscordConnection: vi.fn(), startDiscordConnection: vi.fn() },
}));
vi.mock("../lib/browser-navigation", () => ({ leaveDashboardFor: vi.fn() }));

const authorizationUrl = "https://discord.com/oauth2/authorize";

beforeEach(() => {
  vi.mocked(api.getDiscordConnection).mockResolvedValue(aConnectedAccount());
  vi.mocked(api.startDiscordConnection).mockResolvedValue(authorizationUrl);
});

afterEach(() => {
  vi.clearAllMocks();
});

function account() {
  return screen.getByRole("region", { name: "Conta do dono no Discord" });
}

describe("SidebarAccount", () => {
  it("shows the connected account with its Discord photo and name", async () => {
    renderWithRouter(<SidebarAccount settings={aSettings()} />);
    expect(await within(account()).findByText("pixel.owner")).toBeInTheDocument();
    const photo = within(account()).getByRole("presentation", { hidden: true });
    expect(photo).toHaveAttribute("src", "https://cdn.discordapp.com/avatars/owner-1/a1b2c3.png");
    expect(photo).toHaveClass("rounded-full");
    expect(within(account()).queryByRole("button", { name: /Conectar/ })).toBeNull();
  });

  it("falls back to the initial when Discord never sent a photo", async () => {
    vi.mocked(api.getDiscordConnection).mockResolvedValue(aConnectedAccount({ avatarUrl: null }));
    renderWithRouter(<SidebarAccount settings={aSettings()} />);
    expect(await within(account()).findByText("P")).toHaveClass("rounded-full");
    expect(within(account()).queryByRole("presentation", { hidden: true })).toBeNull();
  });

  it("falls back to the initial when the photo fails to load", async () => {
    renderWithRouter(<SidebarAccount settings={aSettings()} />);
    await within(account()).findByText("pixel.owner");
    fireEvent.error(within(account()).getByRole("presentation", { hidden: true }));
    expect(within(account()).getByText("P")).toHaveClass("rounded-full");
  });

  it("confirms before switching the owner's account", async () => {
    renderWithRouter(<SidebarAccount settings={aSettings()} />);
    const switchButton = await within(account()).findByRole("button", { name: "Trocar conta" });
    expect(switchButton).toHaveAttribute("title", "Trocar conta");
    await userEvent.click(switchButton);
    const dialog = screen.getByRole("dialog", { name: "Trocar a conta do Discord?" });
    expect(dialog).toHaveTextContent(
      "Os servidores da conta atual deixarão de aceitar gravações e ficarão só no histórico; calls e configurações continuarão salvas.",
    );
    expect(dialog).not.toHaveTextContent(/No Discord|pixel\.owner|senha da instalação/);
    await userEvent.click(within(dialog).getByRole("button", { name: "Alterar" }));
    await waitFor(() => expect(leaveDashboardFor).toHaveBeenCalledWith(authorizationUrl));
  });

  it("keeps the account when the switch is cancelled", async () => {
    renderWithRouter(<SidebarAccount settings={aSettings()} />);
    await userEvent.click(await within(account()).findByRole("button", { name: "Trocar conta" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.startDiscordConnection).not.toHaveBeenCalled();
  });

  it("warns in public mode that switching asks for the password again", async () => {
    renderWithRouter(<SidebarAccount settings={aSettings({ accessMode: "public" })} />);
    await userEvent.click(await within(account()).findByRole("button", { name: "Trocar conta" }));
    expect(screen.getByRole("dialog", { name: "Trocar a conta do Discord?" })).toHaveTextContent(
      "Ao voltar, entre de novo com a senha da instalação.",
    );
  });

  it("offers only the connect button when no account is connected", async () => {
    vi.mocked(api.getDiscordConnection).mockResolvedValue({ connected: false });
    renderWithRouter(<SidebarAccount settings={aSettings()} />);
    const connect = await within(account()).findByRole("button", {
      name: "Conectar Discord",
    });
    expect(within(account()).queryByText(/Nenhuma conta conectada/)).toBeNull();
    expect(within(account()).queryByRole("link")).toBeNull();
    await userEvent.click(connect);
    // Local mode keeps the dashboard session, so there is nothing to confirm.
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(leaveDashboardFor).toHaveBeenCalledWith(authorizationUrl));
  });

  it("asks for confirmation in public mode, where connecting ends the session", async () => {
    vi.mocked(api.getDiscordConnection).mockResolvedValue({ connected: false });
    renderWithRouter(<SidebarAccount settings={aSettings({ accessMode: "public" })} />);
    await userEvent.click(
      await within(account()).findByRole("button", { name: "Conectar Discord" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Conectar a conta Discord?" });
    expect(dialog).toHaveTextContent(
      "Ao voltar do Discord, entre de novo com a senha da instalação.",
    );
    expect(api.startDiscordConnection).not.toHaveBeenCalled();
    const confirm = within(dialog).getByRole("button", { name: "Continuar no Discord" });
    expect(confirm).toHaveClass("bg-action-gradient");
    await userEvent.click(confirm);
    await waitFor(() => expect(leaveDashboardFor).toHaveBeenCalledWith(authorizationUrl));
  });

  it.each([
    [
      "the Client Secret",
      { discordBotToken: true, discordClientSecret: false, openRouterApiKey: true },
      "Salve o Client Secret na aba Bot",
    ],
    [
      "the bot token",
      { discordBotToken: false, discordClientSecret: true, openRouterApiKey: true },
      "Salve o token do bot na aba Bot",
    ],
  ])(
    "holds the connection and points to the Bot tab while %s is missing",
    async (_missing, secrets, reason) => {
      vi.mocked(api.getDiscordConnection).mockResolvedValue({ connected: false });
      const onNavigate = vi.fn();
      renderWithRouter(
        <SidebarAccount onNavigate={onNavigate} settings={aSettings({ secrets })} />,
      );
      expect(
        await within(account()).findByRole("button", { name: "Conectar Discord" }),
      ).toBeDisabled();
      const link = within(account()).getByRole("link", { name: reason });
      expect(link).toHaveAttribute("href", "/bot");
      await userEvent.click(link);
      expect(onNavigate).toHaveBeenCalledTimes(1);
    },
  );

  it("holds the switch too while the Client Secret is missing", async () => {
    renderWithRouter(
      <SidebarAccount
        settings={aSettings({
          secrets: { discordBotToken: true, discordClientSecret: false, openRouterApiKey: true },
        })}
      />,
    );
    expect(await within(account()).findByRole("button", { name: "Trocar conta" })).toBeDisabled();
    expect(
      within(account()).getByRole("link", { name: "Salve o Client Secret na aba Bot" }),
    ).toBeInTheDocument();
  });

  it("reports when the connected account cannot be checked", async () => {
    vi.mocked(api.getDiscordConnection).mockRejectedValue(new Error("offline"));
    renderWithRouter(<SidebarAccount settings={aSettings()} />);
    expect(
      await within(account()).findByText("Não foi possível consultar a conta conectada."),
    ).toBeInTheDocument();
  });

  it("reads the connection again when another application replaces the bot", async () => {
    vi.mocked(api.getDiscordConnection)
      .mockResolvedValueOnce(aConnectedAccount({ discordUsername: "old.owner" }))
      .mockResolvedValue({ connected: false });
    const { rerender } = render(<SidebarAccount settings={aSettings()} />, {
      wrapper: MemoryRouter,
    });
    expect(await within(account()).findByText("old.owner")).toBeInTheDocument();
    rerender(<SidebarAccount settings={aSettings({ discordApplicationId: "222" })} />);
    expect(
      await within(account()).findByRole("button", { name: "Conectar Discord" }),
    ).toBeInTheDocument();
    expect(within(account()).queryByText("old.owner")).toBeNull();
  });

  it("reads in English", async () => {
    setLanguage("en");
    renderWithRouter(<SidebarAccount settings={aSettings()} />);
    const region = screen.getByRole("region", { name: "Owner's Discord account" });
    await userEvent.click(await within(region).findByRole("button", { name: "Switch account" }));
    const dialog = screen.getByRole("dialog", { name: "Switch Discord account?" });
    expect(dialog).toHaveTextContent(
      "The current account's servers will stop accepting recordings and stay in history only; calls and settings will stay saved.",
    );
    expect(dialog).not.toHaveTextContent(/On Discord|pixel\.owner/);
    expect(within(dialog).getByRole("button", { name: "Change" })).toBeInTheDocument();
  });
});
