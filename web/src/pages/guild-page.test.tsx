import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "../lib/api";
import {
  aGuildConfiguration,
  aGuildResources,
  aProfile,
  chooseOption,
  dashboardContext,
  renderScreen,
} from "../tests/test-utils";
import { GuildPage } from "./guild-page";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ApiError: actual.ApiError,
    api: {
      getBotInstallation: vi.fn(),
      getGuildConfiguration: vi.fn(),
      getGuildResources: vi.fn(),
      setActiveProfile: vi.fn(),
      updateForum: vi.fn(),
      updateGuildSettings: vi.fn(),
      updateRecordingPermissions: vi.fn(),
    },
  };
});

function renderGuild(context = dashboardContext()) {
  return renderScreen(<GuildPage />, { context, path: "/guilds/:guildId", route: "/guilds/g1" });
}

beforeEach(() => {
  vi.mocked(api.getBotInstallation).mockResolvedValue({
    applicationId: "1",
    configured: true,
    installUrl: "https://discord.com/oauth2/authorize?client_id=1",
  });
  vi.mocked(api.getGuildConfiguration).mockResolvedValue(aGuildConfiguration());
  vi.mocked(api.getGuildResources).mockResolvedValue(aGuildResources());
  vi.mocked(api.setActiveProfile).mockResolvedValue(undefined);
  vi.mocked(api.updateForum).mockResolvedValue(undefined);
  vi.mocked(api.updateGuildSettings).mockResolvedValue(undefined);
  vi.mocked(api.updateRecordingPermissions).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GuildPage", () => {
  it("puts the essentials in front", async () => {
    renderGuild();
    expect(
      await screen.findByRole("heading", { name: "Perfil de IA usado neste servidor" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Onde publicar os resumos" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Quem pode iniciar uma gravação" }),
    ).toBeInTheDocument();
  });

  it("shows the essential cards without a section label or helper texts", async () => {
    renderGuild();
    await screen.findByRole("heading", { name: "Perfil de IA usado neste servidor" });
    expect(screen.queryByText("O essencial")).toBeNull();
    expect(screen.queryByText(/Sem um perfil ativo aqui/)).toBeNull();
    expect(screen.queryByText(/Cada call concluída gera um post/)).toBeNull();
    expect(screen.getByText("Avançado")).toBeInTheDocument();
  });

  it("has no quick commands card", async () => {
    renderGuild();
    await screen.findByRole("heading", { name: "Perfil de IA usado neste servidor" });
    expect(screen.queryByRole("heading", { name: "Comandos rápidos" })).toBeNull();
    expect(screen.queryByText("/record start")).toBeNull();
    expect(screen.queryByText("/record status")).toBeNull();
  });

  it("marks the active profile", async () => {
    renderGuild();
    expect(await screen.findByText("Em uso")).toBeInTheDocument();
    expect(screen.getByRole("radio", { checked: true })).toBeInTheDocument();
  });

  it("activates another profile", async () => {
    vi.mocked(api.getGuildConfiguration).mockResolvedValue(
      aGuildConfiguration({
        profiles: [aProfile(), aProfile({ name: "Local sem custo", profileId: "p2" })],
      }),
    );
    renderGuild();
    const radios = await screen.findAllByRole("radio");
    const second = radios[1];
    expect(second).toBeDefined();
    await userEvent.click(second as HTMLElement);
    await waitFor(() => expect(api.setActiveProfile).toHaveBeenCalledWith("g1", "p2"));
  });

  it("shows the member count of each role", async () => {
    renderGuild();
    expect(await screen.findByText("12 membros")).toBeInTheDocument();
    expect(screen.getByText("5 membros")).toBeInTheDocument();
  });

  it("grants a role and keeps the individual grants", async () => {
    renderGuild();
    const qa = await screen.findByText("QA");
    const checkbox = qa.parentElement?.querySelector("input[type=checkbox]");
    expect(checkbox).not.toBeNull();
    await userEvent.click(checkbox as HTMLElement);
    await waitFor(() =>
      expect(api.updateRecordingPermissions).toHaveBeenCalledWith("g1", {
        roleIds: ["r1", "r2"],
        userIds: [],
      }),
    );
  });

  it("warns when Discord cannot report member counts", async () => {
    vi.mocked(api.getGuildResources).mockResolvedValue(
      aGuildResources({
        memberCounts: {
          code: "discord_members_intent_unavailable",
          status: "unavailable",
        },
        roles: [{ id: "r1", memberCount: null, name: "Time Engine" }],
      }),
    );
    renderGuild();
    expect(await screen.findByText(/exige a intent de membros/)).toBeInTheDocument();
  });

  it("changes the summary forum", async () => {
    renderGuild();
    await screen.findByRole("combobox", { name: "Canal de fórum" });
    await chooseOption("Canal de fórum", "Não configurado");
    await waitFor(() => expect(api.updateForum).toHaveBeenCalledWith("g1", null));
  });

  it("keeps the default forum tag behind the advanced disclosure", async () => {
    renderGuild();
    const toggle = await screen.findByRole("button", { name: /Idioma do bot e tag de publicação/ });
    expect(toggle).toHaveTextContent("Português (Brasil) · sem tag");
    await userEvent.click(toggle);
    await chooseOption("Tag de publicação", "sprint");
    await waitFor(() =>
      expect(api.updateForum).toHaveBeenCalledWith("g1", { forumId: "f1", tagId: "t1" }),
    );
  });

  it("keeps retention behind the advanced disclosure", async () => {
    renderGuild();
    const trigger = await screen.findByRole("button", { name: /Privacidade e retenção/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("checkbox", { name: /Reter áudio bruto/ }));
    await waitFor(() =>
      expect(api.updateGuildSettings).toHaveBeenCalledWith("g1", {
        botLanguage: "pt-BR",
        persistMeetingAudio: true,
        persistMeetingContent: true,
      }),
    );
  });

  it("changes the bot language", async () => {
    renderGuild();
    await userEvent.click(await screen.findByRole("button", { name: /Idioma do bot/ }));
    await chooseOption("Idioma do bot", "English");
    await waitFor(() =>
      expect(api.updateGuildSettings).toHaveBeenCalledWith("g1", {
        botLanguage: "en",
        persistMeetingAudio: false,
        persistMeetingContent: true,
      }),
    );
  });

  it("summarises the server in numbers", async () => {
    renderGuild();
    expect(await screen.findByText("Este servidor em números")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("38,0")).toBeInTheDocument();
  });

  it("checks off the installation steps", async () => {
    renderGuild();
    expect(await screen.findByText("Bot presente no servidor")).toBeInTheDocument();
    expect(screen.getByText("Fórum de resumos definido")).toBeInTheDocument();
    expect(screen.getByText("Perfil de IA ativo")).toBeInTheDocument();
  });

  it("confirms a save in the header", async () => {
    renderGuild();
    await userEvent.click(await screen.findByRole("button", { name: /Idioma do bot/ }));
    await chooseOption("Idioma do bot", "English");
    expect(await screen.findByText("Alterações salvas")).toBeInTheDocument();
  });

  it("offers a retry when the configuration fails", async () => {
    vi.mocked(api.getGuildConfiguration).mockRejectedValue(new Error("offline"));
    renderGuild();
    expect(
      await screen.findByRole("heading", { name: "Configuração indisponível" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Tentar novamente/ }));
    await waitFor(() => expect(api.getGuildConfiguration).toHaveBeenCalledTimes(2));
  });

  it("says when the metrics are unavailable", async () => {
    renderGuild(dashboardContext({ dashboard: undefined }));
    expect(await screen.findByText("Métricas indisponíveis.")).toBeInTheDocument();
  });

  it("explains a 403 as the bot having left the server", async () => {
    vi.mocked(api.getGuildConfiguration).mockRejectedValue(
      new ApiError(403, "guild_access_denied"),
    );
    renderGuild();
    expect(
      await screen.findByRole("heading", { name: "O bot não está mais neste servidor" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Pixelforge");
    expect(await screen.findByRole("link", { name: /Adicionar de volta/ })).toHaveAttribute(
      "href",
      "https://discord.com/oauth2/authorize?client_id=1",
    );
    expect(screen.getByRole("link", { name: "Ver servidores" })).toHaveAttribute(
      "href",
      "/servers",
    );
  });
});
