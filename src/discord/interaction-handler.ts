import {
  ChannelType,
  type ChatInputCommandInteraction,
  Events,
  type GuildMember,
  PermissionFlagsBits,
  type Client,
} from "discord.js";
import type { Logger } from "pino";

import { canManageRecordingRoles, canRecord } from "../authorization.js";
import type { GuildConfigStore } from "../guild-config-store.js";
import {
  RecordingAlreadyActiveError,
  type RecordingCoordinator,
} from "../recording/recording-coordinator.js";
import { createEphemeralReply } from "./responses.js";

export function installInteractionHandler(
  client: Client,
  guildConfigStore: GuildConfigStore,
  coordinator: RecordingCoordinator,
  logger: Logger,
): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    try {
      if (interaction.commandName === "recording-role") {
        await handleRecordingRole(interaction, guildConfigStore);
      } else if (interaction.commandName === "record") {
        await handleRecord(interaction, guildConfigStore, coordinator);
      } else if (interaction.commandName === "stop") {
        await handleStop(interaction, guildConfigStore, coordinator);
      }
    } catch (error) {
      logger.error(
        { commandName: interaction.commandName, errorType: getErrorType(error) },
        "Falha ao executar comando",
      );
      await sendError(interaction, "Não foi possível concluir o comando. Tente novamente.");
    }
  });
}

async function handleRecordingRole(
  interaction: ChatInputCommandInteraction,
  store: GuildConfigStore,
): Promise<void> {
  const context = await resolveGuildContext(interaction);
  if (context === undefined) {
    return;
  }
  if (
    !canManageRecordingRoles({
      canManageGuild: context.member.permissions.has(PermissionFlagsBits.ManageGuild),
      isAdministrator: context.member.permissions.has(PermissionFlagsBits.Administrator),
    })
  ) {
    await interaction.reply(
      createEphemeralReply("Você não pode configurar os cargos de gravação."),
    );
    return;
  }

  const subcommand = interaction.options.getSubcommand(true);
  if (subcommand === "list") {
    const roleIds = await store.listRecordingRoles(context.guildId);
    const content =
      roleIds.length === 0
        ? "Nenhum cargo foi autorizado. Apenas administradores podem controlar gravações."
        : `Cargos autorizados:\n${roleIds.map((roleId) => `- <@&${roleId}>`).join("\n")}`;
    await interaction.reply(createEphemeralReply(content));
    return;
  }

  const role = interaction.options.getRole("role", true);
  if (subcommand === "add") {
    await store.addRecordingRole(context.guildId, role.id);
    await interaction.reply(createEphemeralReply(`${role} agora pode controlar gravações.`));
    return;
  }

  await store.removeRecordingRole(context.guildId, role.id);
  await interaction.reply(createEphemeralReply(`${role} não pode mais controlar gravações.`));
}

async function handleRecord(
  interaction: ChatInputCommandInteraction,
  store: GuildConfigStore,
  coordinator: RecordingCoordinator,
): Promise<void> {
  const context = await resolveGuildContext(interaction);
  if (context === undefined) {
    return;
  }
  const voiceChannel = context.member.voice.channel;
  if (voiceChannel?.type !== ChannelType.GuildVoice) {
    await interaction.reply(
      createEphemeralReply("Entre em um canal de voz antes de usar `/record`."),
    );
    return;
  }
  if (!(await isRecordingAuthorized(context.member, context.guildId, store))) {
    await interaction.reply(
      createEphemeralReply("Você não possui um cargo autorizado para gravar."),
    );
    return;
  }

  await interaction.deferReply();
  try {
    const handle = await coordinator.start({
      guildId: context.guildId,
      notificationChannelId: interaction.channelId,
      voiceChannelId: voiceChannel.id,
    });
    await interaction.editReply(
      `🔴 Gravação iniciada em **${voiceChannel.name}** por ${interaction.user}. ` +
        `O áudio dos participantes será gravado. ID: \`${handle.meetingId}\``,
    );
  } catch (error) {
    if (error instanceof RecordingAlreadyActiveError) {
      await interaction.editReply("Já existe uma gravação ativa neste servidor.");
      return;
    }
    throw error;
  }
}

async function handleStop(
  interaction: ChatInputCommandInteraction,
  store: GuildConfigStore,
  coordinator: RecordingCoordinator,
): Promise<void> {
  const context = await resolveGuildContext(interaction);
  if (context === undefined) {
    return;
  }
  const activeRecording = coordinator.get(context.guildId);
  if (activeRecording === undefined) {
    await interaction.reply(createEphemeralReply("Não existe uma gravação ativa neste servidor."));
    return;
  }
  if (context.member.voice.channelId !== activeRecording.voiceChannelId) {
    await interaction.reply(
      createEphemeralReply("Você precisa estar no canal que está sendo gravado para usar `/stop`."),
    );
    return;
  }
  if (!(await isRecordingAuthorized(context.member, context.guildId, store))) {
    await interaction.reply(
      createEphemeralReply("Você não possui um cargo autorizado para encerrar."),
    );
    return;
  }

  await interaction.deferReply();
  await coordinator.stop(context.guildId, "command");
  await interaction.editReply("⏹️ Gravação encerrada. Os segmentos de áudio foram preservados.");
}

async function resolveGuildContext(interaction: ChatInputCommandInteraction) {
  if (interaction.guild === null || interaction.guildId === null) {
    await interaction.reply(createEphemeralReply("Este comando só pode ser usado em um servidor."));
    return undefined;
  }
  const member = await interaction.guild.members.fetch(interaction.user.id);
  return { guildId: interaction.guildId, member };
}

async function isRecordingAuthorized(
  member: GuildMember,
  guildId: string,
  store: GuildConfigStore,
): Promise<boolean> {
  return canRecord({
    isAdministrator: member.permissions.has(PermissionFlagsBits.Administrator),
    memberRoleIds: [...member.roles.cache.keys()],
    recordingRoleIds: await store.listRecordingRoles(guildId),
  });
}

async function sendError(interaction: ChatInputCommandInteraction, message: string): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(message).catch(() => undefined);
  } else {
    await interaction.reply(createEphemeralReply(message)).catch(() => undefined);
  }
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
