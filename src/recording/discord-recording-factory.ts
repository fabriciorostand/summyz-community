import { randomUUID } from "node:crypto";

import { entersState, joinVoiceChannel, VoiceConnectionStatus } from "@discordjs/voice";
import { ChannelType, type Client, type VoiceChannel } from "discord.js";
import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import type { GuildSettings } from "../guild-config-store.js";
import { DiscordVoiceRecording } from "./discord-voice-recording.js";
import {
  addParticipant,
  createManifest,
  markManifestInterrupted,
  markManifestRecording,
  type RecordingManifest,
  type ResolvedMeetingAiConfiguration,
} from "./manifest.js";
import type { ManifestStore } from "./manifest-store.js";
import type {
  RecordingHandle,
  RecordingSessionFactory,
  StartRecordingInput,
} from "./recording-coordinator.js";
import { getRecordingText } from "./recording-notification.js";
import { countHumans, getErrorType } from "./recording-utils.js";
import { finalizeInterruptedRecovery } from "./recovery.js";

export class DiscordRecordingFactory implements RecordingSessionFactory {
  readonly #client: Client;
  readonly #config: AppConfig;
  readonly #logger: Logger;
  readonly #manifestStore: ManifestStore;
  readonly #onCompleted: ((manifest: RecordingManifest) => Promise<void>) | undefined;
  readonly #resolveMeetingAiConfiguration:
    | ((guildId: string) => Promise<ResolvedMeetingAiConfiguration>)
    | undefined;
  readonly #resolveGuildSettings: ((guildId: string) => Promise<GuildSettings>) | undefined;

  public constructor(
    client: Client,
    config: AppConfig,
    manifestStore: ManifestStore,
    logger: Logger,
    onCompleted?: (manifest: RecordingManifest) => Promise<void>,
    resolveMeetingAiConfiguration?: (guildId: string) => Promise<ResolvedMeetingAiConfiguration>,
    resolveGuildSettings?: (guildId: string) => Promise<GuildSettings>,
  ) {
    this.#client = client;
    this.#config = config;
    this.#manifestStore = manifestStore;
    this.#logger = logger;
    this.#resolveMeetingAiConfiguration = resolveMeetingAiConfiguration;
    this.#onCompleted = onCompleted;
    this.#resolveGuildSettings = resolveGuildSettings;
  }

  public async create(input: StartRecordingInput, onEnded?: () => void): Promise<RecordingHandle> {
    const aiConfiguration = await this.#resolveMeetingAiConfiguration?.(input.guildId);
    const guildSettings = (await this.#resolveGuildSettings?.(input.guildId)) ?? {
      botLanguage: this.#config.botLanguage,
      persistMeetingAudio: this.#config.persistMeetingAudio,
      persistMeetingContent: this.#config.persistMeetingContent,
    };
    const manifest = createManifest({
      ...(aiConfiguration === undefined ? {} : { aiConfiguration }),
      botLanguage: guildSettings.botLanguage,
      guildId: input.guildId,
      meetingId: randomUUID(),
      notificationChannelId: input.notificationChannelId,
      persistMeetingAudio: guildSettings.persistMeetingAudio,
      persistMeetingContent: guildSettings.persistMeetingContent,
      startedAt: new Date().toISOString(),
      startedByUserId: input.startedByUserId,
      storageMode: "postgres",
      voiceChannelId: input.voiceChannelId,
      voiceChannelName: input.voiceChannelName,
    });
    await this.#manifestStore.save(manifest);

    try {
      return await this.#open(manifest, onEnded);
    } catch (error) {
      const interrupted = markManifestInterrupted(
        manifest,
        new Date().toISOString(),
        "voice_join_failed",
      );
      await this.#manifestStore.save(interrupted);
      await this.#notify(
        manifest.notificationChannelId,
        getRecordingText(manifest.botLanguage ?? this.#config.botLanguage).startFailed,
      );
      throw error;
    }
  }

  public async resume(
    manifest: RecordingManifest,
    onEnded?: () => void,
  ): Promise<RecordingHandle | undefined> {
    const voiceChannel = await this.#resolveVoiceChannel(manifest.guildId, manifest.voiceChannelId);
    if (countHumans(voiceChannel) === 0) {
      const completed = finalizeInterruptedRecovery(manifest, new Date().toISOString());
      await this.#manifestStore.save(completed);
      await this.#enqueueCompleted(completed);
      await this.#notify(
        manifest.notificationChannelId,
        getRecordingText(manifest.botLanguage ?? this.#config.botLanguage).emptyAfterRestart,
      );
      return undefined;
    }

    let recoverableManifest = manifest;
    if (recoverableManifest.status === "recording") {
      recoverableManifest = markManifestInterrupted(
        recoverableManifest,
        new Date().toISOString(),
        "process_restart",
      );
      await this.#manifestStore.save(recoverableManifest);
    }

    await this.#notify(
      manifest.notificationChannelId,
      getRecordingText(manifest.botLanguage ?? this.#config.botLanguage).resumingAfterRestart,
    );

    try {
      const handle = await this.#open(recoverableManifest, onEnded, voiceChannel);
      await this.#notify(
        manifest.notificationChannelId,
        getRecordingText(manifest.botLanguage ?? this.#config.botLanguage).resumed,
      );
      return handle;
    } catch (error) {
      this.#logger.error(
        {
          errorType: getErrorType(error),
          guildId: manifest.guildId,
          meetingId: manifest.meetingId,
        },
        "Failed to resume recording after restart",
      );
      await this.#notify(
        manifest.notificationChannelId,
        getRecordingText(manifest.botLanguage ?? this.#config.botLanguage).resumeFailed,
      );
      return undefined;
    }
  }

  async #open(
    manifest: RecordingManifest,
    onEnded?: () => void,
    resolvedVoiceChannel?: VoiceChannel,
  ): Promise<RecordingHandle> {
    const voiceChannel =
      resolvedVoiceChannel ??
      (await this.#resolveVoiceChannel(manifest.guildId, manifest.voiceChannelId));
    const connection = joinVoiceChannel({
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      selfDeaf: false,
      selfMute: true,
    });
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);

    let readyManifest =
      manifest.status === "interrupted"
        ? markManifestRecording(manifest, new Date().toISOString())
        : manifest;
    for (const member of voiceChannel.members.values()) {
      if (!member.user.bot) {
        readyManifest = addParticipant(readyManifest, {
          displayName: member.displayName,
          userId: member.id,
        });
      }
    }
    await this.#manifestStore.save(readyManifest);

    const recording = new DiscordVoiceRecording({
      config: this.#config,
      connection,
      guild: voiceChannel.guild,
      logger: this.#logger,
      manifest: readyManifest,
      manifestStore: this.#manifestStore,
      notify: (message) => this.#notify(readyManifest.notificationChannelId, message),
      ...(this.#onCompleted === undefined ? {} : { onCompleted: this.#onCompleted }),
      ...(onEnded === undefined ? {} : { onEnded }),
    });
    recording.start();
    return recording;
  }

  async #resolveVoiceChannel(guildId: string, channelId: string): Promise<VoiceChannel> {
    const guild = await this.#client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);
    if (channel?.type !== ChannelType.GuildVoice) {
      throw new Error("O canal de voz da gravação não está disponível");
    }
    return channel;
  }

  async #notify(channelId: string, message: string): Promise<void> {
    try {
      const channel = await this.#client.channels.fetch(channelId);
      if (channel?.isSendable()) {
        await channel.send({ allowedMentions: { parse: [] }, content: message });
      }
    } catch (error) {
      this.#logger.warn(
        { channelId, errorType: getErrorType(error) },
        "Unable to send recording notification",
      );
    }
  }

  async #enqueueCompleted(manifest: RecordingManifest): Promise<void> {
    if (this.#onCompleted === undefined) return;
    try {
      await this.#onCompleted(manifest);
    } catch (error) {
      this.#logger.error(
        { errorType: getErrorType(error), meetingId: manifest.meetingId },
        "Failed to enqueue completed meeting",
      );
    }
  }
}
