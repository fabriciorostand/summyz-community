import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ChannelFlags,
  ChannelType,
  type Client,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { installInteractionHandler } from "../src/discord/interaction-handler.js";
import { GuildConfigStore } from "../src/guild-config-store.js";
import { createLogger } from "../src/logger.js";
import type { RecordingCoordinator } from "../src/recording/recording-coordinator.js";
import { RecordingAlreadyActiveError } from "../src/recording/recording-coordinator.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

interface InteractionOptions {
  administrator?: boolean;
  botLanguage?: "en" | "pt-br";
  botMemberAvailable?: boolean;
  channelId?: string;
  chatInput?: boolean;
  commandName?: string;
  deferred?: boolean;
  forum?: object;
  guildAvailable?: boolean;
  guildId?: string | null;
  manageGuild?: boolean;
  memberRoleIds?: string[];
  replied?: boolean;
  subcommand?: string;
  tag?: string;
  voiceChannel?: { id: string; name: string; type: ChannelType };
}

async function createHarness(options: InteractionOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), "summyz-interaction-"));
  directories.push(directory);
  const store = new GuildConfigStore(join(directory, "guilds.json"));
  const start = vi.fn(async () => ({ meetingId: "meeting-1" }));
  const get = vi.fn();
  const stop = vi.fn(async () => true);
  const coordinator = {
    get,
    start,
    stop,
  } as unknown as RecordingCoordinator;
  let listener: ((interaction: unknown) => Promise<void>) | undefined;
  const client = {
    on: vi.fn((_event: string, received: (interaction: unknown) => Promise<void>) => {
      listener = received;
    }),
  } as unknown as Client;
  installInteractionHandler(
    client,
    store,
    coordinator,
    createLogger("silent"),
    options.botLanguage ?? "pt-br",
  );

  const reply = vi.fn(async () => undefined);
  const editReply = vi.fn(async () => undefined);
  const deferReply = vi.fn(async () => undefined);
  const member = {
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
    guild,
    guildId: options.guildId === undefined ? "guild-1" : options.guildId,
    isChatInputCommand: () => options.chatInput ?? true,
    options: {
      getChannel: vi.fn(() => options.forum),
      getRole: vi.fn(() => ({ id: "role-option", toString: () => "<@&role-option>" })),
      getString: vi.fn(() => options.tag),
      getSubcommand: vi.fn(() => options.subcommand ?? "set"),
    },
    replied: options.replied ?? false,
    reply,
    user: { id: "user-1", toString: () => "<@user-1>" },
  };

  if (listener === undefined) {
    throw new Error("O handler de interações não foi instalado");
  }
  return { deferReply, editReply, get, interaction, listener, reply, start, stop, store };
}

describe("fluxo de comandos do Discord", () => {
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
      voiceChannelId: "voice-1",
      voiceChannelName: "Lobby",
    });
  });

  it("permite que cargo de gravação configure fórum e tag existentes", async () => {
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
      memberRoleIds: ["role-1"],
      subcommand: "set",
      tag: "Reunião",
    });
    await context.store.addRecordingRole("guild-1", "role-1");

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
    await expect(add.store.listRecordingRoles("guild-1")).resolves.toEqual(["role-option"]);

    const list = await createHarness({
      administrator: true,
      commandName: "recording-role",
      subcommand: "list",
    });
    await list.store.addRecordingRole("guild-1", "role-option");
    await list.listener(list.interaction);
    expect(list.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("<@&role-option>") }),
    );

    const remove = await createHarness({
      administrator: true,
      commandName: "recording-role",
      subcommand: "remove",
    });
    await remove.store.addRecordingRole("guild-1", "role-option");
    await remove.listener(remove.interaction);
    await expect(remove.store.listRecordingRoles("guild-1")).resolves.toEqual([]);
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
});
