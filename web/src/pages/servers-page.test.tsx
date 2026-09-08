import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { aGuild, dashboardContext, guildSelection, renderScreen } from "../test-utils";
import { ServersPage } from "./servers-page";

const engineGuild = aGuild({ id: "g2", installed: false, name: "Engine Guild" });

function withGuilds(overrides: Parameters<typeof guildSelection>[0]) {
  return dashboardContext({ guilds: guildSelection(overrides) });
}

describe("ServersPage", () => {
  it("shows the installed server with its configuration summary", () => {
    renderScreen(<ServersPage />, { context: dashboardContext() });
    expect(screen.getByRole("heading", { name: "Pixelforge" })).toBeInTheDocument();
    expect(screen.getByText("Instalado e configurado")).toBeInTheDocument();
    expect(screen.getByText("Padrão OpenRouter")).toBeInTheDocument();
    expect(screen.getByText("#atas-de-reuniao")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("links an installed server to its configuration screen", () => {
    renderScreen(<ServersPage />, { context: dashboardContext() });
    expect(screen.getByRole("link", { name: /Configurar/ })).toHaveAttribute("href", "/guilds/g1");
  });

  it("lists a server that does not have the bot yet", () => {
    renderScreen(<ServersPage />, {
      context: withGuilds({ allGuilds: [engineGuild], guilds: [], selectedGuildId: "" }),
    });
    expect(screen.getByText("Bot não instalado")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Instalar no Discord/ })).toHaveAttribute(
      "href",
      "https://discord.com/install",
    );
  });

  it("counts installed and available servers", () => {
    renderScreen(<ServersPage />, {
      context: withGuilds({ allGuilds: [aGuild(), engineGuild], guilds: [aGuild()] }),
    });
    expect(screen.getByText("1 instalado · 1 disponíveis")).toBeInTheDocument();
  });

  it("refreshes the list on demand", async () => {
    const reload = vi.fn();
    renderScreen(<ServersPage />, { context: withGuilds({ reload }) });
    await userEvent.click(screen.getByRole("button", { name: /Atualizar lista/ }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("shows a skeleton while the list loads", () => {
    renderScreen(<ServersPage />, {
      context: withGuilds({ allGuilds: undefined, guilds: undefined, selectedGuildId: "" }),
    });
    expect(screen.getByRole("status")).toHaveTextContent("Carregando servidores…");
  });

  it("points at the Discord connection when the list fails", () => {
    renderScreen(<ServersPage />, {
      context: withGuilds({
        allGuilds: undefined,
        error: true,
        guilds: undefined,
        selectedGuildId: "",
      }),
    });
    expect(screen.getByRole("heading", { name: "Servidores indisponíveis" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver conexão Discord" })).toHaveAttribute(
      "href",
      "/account",
    );
  });

  it("asks the operator to connect Discord when nothing is owned", () => {
    renderScreen(<ServersPage />, {
      context: withGuilds({ allGuilds: [], guilds: [], selectedGuildId: "" }),
    });
    expect(screen.getByRole("heading", { name: "Nenhum servidor encontrado" })).toBeInTheDocument();
  });

  it("falls back when the server has no profile or forum yet", () => {
    const bare = aGuild({ activeProfile: null, callCount: null, summaryForum: null });
    renderScreen(<ServersPage />, {
      context: withGuilds({ allGuilds: [bare], guilds: [bare] }),
    });
    expect(screen.getByText("Nenhum")).toBeInTheDocument();
    expect(screen.getByText("Não configurado")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
