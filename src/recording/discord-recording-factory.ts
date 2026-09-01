import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";

import {
  EndBehaviorType,
  type AudioReceiveStream,
  type VoiceConnection,
  type VoiceConnectionState,
  VoiceConnectionStatus,
  entersState,
  joinVoiceChannel,
} from "@discordjs/voice";
import { ChannelType, type Client, type Guild, type VoiceChannel } from "discord.js";
import type { Logger } from "pino";
import { opus } from "prism-media";

import type { AppConfig } from "../config.js";
import type { GuildSettings } from "../guild-config-store.js";
import { convertPcmToOgg } from "./audio-converter.js";
import {
  addSegment,
  addParticipant,
  createManifest,
  markManifestInterrupted,
  markManifestRecording,
  markManifestCompleted,
  type RecordingManifest,
  type RecordingSegment,
  type ResolvedMeetingAiConfiguration,
} from "./manifest.js";
import type { ManifestStore } from "./manifest-store.js";
import {
  createRecordingStopNotification,
  getRecordingText,
  type RecordingText,
} from "./recording-notification.js";
import { finalizeInterruptedRecovery } from "./recovery.js";
import { calculateProcessCpuPercent, estimatePacketLossPercent } from "./recording-metrics.js";
import {
  shouldStartTranscription,
  type RecordingHandle,
  type RecordingSessionFactory,
  type RecordingStopRequest,
  type StartRecordingInput,
} from "./recording-coordinator.js";

interface ActiveCapture {
  promise: Promise<void>;
  stop(): void;
}

type CaptureEndReason = "error" | "max_duration" | "silence" | "stopped";

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

interface DiscordVoiceRecordingInput {
  config: AppConfig;
  connection: VoiceConnection;
  guild: Guild;
  logger: Logger;
  manifest: RecordingManifest;
  manifestStore: ManifestStore;
  notify(message: string): Promise<void>;
  onCompleted?: (manifest: RecordingManifest) => Promise<void>;
  onEnded?: () => void;
}

class DiscordVoiceRecording implements RecordingHandle {
  readonly guildId: string;
  readonly meetingId: string;
  readonly notificationChannelId: string;
  readonly voiceChannelId: string;
  readonly #activeCaptures = new Map<string, ActiveCapture>();
  readonly #config: AppConfig;
  readonly #connection: VoiceConnection;
  readonly #guild: Guild;
  readonly #logger: Logger;
  readonly #manifestStore: ManifestStore;
  readonly #notify: (message: string) => Promise<void>;
  readonly #onCompleted: ((manifest: RecordingManifest) => Promise<void>) | undefined;
  readonly #onEnded: (() => void) | undefined;
  readonly #text: RecordingText;
  #ended = false;
  #manifest: RecordingManifest;
  #manifestQueue: Promise<void> = Promise.resolve();
  #metricsTimer: NodeJS.Timeout | undefined;
  #recovering = false;
  readonly #startedCpuUsage = process.cpuUsage();
  readonly #startedAtNs = process.hrtime.bigint();
  #stopPromise?: Promise<void>;

  public constructor(input: DiscordVoiceRecordingInput) {
    this.guildId = input.manifest.guildId;
    this.meetingId = input.manifest.meetingId;
    this.notificationChannelId = input.manifest.notificationChannelId;
    this.voiceChannelId = input.manifest.voiceChannelId;
    this.#config = input.config;
    this.#connection = input.connection;
    this.#guild = input.guild;
    this.#logger = input.logger;
    this.#manifest = input.manifest;
    this.#manifestStore = input.manifestStore;
    this.#notify = input.notify;
    this.#onCompleted = input.onCompleted;
    this.#onEnded = input.onEnded;
    this.#text = getRecordingText(input.manifest.botLanguage ?? input.config.botLanguage);
  }

  public start(): void {
    this.#connection.receiver.speaking.on("start", this.#handleSpeakingStart);
    this.#connection.on("stateChange", this.#handleConnectionStateChange);
    this.#metricsTimer = setInterval(() => {
      this.#logger.info(
        {
          activeCaptures: this.#activeCaptures.size,
          guildId: this.guildId,
          meetingId: this.meetingId,
          ...this.#performanceMetrics(),
        },
        "Recording metrics",
      );
    }, 10_000);
    this.#metricsTimer.unref();
    this.#logger.info(
      { guildId: this.guildId, meetingId: this.meetingId, voiceChannelId: this.voiceChannelId },
      "Recording started",
    );
  }

  public async stop(request: RecordingStopRequest): Promise<void> {
    this.#stopPromise ??= this.#stop(request);
    await this.#stopPromise;
  }

  public async recordParticipant(userId: string, displayName: string): Promise<void> {
    if (this.#ended) return;
    await this.#updateManifest((manifest) => addParticipant(manifest, { displayName, userId }));
  }

  readonly #handleSpeakingStart = (userId: string): void => {
    void this.#startCapture(userId);
  };

  readonly #handleConnectionStateChange = (
    _oldState: VoiceConnectionState,
    newState: VoiceConnectionState,
  ): void => {
    if (newState.status === VoiceConnectionStatus.Disconnected && !this.#ended) {
      void this.#recoverConnection("voice_disconnected");
    }
  };

  async #startCapture(userId: string): Promise<void> {
    if (this.#ended || this.#recovering || this.#activeCaptures.has(userId)) {
      return;
    }

    const member = await this.#guild.members.fetch(userId).catch(() => undefined);
    if (member === undefined || member.user.bot || this.#ended) {
      return;
    }

    await this.recordParticipant(member.id, member.displayName);
    const capture = this.#createCapture(userId, member.displayName);
    this.#activeCaptures.set(userId, capture);
    void capture.promise.finally(() => {
      if (this.#activeCaptures.get(userId) === capture) {
        this.#activeCaptures.delete(userId);
      }
    });
  }

  #createCapture(userId: string, displayName: string): ActiveCapture {
    const segmentId = randomUUID();
    const startedAtMs = Math.max(0, Date.now() - Date.parse(this.#manifest.startedAt));
    const paths = this.#manifestStore.segmentPaths(this.meetingId, userId, segmentId);
    const opusStream = this.#connection.receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: this.#config.segmentSilenceMs,
      },
    });
    let forcedReason: CaptureEndReason | undefined;
    const maximumTimer = setTimeout(() => {
      forcedReason = "max_duration";
      opusStream.destroy();
    }, this.#config.segmentMaxSeconds * 1_000);

    const promise = this.#capture({
      displayName,
      opusStream,
      paths,
      segmentId,
      startedAtMs,
      userId,
      getForcedReason: () => forcedReason,
    }).then(async (reason) => {
      clearTimeout(maximumTimer);
      if (
        reason === "max_duration" &&
        !this.#ended &&
        !this.#recovering &&
        this.#connection.receiver.speaking.users.has(userId)
      ) {
        this.#activeCaptures.delete(userId);
        await this.#startCapture(userId);
      }
    });

    return {
      promise,
      stop: () => {
        forcedReason = "stopped";
        opusStream.destroy();
      },
    };
  }

  async #capture(input: {
    displayName: string;
    getForcedReason(): CaptureEndReason | undefined;
    opusStream: AudioReceiveStream;
    paths: ReturnType<ManifestStore["segmentPaths"]>;
    segmentId: string;
    startedAtMs: number;
    userId: string;
  }): Promise<CaptureEndReason> {
    await this.#manifestStore.prepareSegmentDirectory(this.meetingId, input.userId);
    const decoder = new opus.Decoder({ channels: 2, frameSize: 960, rate: 48_000 });
    const output = createWriteStream(input.paths.temporaryPath, { flags: "wx" });
    let receivedOpusPackets = 0;
    let streamFailed = false;
    input.opusStream.on("data", () => {
      receivedOpusPackets += 1;
    });

    try {
      await pipeline(input.opusStream, decoder, output);
    } catch (error) {
      if (input.getForcedReason() === undefined) {
        streamFailed = true;
        this.#logger.error(
          {
            errorType: getErrorType(error),
            guildId: this.guildId,
            meetingId: this.meetingId,
            userId: input.userId,
          },
          "Audio segment capture failed",
        );
      }
    }

    const fileSize = await stat(input.paths.temporaryPath)
      .then((file) => file.size)
      .catch(() => 0);
    if (fileSize === 0) {
      await rm(input.paths.temporaryPath, { force: true });
      if (streamFailed) {
        void this.#recoverConnection("audio_receive_error");
        return "error";
      }
      return input.getForcedReason() ?? "silence";
    }

    const endedAtMs = Math.max(
      input.startedAtMs,
      Date.now() - Date.parse(this.#manifest.startedAt),
    );
    const durationMs = endedAtMs - input.startedAtMs;
    const captureEndReason = input.getForcedReason() ?? (streamFailed ? "error" : "silence");
    const estimatedPacketLossPercent = estimatePacketLossPercent({
      durationMs,
      receivedPackets: receivedOpusPackets,
      trailingSilenceMs: captureEndReason === "silence" ? this.#config.segmentSilenceMs : 0,
    });
    let segment: RecordingSegment;
    try {
      await convertPcmToOgg(input.paths.temporaryPath, input.paths.finalPath);
      await rm(input.paths.temporaryPath, { force: true });
      segment = {
        durationMs,
        endedAtMs,
        estimatedPacketLossPercent,
        file: input.paths.relativeFinalPath,
        format: "ogg_opus",
        receivedOpusPackets,
        segmentId: input.segmentId,
        startedAtMs: input.startedAtMs,
        status: "ready",
        userDisplayName: input.displayName,
        userId: input.userId,
      };
    } catch (error) {
      this.#logger.error(
        {
          errorType: getErrorType(error),
          guildId: this.guildId,
          meetingId: this.meetingId,
          segmentId: input.segmentId,
        },
        "Audio segment conversion to Ogg/Opus failed",
      );
      segment = {
        durationMs,
        endedAtMs,
        estimatedPacketLossPercent,
        file: input.paths.relativeTemporaryPath,
        format: "pcm_s16le",
        receivedOpusPackets,
        segmentId: input.segmentId,
        startedAtMs: input.startedAtMs,
        status: "conversion_failed",
        userDisplayName: input.displayName,
        userId: input.userId,
      };
    }

    await this.#updateManifest((manifest) => addSegment(manifest, segment));
    this.#logger.info(
      {
        durationMs: segment.durationMs,
        estimatedPacketLossPercent,
        guildId: this.guildId,
        meetingId: this.meetingId,
        receivedOpusPackets,
        segmentId: segment.segmentId,
        userId: input.userId,
      },
      "Audio segment finalized",
    );

    if (streamFailed) {
      void this.#recoverConnection("audio_receive_error");
      return "error";
    }
    return input.getForcedReason() ?? "silence";
  }

  async #recoverConnection(reason: string): Promise<void> {
    if (this.#recovering || this.#ended) {
      return;
    }
    this.#recovering = true;
    await this.#updateManifest((manifest) =>
      manifest.status === "recording"
        ? markManifestInterrupted(manifest, new Date().toISOString(), reason)
        : manifest,
    );
    await this.#notify(this.#text.connectionInterrupted);
    for (const capture of this.#activeCaptures.values()) {
      capture.stop();
    }
    await Promise.allSettled([...this.#activeCaptures.values()].map((capture) => capture.promise));
    this.#activeCaptures.clear();

    const deadline = Date.now() + this.#config.voiceReconnectMaxMs;
    let delayMs = 1_000;
    while (!this.#ended && Date.now() < deadline) {
      try {
        this.#connection.rejoin();
        const remainingMs = Math.max(1, deadline - Date.now());
        await entersState(
          this.#connection,
          VoiceConnectionStatus.Ready,
          Math.min(15_000, remainingMs),
        );
        await this.#updateManifest((manifest) =>
          manifest.status === "interrupted"
            ? markManifestRecording(manifest, new Date().toISOString())
            : manifest,
        );
        this.#recovering = false;
        await this.#notify(this.#text.resumed);
        return;
      } catch (error) {
        this.#logger.warn(
          {
            errorType: getErrorType(error),
            guildId: this.guildId,
            meetingId: this.meetingId,
          },
          "Recording reconnection attempt failed",
        );
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          break;
        }
        await sleep(Math.min(delayMs, remainingMs));
        delayMs = Math.min(delayMs * 2, 30_000);
      }
    }

    this.#recovering = false;
    await this.#notify(this.#text.reconnectExhausted);
    await this.stop({ reason: "reconnect_exhausted" });
  }

  async #stop(request: RecordingStopRequest): Promise<void> {
    if (this.#ended) {
      return;
    }
    this.#ended = true;
    if (this.#metricsTimer !== undefined) {
      clearInterval(this.#metricsTimer);
      this.#metricsTimer = undefined;
    }
    this.#connection.receiver.speaking.off("start", this.#handleSpeakingStart);
    this.#connection.off("stateChange", this.#handleConnectionStateChange);
    for (const capture of this.#activeCaptures.values()) {
      capture.stop();
    }
    await Promise.allSettled([...this.#activeCaptures.values()].map((capture) => capture.promise));
    this.#activeCaptures.clear();
    await this.#manifestQueue;

    const reason = request.reason;
    const now = new Date().toISOString();
    if (shouldStartTranscription(reason)) {
      await this.#updateManifest((manifest) => markManifestCompleted(manifest, now));
      await this.#enqueueCompleted();
    } else {
      await this.#updateManifest((manifest) =>
        manifest.status === "recording" ? markManifestInterrupted(manifest, now, reason) : manifest,
      );
    }

    this.#connection.destroy();
    const notification = createRecordingStopNotification(
      this.#manifest,
      request,
      this.#config.botLanguage,
    );
    if (notification !== undefined) {
      await this.#notify(notification);
    }
    this.#logger.info(
      {
        guildId: this.guildId,
        meetingId: this.meetingId,
        ...this.#performanceMetrics(),
        reason,
      },
      "Recording stopped",
    );
    this.#onEnded?.();
  }

  async #enqueueCompleted(): Promise<void> {
    if (this.#onCompleted === undefined) return;
    try {
      await this.#onCompleted(this.#manifest);
    } catch (error) {
      this.#logger.error(
        { errorType: getErrorType(error), meetingId: this.meetingId },
        "Failed to enqueue completed meeting",
      );
    }
  }

  #performanceMetrics(): {
    heapUsedBytes: number;
    processCpuPercentSingleCore: number;
    rssBytes: number;
  } {
    const memory = process.memoryUsage();
    return {
      heapUsedBytes: memory.heapUsed,
      processCpuPercentSingleCore: calculateProcessCpuPercent({
        cpuUsage: process.cpuUsage(this.#startedCpuUsage),
        elapsedMs: Number(process.hrtime.bigint() - this.#startedAtNs) / 1_000_000,
      }),
      rssBytes: memory.rss,
    };
  }

  async #updateManifest(update: (manifest: RecordingManifest) => RecordingManifest): Promise<void> {
    const operation = this.#manifestQueue.then(async () => {
      this.#manifest = update(this.#manifest);
      await this.#manifestStore.save(this.#manifest);
    });
    this.#manifestQueue = operation.catch(() => undefined);
    await operation;
  }
}

function countHumans(channel: VoiceChannel): number {
  return channel.members.filter((member) => !member.user.bot).size;
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
