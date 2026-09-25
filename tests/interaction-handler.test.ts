import {
  ChannelFlags,
  ChannelType,
  type Client,
  Events,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { describe, expect, it, vi } from "vitest";
import type { AiProfileCompatibilityStatus } from "../src/ai-profile.js";
import { aiProfileSchema, createInitialAiProfile } from "../src/ai-profile.js";
import { CostReportError } from "../src/cost/cost-report.js";
import { installInteractionHandler } from "../src/discord/interaction-handler.js";
import { MultilingualCheckpointRequiredError } from "../src/local-ai/local-model-manager.js";
import { createLogger } from "../src/logger.js";
import { OpenRouterModelPreflightError } from "../src/openrouter/model-preflight.js";
import type { RecordingCoordinator } from "../src/recording/recording-coordinator.js";
import { RecordingAlreadyActiveError } from "../src/recording/recording-coordinator.js";
import { InMemoryGuildConfigurationStore } from "./in-memory-guild-config-store.js";

interface InteractionOptions {
  administrator?: boolean;
  botLanguage?: "en" | "pt-BR";
  botMemberAvailable?: boolean;
  channelId?: string;
  chatInput?: boolean;
  commandName?: string;
  compatibility?: AiProfileCompatibilityStatus[];
  deferred?: boolean;
  forum?: object;
  guildAvailable?: boolean;
  guildId?: string | null;
  guildOwner?: boolean;
  manageGuild?: boolean;
  memberRoleIds?: string[];
  memberJoinedAt?: string;
  openRouterConfigured?: boolean | (() => Promise<boolean>);
  openRouterProfile?: boolean;
  profileComplete?: boolean;
  replied?: boolean;
  subcommand?: string;
  tag?: string;
  strings?: Record<string, string>;
  voiceChannel?: { id: string; name: string; type: ChannelType };
}

async function createHarness(options: InteractionOptions = {}) {
  const store = new InMemoryGuildConfigurationStore();
  const start = vi.fn(async () => ({ meetingId: "meeting-1" }));
  const get = vi.fn();
  const stop = vi.fn(async () => true);
  const coordinator = {
    get,
    start,
    stop,
  } as unknown as RecordingCoordinator;
  const costReport = {
    meeting: vi.fn(async () => "RELATÓRIO DA REUNIÃO"),
    period: vi.fn(async () => "RELATÓRIO DO PERÍODO"),
  };
  const profileType = options.openRouterProfile === true ? "external" : "local";
  const initialProfile = createInitialAiProfile(profileType, "pt-BR");
  const profile =
    options.profileComplete === false
      ? initialProfile
      : aiProfileSchema.parse({
          ...initialProfile,
          refinement: {
            ...initialProfile.refinement,
            model: options.openRouterProfile === true ? "vendor/refinement" : "qwen3:1.7b",
            provider: options.openRouterProfile === true ? "openrouter" : "ollama",
          },
          summary: {
            ...initialProfile.summary,
            model: options.openRouterProfile === true ? "vendor/summary" : "qwen3:4b",
            provider: options.openRouterProfile === true ? "openrouter" : "ollama",
          },
          transcription: {
            ...initialProfile.transcription,
            model: options.openRouterProfile === true ? "vendor/transcription" : "medium",
            provider: options.openRouterProfile === true ? "openrouter" : "faster-whisper",
          },
        });
  const aiProfileStore = {
    clearActiveProfile: vi.fn(async () => undefined),
    createProfile: vi.fn(async () => undefined),
    deleteProfile: vi.fn(async () => undefined),
    getActiveProfile: vi.fn(async () => profile),
    listActiveProfileIds: vi.fn(async () => new Set([profile.profileId])),
    listActiveProfileCounts: vi.fn(async () => new Map([[profile.profileId, 1]])),
    listProfiles: vi.fn(async () => [profile]),
    setActiveProfile: vi.fn(async () => undefined),
    updateProfile: vi.fn(async () => undefined),
  };
  const listeners = new Map<string, (event: unknown) => Promise<void> | void>();
  const client = {
    on: vi.fn((event: string, received: (value: unknown) => Promise<void> | void) => {
      listeners.set(event, received);
    }),
  } as unknown as Client;
  const openRouterConfigured = options.openRouterConfigured;
  installInteractionHandler(
    client,
    store,
    coordinator,
    createLogger("silent"),
    options.botLanguage ?? "pt-BR",
    costReport,
    aiProfileStore,
    async () => options.compatibility ?? [],
    typeof openRouterConfigured === "function"
      ? openRouterConfigured
      : () => openRouterConfigured ?? false,
  );

  const reply = vi.fn(async () => undefined);
  const editReply = vi.fn(async () => undefined);
  const deferReply = vi.fn(async () => undefined);
  const followUp = vi.fn(async () => undefined);
  const member = {
    id: "user-1",
    joinedAt: new Date(options.memberJoinedAt ?? "2026-09-08T12:00:00.000Z"),
    permissions: {
      has: (permission: bigint) =>
        (permission === PermissionFlagsBits.Administrator && options.administrator === true) ||
        (permission === PermissionFlagsBits.ManageGuild && options.manageGuild === true),
    },
    roles: { cache: { keys: () => (options.memberRoleIds ?? [])[Symbol.iterator]() } },
    voice: {
      channel: options.voiceChannel,
      channelId: options.voiceChannel?.id ?? null,
    },
  };
  const guild =
    options.guildAvailable === false
      ? null
      : {
          ownerId:
            options.guildOwner === false
              ? "owner-1"
              : options.guildOwner === true ||
                  options.administrator === true ||
                  options.manageGuild === true
                ? "user-1"
                : "owner-1",
          members: {
            fetch: vi.fn(async () => member),
            fetchMe: vi.fn(async () =>
              options.botMemberAvailable === false ? undefined : { id: "bot-1" },
            ),
          },
        };
  const interaction = {
    channelId: options.channelId ?? "command-chat",
    commandName: options.commandName ?? "record",
    deferred: options.deferred ?? false,
    deferReply,
    editReply,
    followUp,
    guild,
    guildId: options.guildId === undefined ? "guild-1" : options.guildId,
    isChatInputCommand: () => options.chatInput ?? true,
    options: {
      getChannel: vi.fn(() => options.forum),
      getRole: vi.fn(() => ({ id: "role-option", toString: () => "<@&role-option>" })),
      getString: vi.fn((name: string) => options.strings?.[name] ?? options.tag),
      getSubcommand: vi.fn(() => options.subcommand ?? "set"),
    },
    replied: options.replied ?? false,
    reply,
    user: { id: "user-1", toString: () => "<@user-1>" },
  };

  const listener = listeners.get(Events.InteractionCreate);
  const memberRemovedListener = listeners.get(Events.GuildMemberRemove);
  if (listener === undefined || memberRemovedListener === undefined) {
    throw new Error("O handler de interações não foi instalado");
  }
  return {
    costReport,
    aiProfileStore,
    deferReply,
    editReply,
    followUp,
    get,
    interaction,
    listener,
    memberRemovedListener,
    reply,
    start,
    stop,
    store,
  };
}

describe("fluxo de comandos do Discord", () => {
  it("permite somente o dono do servidor consultar custos por reunião", async () => {
    const denied = await createHarness({
      commandName: "recording-cost",
      strings: { id: "meeting-1" },
      subcommand: "meeting",
    });
    await denied.listener(denied.interaction);
    expect(denied.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/dono do servidor/i) }),
    );
    expect(denied.costReport.meeting).not.toHaveBeenCalled();

    const allowed = await createHarness({
      administrator: true,
      commandName: "recording-cost",
      strings: { id: "meeting-1" },
      subcommand: "meeting",
    });
    await allowed.listener(allowed.interaction);
    expect(allowed.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(allowed.costReport.meeting).toHaveBeenCalledWith("guild-1", "meeting-1");
    expect(allowed.editReply).toHaveBeenCalledWith("RELATÓRIO DA REUNIÃO");
  });

  it("consulta custos por período e informa reunião em andamento de forma amigável", async () => {
    const period = await createHarness({
      administrator: true,
      commandName: "recording-cost",
      strings: { from: "2026-08-01", to: "2026-08-31" },
      subcommand: "period",
    });
    await period.listener(period.interaction);
    expect(period.costReport.period).toHaveBeenCalledWith("guild-1", "2026-08-01", "2026-08-31");

    const active = await createHarness({
      administrator: true,
      commandName: "recording-cost",
      strings: { id: "meeting-1" },
      subcommand: "meeting",
    });
    active.costReport.meeting.mockRejectedValueOnce(new CostReportError("meeting_in_progress"));
    await active.listener(active.interaction);
    expect(active.editReply).toHaveBeenCalledWith(
      expect.stringMatching(/reunião terminar.*custos/i),
    );
  });

  it("responde em inglês quando esse é o idioma configurado", async () => {
    const unauthorized = await createHarness({ botLanguage: "en" });
    await unauthorized.listener(unauthorized.interaction);
    expect(unauthorized.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "You do not have an authorized role to start recordings.",
      }),
    );

    const guildOnly = await createHarness({
      botLanguage: "en",
      guildAvailable: false,
    });
    await guildOnly.listener(guildOnly.interaction);
    expect(guildOnly.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: "This command can only be used in a server." }),
    );
  });

  it("ignora interações que não são comandos e comandos desconhecidos", async () => {
    const nonCommand = await createHarness({ chatInput: false });
    await nonCommand.listener(nonCommand.interaction);
    expect(nonCommand.reply).not.toHaveBeenCalled();

    const unknownCommand = await createHarness({ commandName: "unknown" });
    await unknownCommand.listener(unknownCommand.interaction);
    expect(unknownCommand.reply).not.toHaveBeenCalled();
  });

  it("rejeita comandos fora de servidor independentemente do contexto ausente", async () => {
    const missingGuild = await createHarness({
      commandName: "recording-summary-forum",
      guildAvailable: false,
    });
    await missingGuild.listener(missingGuild.interaction);

    const missingGuildId = await createHarness({
      commandName: "recording-role",
      guildId: null,
    });
    await missingGuildId.listener(missingGuildId.interaction);

    const record = await createHarness({ commandName: "record", guildAvailable: false });
    await record.listener(record.interaction);

    const stop = await createHarness({ commandName: "stop", guildAvailable: false });
    await stop.listener(stop.interaction);

    for (const context of [missingGuild, missingGuildId, record, stop]) {
      expect(context.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: "Este comando só pode ser usado em um servidor." }),
      );
    }
  });

  it("prioriza falta de autorização quando o usuário também está fora da voz", async () => {
    const context = await createHarness();

    await context.listener(context.interaction);

    expect(context.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Você não possui um cargo autorizado para gravar." }),
    );
  });

  it("autoriza concessão individual somente enquanto a associação ao servidor é a mesma", async () => {
    const joinedAt = "2026-09-08T12:00:00.000Z";
    const allowed = await createHarness({
      memberJoinedAt: joinedAt,
      voiceChannel: { id: "voice-1", name: "Lobby", type: ChannelType.GuildVoice },
    });
    await allowed.store.setRecordingPermissions("guild-1", {
      roleIds: [],
      userGrants: [{ memberJoinedAt: joinedAt, userId: "user-1" }],
    });
    await allowed.store.setSummaryForum("guild-1", { forumId: "forum-1" });

    await allowed.listener(allowed.interaction);

    expect(allowed.start).toHaveBeenCalledOnce();

    const rejoined = await createHarness({ memberJoinedAt: "2026-09-09T12:00:00.000Z" });
    await rejoined.store.setRecordingPermissions("guild-1", {
      roleIds: [],
      userGrants: [{ memberJoinedAt: joinedAt, userId: "user-1" }],
    });

    await rejoined.listener(rejoined.interaction);

    expect(rejoined.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Você não possui um cargo autorizado para gravar." }),
    );
  });

  it("revoga a concessão individual quando o membro sai do servidor", async () => {
    const context = await createHarness();
    await context.store.setRecordingPermissions("guild-1", {
      roleIds: [],
      userGrants: [{ memberJoinedAt: "2026-09-08T12:00:00.000Z", userId: "departed-user" }],
    });

    await context.memberRemovedListener({ guild: { id: "guild-1" }, id: "departed-user" });

    await vi.waitFor(async () => {
      await expect(context.store.getRecordingPermissions("guild-1")).resolves.toEqual({
        roleIds: [],
        userGrants: [],
      });
    });
  });

  it("prioriza fórum não configurado para usuário autorizado fora da voz", async () => {
    const context = await createHarness({ administrator: true });

    await context.listener(context.interaction);

    expect(context.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("recording-summary-forum set") }),
    );
  });

  it("exige canal de voz convencional depois de validar autorização e fórum", async () => {
    const context = await createHarness({ administrator: true });
    await context.store.setSummaryForum("guild-1", { forumId: "forum-1" });

    await context.listener(context.interaction);

    expect(context.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Entre em um canal de voz antes de usar `/record`." }),
    );
  });

  it("inicia a voz do usuário em qualquer chat e preserva esse chat para avisos", async () => {
    const context = await createHarness({
      administrator: true,
      channelId: "thread-command",
      voiceChannel: { id: "voice-1", name: "Lobby", type: ChannelType.GuildVoice },
    });
    await context.store.setSummaryForum("guild-1", { forumId: "forum-1" });

    await context.listener(context.interaction);

    expect(context.start).toHaveBeenCalledWith({
      guildId: "guild-1",
      notificationChannelId: "thread-command",
      startedByUserId: "user-1",
      voiceChannelId: "voice-1",
      voiceChannelName: "Lobby",
    });
  });

  it("permite que o dono configure fórum e tag existentes", async () => {
    const forum = {
      availableTags: [{ id: "tag-1", name: "Reunião" }],
      flags: { has: vi.fn(() => false) },
      id: "forum-1",
      permissionsFor: vi.fn(() => ({ has: vi.fn(() => true) })),
      type: ChannelType.GuildForum,
    };
    const context = await createHarness({
      commandName: "recording-summary-forum",
      forum,
      guildOwner: true,
      memberRoleIds: ["role-1"],
      subcommand: "set",
      tag: "Reunião",
    });
    await context.store.setRecordingPermissions("guild-1", {
      roleIds: ["role-1"],
      userGrants: [],
    });

    await context.listener(context.interaction);

    await expect(context.store.getSummaryForum("guild-1")).resolves.toEqual({
      forumId: "forum-1",
      tagId: "tag-1",
    });
    expect(context.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("<#forum-1>") }),
    );
  });

  it("configura fórum sem tag e aceita a identificação exata da tag", async () => {
    const forumWithoutTag = {
      availableTags: [],
      flags: { has: vi.fn(() => false) },
      id: "forum-1",
      permissionsFor: vi.fn(() => ({ has: vi.fn(() => true) })),
      type: ChannelType.GuildForum,
    };
    const withoutTag = await createHarness({
      administrator: true,
      commandName: "recording-summary-forum",
      forum: forumWithoutTag,
    });
    await withoutTag.listener(withoutTag.interaction);
    await expect(withoutTag.store.getSummaryForum("guild-1")).resolves.toEqual({
      forumId: "forum-1",
    });
    expect(withoutTag.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Fórum de resumos configurado: <#forum-1>." }),
    );

    const forumWithTag = {
      ...forumWithoutTag,
      availableTags: [{ id: "tag-1", name: "Reunião" }],
    };
    const byId = await createHarness({
      administrator: true,
      commandName: "recording-summary-forum",
      forum: forumWithTag,
      tag: "tag-1",
    });
    await byId.listener(byId.interaction);
    await expect(byId.store.getSummaryForum("guild-1")).resolves.toEqual({
      forumId: "forum-1",
      tagId: "tag-1",
    });
  });

  it("rejeita fórum que exige tag quando nenhuma foi informada", async () => {
    const forum = {
      availableTags: [{ id: "tag-1", name: "Reunião" }],
      flags: { has: vi.fn((flag: ChannelFlags) => flag === ChannelFlags.RequireTag) },
      id: "forum-1",
      permissionsFor: vi.fn(() => ({ has: vi.fn(() => true) })),
      type: ChannelType.GuildForum,
    };
    const context = await createHarness({
      administrator: true,
      commandName: "recording-summary-forum",
      forum,
      subcommand: "set",
    });

    await context.listener(context.interaction);

    await expect(context.store.getSummaryForum("guild-1")).resolves.toBeUndefined();
    expect(context.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/exige.*tag/i) }),
    );
  });

  it("permite consultar e limpar a configuração", async () => {
    const show = await createHarness({
      administrator: true,
      commandName: "recording-summary-forum",
      subcommand: "show",
    });

    await show.listener(show.interaction);
    expect(show.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("Nenhum fórum") }),
    );

    const clear = await createHarness({
      administrator: true,
      commandName: "recording-summary-forum",
      subcommand: "clear",
    });
    await clear.store.setSummaryForum("guild-1", { forumId: "forum-1", tagId: "tag-1" });

    await clear.listener(clear.interaction);

    await expect(clear.store.getSummaryForum("guild-1")).resolves.toBeUndefined();
    expect(clear.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Reuniões ainda não publicadas"),
      }),
    );
  });

  it("mostra o fórum e a tag configurados", async () => {
    const context = await createHarness({
      manageGuild: true,
      commandName: "recording-summary-forum",
      subcommand: "show",
    });
    await context.store.setSummaryForum("guild-1", { forumId: "forum-1", tagId: "tag-1" });

    await context.listener(context.interaction);

    expect(context.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/<#forum-1>[\s\S]*tag-1/) }),
    );
  });

  it("mostra fórum configurado sem tag", async () => {
    const context = await createHarness({
      administrator: true,
      commandName: "recording-summary-forum",
      subcommand: "show",
    });
    await context.store.setSummaryForum("guild-1", { forumId: "forum-1" });

    await context.listener(context.interaction);

    expect(context.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Fórum de resumos: <#forum-1>" }),
    );
  });

  it("nega configuração sem autorização", async () => {
    const context = await createHarness({
      commandName: "recording-summary-forum",
      subcommand: "show",
    });

    await context.listener(context.interaction);

    expect(context.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Você não pode configurar o fórum de resumos." }),
    );
  });

  it("rejeita tag inexistente e permissões insuficientes", async () => {
    const forumWithoutPermission = {
      availableTags: [],
      flags: { has: vi.fn(() => false) },
      id: "forum-1",
      permissionsFor: vi.fn(() => ({ has: vi.fn(() => false) })),
      type: ChannelType.GuildForum,
    };
    const denied = await createHarness({
      administrator: true,
      commandName: "recording-summary-forum",
      forum: forumWithoutPermission,
      subcommand: "set",
    });

    await denied.listener(denied.interaction);
    expect(denied.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("permissões necessárias") }),
    );

    const forumWithoutTag = {
      ...forumWithoutPermission,
      permissionsFor: vi.fn(() => ({ has: vi.fn(() => true) })),
    };
    const invalidTag = await createHarness({
      administrator: true,
      commandName: "recording-summary-forum",
      forum: forumWithoutTag,
      subcommand: "set",
      tag: "Inexistente",
    });

    await invalidTag.listener(invalidTag.interaction);
    expect(invalidTag.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("tag informada não existe") }),
    );
  });

  it("rejeita canal incompatível e ausência do membro do bot", async () => {
    const invalidChannel = await createHarness({
      administrator: true,
      commandName: "recording-summary-forum",
      forum: { type: ChannelType.GuildText },
    });
    await invalidChannel.listener(invalidChannel.interaction);
    expect(invalidChannel.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Selecione um canal de fórum válido." }),
    );

    const unavailableBot = await createHarness({
      administrator: true,
      botMemberAvailable: false,
      commandName: "recording-summary-forum",
      forum: {
        availableTags: [],
        flags: { has: vi.fn(() => false) },
        id: "forum-1",
        type: ChannelType.GuildForum,
      },
    });
    await unavailableBot.listener(unavailableBot.interaction);
    expect(unavailableBot.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Não foi possível concluir o comando. Tente novamente.",
      }),
    );
  });

  it("trata conflito e falha inesperada ao iniciar gravação", async () => {
    const conflict = await createHarness({
      administrator: true,
      voiceChannel: { id: "voice-1", name: "Lobby", type: ChannelType.GuildVoice },
    });
    await conflict.store.setSummaryForum("guild-1", { forumId: "forum-1" });
    conflict.start.mockRejectedValueOnce(new RecordingAlreadyActiveError());

    await conflict.listener(conflict.interaction);
    expect(conflict.editReply).toHaveBeenCalledWith("Já existe uma gravação ativa neste servidor.");

    const failure = await createHarness({
      administrator: true,
      voiceChannel: { id: "voice-1", name: "Lobby", type: ChannelType.GuildVoice },
    });
    await failure.store.setSummaryForum("guild-1", { forumId: "forum-1" });
    failure.start.mockRejectedValueOnce(new Error("falha"));

    await failure.listener(failure.interaction);
    expect(failure.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Não foi possível concluir o comando. Tente novamente.",
      }),
    );
  });

  it("explica antes de gravar que faster-whisper exige checkpoint multilíngue", async () => {
    const context = await createHarness({
      administrator: true,
      voiceChannel: { id: "voice-1", name: "Lobby", type: ChannelType.GuildVoice },
    });
    await context.store.setSummaryForum("guild-1", { forumId: "forum-1" });
    context.start.mockRejectedValueOnce(new MultilingualCheckpointRequiredError());

    await context.listener(context.interaction);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.stringMatching(/somente um idioma.*checkpoint multilíngue.*detecção automática/i),
    );
  });

  it("distingue catálogo OpenRouter indisponível de modelo STT ausente", async () => {
    const unavailable = await createHarness({
      administrator: true,
      voiceChannel: { id: "voice-1", name: "Lobby", type: ChannelType.GuildVoice },
    });
    await unavailable.store.setSummaryForum("guild-1", { forumId: "forum-1" });
    unavailable.start.mockRejectedValueOnce(
      new OpenRouterModelPreflightError("catalog_unavailable", { httpStatus: 503 }),
    );

    await unavailable.listener(unavailable.interaction);

    expect(unavailable.editReply).toHaveBeenCalledWith(
      expect.stringMatching(/catálogo.*OpenRouter.*HTTP 503.*tente novamente/i),
    );

    const missing = await createHarness({
      administrator: true,
      voiceChannel: { id: "voice-1", name: "Lobby", type: ChannelType.GuildVoice },
    });
    await missing.store.setSummaryForum("guild-1", { forumId: "forum-1" });
    missing.start.mockRejectedValueOnce(
      new OpenRouterModelPreflightError("model_missing", { phase: "transcription" }),
    );

    await missing.listener(missing.interaction);

    expect(missing.editReply).toHaveBeenCalledWith(
      expect.stringMatching(/modelo de transcrição.*não foi encontrado.*OpenRouter/i),
    );
  });

  it("informa catálogo inválido e capacidade ausente na fase correta", async () => {
    const invalid = await createHarness({
      administrator: true,
      botLanguage: "en",
      voiceChannel: { id: "voice-1", name: "Lobby", type: ChannelType.GuildVoice },
    });
    await invalid.store.setSummaryForum("guild-1", { forumId: "forum-1" });
    invalid.start.mockRejectedValueOnce(new OpenRouterModelPreflightError("catalog_invalid"));

    await invalid.listener(invalid.interaction);

    expect(invalid.editReply).toHaveBeenCalledWith(
      expect.stringMatching(/OpenRouter model catalog returned invalid data/i),
    );

    const incompatible = await createHarness({
      administrator: true,
      voiceChannel: { id: "voice-1", name: "Lobby", type: ChannelType.GuildVoice },
    });
    await incompatible.store.setSummaryForum("guild-1", { forumId: "forum-1" });
    incompatible.start.mockRejectedValueOnce(
      new OpenRouterModelPreflightError("capability_missing", { phase: "summary" }),
    );

    await incompatible.listener(incompatible.interaction);

    expect(incompatible.editReply).toHaveBeenCalledWith(
      expect.stringMatching(/modelo de resumo.*capacidades exigidas/i),
    );
  });

  it("confirma o início de uma gravação bem-sucedida", async () => {
    const context = await createHarness({
      administrator: true,
      voiceChannel: { id: "voice-1", name: "Lobby", type: ChannelType.GuildVoice },
    });
    await context.store.setSummaryForum("guild-1", { forumId: "forum-1" });

    await context.listener(context.interaction);

    expect(context.deferReply).toHaveBeenCalledOnce();
    expect(context.editReply).toHaveBeenCalledWith(
      expect.stringMatching(/Gravação iniciada.*Lobby.*meeting-1/),
    );
  });

  it("edita uma interação já respondida ao tratar uma rejeição não Error", async () => {
    const context = await createHarness({
      administrator: true,
      deferred: true,
      voiceChannel: { id: "voice-1", name: "Lobby", type: ChannelType.GuildVoice },
    });
    await context.store.setSummaryForum("guild-1", { forumId: "forum-1" });
    context.start.mockRejectedValueOnce("falha externa");

    await context.listener(context.interaction);

    expect(context.editReply).toHaveBeenLastCalledWith(
      "Não foi possível concluir o comando. Tente novamente.",
    );
  });

  it("valida ausência, canal e autorização antes de encerrar", async () => {
    const absent = await createHarness({ administrator: true, commandName: "stop" });
    await absent.listener(absent.interaction);
    expect(absent.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Não existe uma gravação ativa neste servidor." }),
    );

    const wrongChannel = await createHarness({
      administrator: true,
      commandName: "stop",
      voiceChannel: { id: "voice-2", name: "Outro", type: ChannelType.GuildVoice },
    });
    wrongChannel.get.mockReturnValue({ voiceChannelId: "voice-1" });
    await wrongChannel.listener(wrongChannel.interaction);
    expect(wrongChannel.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("canal que está sendo gravado") }),
    );

    const unauthorized = await createHarness({
      commandName: "stop",
      voiceChannel: { id: "voice-1", name: "Lobby", type: ChannelType.GuildVoice },
    });
    unauthorized.get.mockReturnValue({ voiceChannelId: "voice-1" });
    await unauthorized.listener(unauthorized.interaction);
    expect(unauthorized.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Você não possui um cargo autorizado para encerrar." }),
    );
  });

  it("encerra uma gravação autorizada", async () => {
    const context = await createHarness({
      administrator: true,
      commandName: "stop",
      voiceChannel: { id: "voice-1", name: "Lobby", type: ChannelType.GuildVoice },
    });
    context.get.mockReturnValue({
      notificationChannelId: "record-command-chat",
      voiceChannelId: "voice-1",
    });

    await context.listener(context.interaction);

    expect(context.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(context.stop).toHaveBeenCalledWith("guild-1", {
      reason: "command",
      stoppedByUserId: "user-1",
    });
    expect(context.editReply).toHaveBeenCalledWith(
      "✅ Comando processado. A gravação foi encerrada em <#record-command-chat>.",
    );
  });

  it("adiciona, lista e remove cargos de gravação", async () => {
    const add = await createHarness({
      manageGuild: true,
      commandName: "recording-role",
      subcommand: "add",
    });
    await add.listener(add.interaction);
    await expect(add.store.getRecordingPermissions("guild-1")).resolves.toMatchObject({
      roleIds: ["role-option"],
    });

    const list = await createHarness({
      administrator: true,
      commandName: "recording-role",
      subcommand: "list",
    });
    await list.store.setRecordingPermissions("guild-1", {
      roleIds: ["role-option"],
      userGrants: [],
    });
    await list.listener(list.interaction);
    expect(list.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("<@&role-option>") }),
    );

    const remove = await createHarness({
      administrator: true,
      commandName: "recording-role",
      subcommand: "remove",
    });
    await remove.store.setRecordingPermissions("guild-1", {
      roleIds: ["role-option"],
      userGrants: [],
    });
    await remove.listener(remove.interaction);
    await expect(remove.store.getRecordingPermissions("guild-1")).resolves.toMatchObject({
      roleIds: [],
    });
  });

  it("nega gestão de cargos e informa quando a lista está vazia", async () => {
    const denied = await createHarness({ commandName: "recording-role", subcommand: "add" });
    await denied.listener(denied.interaction);
    expect(denied.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Você não pode configurar os cargos de gravação." }),
    );

    const empty = await createHarness({
      administrator: true,
      commandName: "recording-role",
      subcommand: "list",
    });
    await empty.listener(empty.interaction);
    expect(empty.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("Nenhum cargo foi autorizado") }),
    );
  });

  it("não concede gestão ao administrador que não é dono do servidor", async () => {
    const roles = await createHarness({
      administrator: true,
      commandName: "recording-role",
      guildOwner: false,
      subcommand: "add",
    });
    await roles.listener(roles.interaction);
    expect(roles.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Você não pode configurar os cargos de gravação." }),
    );

    const costs = await createHarness({
      administrator: true,
      commandName: "recording-cost",
      guildOwner: false,
      subcommand: "meeting",
    });
    await costs.listener(costs.interaction);
    expect(costs.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Somente o dono do servidor pode consultar custos de gravações.",
      }),
    );
    expect(costs.costReport.meeting).not.toHaveBeenCalled();
  });

  it("não inicia gravação enquanto o perfil ativo estiver incompleto", async () => {
    const context = await createHarness({
      guildOwner: true,
      profileComplete: false,
      voiceChannel: { id: "voice-1", name: "Lobby", type: ChannelType.GuildVoice },
    });
    await context.store.setSummaryForum("guild-1", { forumId: "forum-1" });

    await context.listener(context.interaction);

    expect(context.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("perfil de processamento ativo"),
      }),
    );
    expect(context.start).not.toHaveBeenCalled();
  });

  it("não inicia perfil OpenRouter sem a chave da API", async () => {
    const context = await createHarness({
      guildOwner: true,
      openRouterProfile: true,
      voiceChannel: { id: "voice-1", name: "Lobby", type: ChannelType.GuildVoice },
    });
    await context.store.setSummaryForum("guild-1", { forumId: "forum-1" });

    await context.listener(context.interaction);

    expect(context.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("dashboard") }),
    );
    expect(context.start).not.toHaveBeenCalled();
  });

  it("inicia perfil OpenRouter completo quando a chave está configurada", async () => {
    const context = await createHarness({
      guildOwner: true,
      openRouterConfigured: true,
      openRouterProfile: true,
      voiceChannel: { id: "voice-1", name: "Lobby", type: ChannelType.GuildVoice },
    });
    await context.store.setSummaryForum("guild-1", { forumId: "forum-1" });

    await context.listener(context.interaction);

    expect(context.start).toHaveBeenCalledOnce();
  });

  it("consulta assincronamente a chave atual antes de iniciar o OpenRouter", async () => {
    const resolveOpenRouterConfiguration = vi.fn(async () => true);
    const context = await createHarness({
      guildOwner: true,
      openRouterConfigured: resolveOpenRouterConfiguration,
      openRouterProfile: true,
      voiceChannel: { id: "voice-1", name: "Lobby", type: ChannelType.GuildVoice },
    });
    await context.store.setSummaryForum("guild-1", { forumId: "forum-1" });

    await context.listener(context.interaction);

    expect(resolveOpenRouterConfiguration).toHaveBeenCalledOnce();
    expect(context.start).toHaveBeenCalledOnce();
  });

  it("bloqueia o OpenRouter quando a consulta atual da chave resolve como ausente", async () => {
    const context = await createHarness({
      guildOwner: true,
      openRouterConfigured: async () => false,
      openRouterProfile: true,
      voiceChannel: { id: "voice-1", name: "Lobby", type: ChannelType.GuildVoice },
    });
    await context.store.setSummaryForum("guild-1", { forumId: "forum-1" });

    await context.listener(context.interaction);

    expect(context.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("dashboard") }),
    );
    expect(context.start).not.toHaveBeenCalled();
  });

  it("bloqueia modelo incompatível e apenas avisa sobre modelo acima da recomendação", async () => {
    const incompatible = await createHarness({
      compatibility: ["incompatible"],
      guildOwner: true,
      voiceChannel: { id: "voice-1", name: "Lobby", type: ChannelType.GuildVoice },
    });
    await incompatible.store.setSummaryForum("guild-1", { forumId: "forum-1" });
    await incompatible.listener(incompatible.interaction);
    expect(incompatible.start).not.toHaveBeenCalled();

    const warning = await createHarness({
      compatibility: ["above_recommended"],
      guildOwner: true,
      voiceChannel: { id: "voice-1", name: "Lobby", type: ChannelType.GuildVoice },
    });
    await warning.store.setSummaryForum("guild-1", { forumId: "forum-1" });
    await warning.listener(warning.interaction);
    expect(warning.start).toHaveBeenCalledOnce();
    expect(warning.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("acima da capacidade recomendada"),
        flags: MessageFlags.Ephemeral,
      }),
    );

    const unknown = await createHarness({
      compatibility: ["unknown"],
      guildOwner: true,
      voiceChannel: { id: "voice-1", name: "Lobby", type: ChannelType.GuildVoice },
    });
    await unknown.store.setSummaryForum("guild-1", { forumId: "forum-1" });
    await unknown.listener(unknown.interaction);
    expect(unknown.start).toHaveBeenCalledOnce();
    expect(unknown.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("dados suficientes") }),
    );
  });
});
