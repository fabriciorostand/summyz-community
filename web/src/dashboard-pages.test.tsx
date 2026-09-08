import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api, type Profile } from "./api";
import {
  AccountPage,
  AnalyticsDashboardPage,
  CommandsPage,
  GuildConfigurationPage,
  GuildsPage,
  InstallationPage,
  MeetingHistoryDetailPage,
  MeetingHistoryPage,
} from "./dashboard-pages";

afterEach(() => vi.restoreAllMocks());

describe("supplementary dashboard pages", () => {
  it("renders installed and available guilds", async () => {
    vi.spyOn(api, "listGuilds").mockResolvedValue([
      {
        iconUrl: null,
        id: "installed",
        installUrl: "https://discord.com/install",
        installed: true,
        name: "Engineering",
      },
      {
        iconUrl: "https://cdn.example.com/icon.png",
        id: "available",
        installUrl: "https://discord.com/install",
        installed: false,
        name: "Product",
      },
    ]);

    renderPage(<GuildsPage />);

    expect(await screen.findByText("Engineering")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /configurar/i })).toHaveAttribute(
      "href",
      "/guilds/installed",
    );
    expect(screen.getByRole("link", { name: /instalar/i })).toHaveAttribute(
      "href",
      "https://discord.com/install",
    );
  });

  it("renders empty, error, and command reference states", async () => {
    const list = vi.spyOn(api, "listGuilds").mockResolvedValueOnce([]);
    const first = renderPage(<GuildsPage />);
    expect(await screen.findByText("Conecte sua conta Discord")).toBeInTheDocument();
    first.unmount();

    list.mockRejectedValueOnce(new Error("offline"));
    const second = renderPage(<GuildsPage />);
    expect(await screen.findByText("Servidores indisponíveis")).toBeInTheDocument();
    second.unmount();

    renderPage(<CommandsPage />);
    expect(screen.getByText("/record start")).toBeInTheDocument();
    expect(screen.getByText("/config role")).toBeInTheDocument();
  });

  it("updates installation fields, secrets, toggles, and saves", async () => {
    vi.spyOn(api, "getInstallationSettings").mockResolvedValue({
      discordClientId: "client-id",
      publicBaseUrl: "https://old.example.com",
      registrationEnabled: false,
      secrets: {
        discordBotToken: true,
        discordClientSecret: false,
        openRouterApiKey: false,
        smtpPassword: false,
      },
      setupCompleted: true,
      smtp: {
        fromEmail: "mail@example.com",
        fromName: "Summyz",
        host: "smtp.example.com",
        port: 587,
        replyTo: null,
        secure: false,
        user: "smtp-user",
      },
    });
    const updateSettings = vi.spyOn(api, "updateInstallationSettings").mockResolvedValue(undefined);
    const updateSecret = vi.spyOn(api, "updateSecret").mockResolvedValue(undefined);

    renderPage(<InstallationPage />);
    expect(await screen.findByRole("heading", { name: "Instalação" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Client ID"), { target: { value: "new-client" } });
    fireEvent.change(screen.getByLabelText("URL pública"), {
      target: { value: "https://new.example.com" },
    });
    fireEvent.change(screen.getByLabelText("Servidor SMTP"), {
      target: { value: "smtp2.example.com" },
    });
    fireEvent.change(screen.getByLabelText("Porta"), { target: { value: "465" } });
    fireEvent.change(screen.getByLabelText("Login SMTP"), { target: { value: "new-user" } });
    fireEvent.change(screen.getByLabelText("E-mail remetente"), {
      target: { value: "new@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Nome do remetente"), {
      target: { value: "Summyz CI" },
    });
    fireEvent.click(requiredElement(screen.getByText("Cadastro público").closest("label")));
    fireEvent.click(requiredElement(screen.getByText("TLS implícito").closest("label")));
    fireEvent.change(screen.getByLabelText("Chave OpenRouter"), { target: { value: "secret" } });
    const secretField = screen.getByLabelText("Chave OpenRouter").closest(".secret-field");
    fireEvent.click(requiredElement(secretField?.querySelector("button")));
    await waitFor(() => expect(updateSecret).toHaveBeenCalledWith("openrouter_api_key", "secret"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar instalação" }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalled());
  });

  it("applies history filters, exact search, clearing, and pagination", async () => {
    localStorage.removeItem("summyz:selected-guild");
    vi.spyOn(api, "listGuilds").mockResolvedValue([
      {
        iconUrl: null,
        id: "guild-1",
        installUrl: "https://discord.com/install",
        installed: true,
        name: "Engineering",
      },
      {
        iconUrl: null,
        id: "guild-2",
        installUrl: "https://discord.com/install",
        installed: true,
        name: "Product",
      },
    ]);
    const listMeetings = vi.spyOn(api, "listMeetings").mockResolvedValue({
      items: [
        {
          completedAt: null,
          contentRetained: false,
          durationMs: null,
          failureCode: "provider_error",
          meetingId: "meeting-1",
          participants: null,
          pipelineStatus: "failed",
          startedAt: "2026-09-01T12:00:00.000Z",
          voiceChannelName: null,
        },
      ],
      page: 1,
      pageSize: 20,
      timeZone: "America/Sao_Paulo",
      total: 40,
    });

    renderPage(<MeetingHistoryPage />);
    expect(await screen.findByRole("link", { name: /ver detalhes/i })).toBeInTheDocument();
    expect(screen.getAllByText("Falhou")).not.toHaveLength(0);
    expect(screen.getByText(/participantes: informação indisponível/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("Até"), { target: { value: "2026-09-30" } });
    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "failed" } });
    await waitFor(() =>
      expect(listMeetings).toHaveBeenLastCalledWith("guild-1", {
        dateFrom: "2026-09-01",
        dateTo: "2026-09-30",
        page: 1,
        state: "failed",
      }),
    );
    fireEvent.change(screen.getByLabelText("ID da reunião"), { target: { value: "meeting-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Pesquisar" }));
    expect(await screen.findByRole("button", { name: "Limpar" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Limpar" }));
    await screen.findByRole("link", { name: /ver detalhes/i });
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() =>
      expect(listMeetings).toHaveBeenCalledWith("guild-1", {
        dateFrom: "2026-09-01",
        dateTo: "2026-09-30",
        page: 2,
        state: "failed",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Anterior" }));
    await waitFor(() => expect(screen.getByText("Página 1 de 2")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Servidor"), { target: { value: "guild-2" } });
    await waitFor(() =>
      expect(listMeetings).toHaveBeenCalledWith("guild-2", {
        dateFrom: "2026-09-01",
        dateTo: "2026-09-30",
        page: 1,
        state: "failed",
      }),
    );
  });

  it("renders empty and failed analytics states", async () => {
    localStorage.removeItem("summyz:selected-guild");
    const listGuilds = vi.spyOn(api, "listGuilds").mockResolvedValueOnce([]);
    const first = renderPage(<AnalyticsDashboardPage />);
    expect(await screen.findByText("Nenhum servidor instalado")).toBeInTheDocument();
    first.unmount();

    listGuilds.mockResolvedValueOnce([
      {
        iconUrl: null,
        id: "guild-1",
        installUrl: "https://discord.com/install",
        installed: true,
        name: "Engineering",
      },
    ]);
    vi.spyOn(api, "getDashboard").mockRejectedValue(new Error("offline"));
    const second = renderPage(<AnalyticsDashboardPage />);
    expect(await screen.findByText("Dashboard indisponível")).toBeInTheDocument();
    second.unmount();

    listGuilds.mockRejectedValueOnce(new Error("offline"));
    renderPage(<AnalyticsDashboardPage />);
    expect(await screen.findByText("Dashboard indisponível")).toBeInTheDocument();
  });

  it("renders a failed meeting whose sensitive content was not retained", async () => {
    localStorage.setItem("summyz:selected-guild", "guild-1");
    vi.spyOn(api, "listGuilds").mockResolvedValue([
      {
        iconUrl: null,
        id: "guild-1",
        installUrl: "https://discord.com/install",
        installed: true,
        name: "Engineering",
      },
      {
        iconUrl: null,
        id: "guild-2",
        installUrl: "https://discord.com/install",
        installed: true,
        name: "Product",
      },
    ]);
    vi.spyOn(api, "getMeeting").mockResolvedValue({
      aiProfile: null,
      audioRetained: false,
      completedAt: "2026-09-01T12:01:00.000Z",
      contentRetained: false,
      cost: {
        attemptCounts: { confirmed: 0, notApplicable: 0, pending: 0, unattributed: 0 },
        breakdown: [],
        confirmed: [],
      },
      discordUrl: null,
      durationMs: 60_000,
      failureCode: "summary_failed",
      meetingId: "meeting-1",
      participants: null,
      pipelineStatus: "failed",
      rawTranscript: null,
      startedAt: "2026-09-01T12:00:00.000Z",
      summary: { language: "en", status: "failed" },
      timeZone: "America/Sao_Paulo",
      transcript: null,
      voiceChannelName: null,
    });

    renderPage(<MeetingHistoryDetailPage />, "/history/meeting-1", "/history/:meetingId");
    expect(await screen.findByText(/summary could not be generated/i)).toBeInTheDocument();
    expect(screen.getAllByText("Conteúdo não retido.")).toHaveLength(1);
    expect(screen.getAllByText("Informação indisponível").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Servidor"), { target: { value: "guild-2" } });
    await waitFor(() => expect(screen.queryByText(/summary could not be generated/i)).toBeNull());
  });

  it("updates every guild configuration boundary", async () => {
    vi.spyOn(api, "getGuildConfiguration").mockResolvedValue({
      activeProfileId: null,
      profiles: [configurationProfile()],
      recordingRoleIds: ["moderator"],
      settings: {
        botLanguage: "pt-BR",
        persistMeetingAudio: false,
        persistMeetingContent: true,
      },
      summaryForum: { forumId: "forum", tagId: "tag" },
    });
    vi.spyOn(api, "getGuildResources").mockResolvedValue({
      forums: [{ id: "forum", name: "Resumos", tags: [{ id: "tag", name: "Call" }] }],
      roles: [
        { id: "moderator", name: "Moderador" },
        { id: "facilitator", name: "Facilitador" },
      ],
    });
    const updateSettings = vi.spyOn(api, "updateGuildSettings").mockResolvedValue(undefined);
    const updateRoles = vi.spyOn(api, "updateRoles").mockResolvedValue(undefined);
    const updateForum = vi.spyOn(api, "updateForum").mockResolvedValue(undefined);
    const setActiveProfile = vi.spyOn(api, "setActiveProfile").mockResolvedValue(undefined);

    renderPage(<GuildConfigurationPage />, "/guilds/guild-1", "/guilds/:guildId");

    expect(
      await screen.findByRole("heading", { name: "Configuração do servidor" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Idioma do bot"), { target: { value: "en" } });
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith(
        "guild-1",
        expect.objectContaining({ botLanguage: "en" }),
      ),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /reter conteúdo/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /reter áudio/i }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(3));

    fireEvent.click(screen.getByRole("checkbox", { name: "Moderador" }));
    await waitFor(() => expect(updateRoles).toHaveBeenCalledWith("guild-1", []));
    fireEvent.click(screen.getByRole("checkbox", { name: "Facilitador" }));
    await waitFor(() => expect(updateRoles).toHaveBeenLastCalledWith("guild-1", ["facilitator"]));

    fireEvent.change(screen.getByLabelText("Tag padrão"), { target: { value: "" } });
    await waitFor(() => expect(updateForum).toHaveBeenCalledWith("guild-1", { forumId: "forum" }));
    fireEvent.change(screen.getByLabelText("Canal de fórum"), { target: { value: "" } });
    await waitFor(() => expect(updateForum).toHaveBeenLastCalledWith("guild-1", null));
    fireEvent.change(screen.getByLabelText("Canal de fórum"), { target: { value: "forum" } });
    await waitFor(() =>
      expect(updateForum).toHaveBeenLastCalledWith("guild-1", { forumId: "forum" }),
    );
    fireEvent.change(screen.getByLabelText("Perfil de processamento"), {
      target: { value: "profile-1" },
    });
    await waitFor(() => expect(setActiveProfile).toHaveBeenCalledWith("guild-1", "profile-1"));
  });

  it("shows Discord connection failures and recovers the busy state", async () => {
    const getConnection = vi
      .spyOn(api, "getDiscordConnection")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ connected: true, discordUsername: "fabricio" });
    const first = renderPage(<AccountPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/não foi possível consultar/i);
    first.unmount();

    vi.spyOn(api, "disconnectDiscord").mockRejectedValue(new Error("offline"));
    const second = renderPage(<AccountPage />);
    expect(await screen.findByText(/conectado como fabricio/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Desconectar Discord" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/não foi possível consultar/i);
    expect(screen.getByRole("button", { name: "Desconectar Discord" })).toBeEnabled();
    second.unmount();

    getConnection.mockResolvedValueOnce({ connected: false });
    vi.spyOn(api, "connectDiscord").mockRejectedValue(new Error("offline"));
    renderPage(<AccountPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Conectar ao Discord" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/não foi possível consultar/i);
    expect(screen.getByRole("button", { name: "Conectar ao Discord" })).toBeEnabled();
    expect(getConnection).toHaveBeenCalledTimes(3);
  });
});

function renderPage(element: React.ReactNode, entry = "/", path = "/") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route element={<Outlet context={user} />} path={path}>
          <Route index element={element} />
        </Route>
        <Route element={<div>History destination</div>} path="/history" />
      </Routes>
    </MemoryRouter>,
  );
}

function requiredElement<T extends Element>(element: T | null | undefined): T {
  if (element === null || element === undefined) throw new Error("Expected element to exist");
  return element;
}

const user = {
  dashboardLanguage: "pt-BR" as const,
  email: "owner@example.com",
  emailVerified: true,
  installationRole: "administrator" as const,
  userId: "00000000-0000-4000-8000-000000000001",
};

function configurationProfile(): Profile {
  return {
    language: "auto",
    name: "External profile",
    profileId: "profile-1",
    profileType: "external",
    refinement: {
      generation: {},
      maxChunkCharacters: 500_000,
      model: "model-r",
      prompt: "Refine.",
      provider: "openrouter",
    },
    summary: {
      consolidationPrompt: "Consolidate.",
      extractionPrompt: "Extract.",
      generation: {},
      maxChunkCharacters: 500_000,
      model: "model-s",
      provider: "openrouter",
    },
    transcription: {
      interSpeechSilenceMs: 0,
      mergeMaxGapMs: 2_000,
      model: "model-t",
      prompt: null,
      provider: "openrouter",
      providerOptions: {},
      vad: {
        enabled: true,
        minSilenceDurationMs: 768,
        minSpeechDurationMs: 96,
        negativeSpeechThreshold: "auto",
        speechPadMs: 96,
        threshold: 0.5,
      },
    },
    translation: null,
    userId: "00000000-0000-4000-8000-000000000001",
  };
}
