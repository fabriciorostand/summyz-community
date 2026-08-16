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
import { convertPcmToOgg } from "./audio-converter.js";
import {
  addSegment,
  createManifest,
  markManifestInterrupted,
  markManifestRecording,
  markManifestCompleted,
  type RecordingManifest,
  type RecordingSegment,
} from "./manifest.js";
import type { ManifestStore } from "./manifest-store.js";
import { calculateProcessCpuPercent, estimatePacketLossPercent } from "./recording-metrics.js";
import type {
  RecordingHandle,
  RecordingSessionFactory,
  RecordingStopReason,
  StartRecordingInput,
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

  public constructor(
    client: Client,
    config: AppConfig,
    manifestStore: ManifestStore,
    logger: Logger,
  ) {
    this.#client = client;
    this.#config = config;
    this.#manifestStore = manifestStore;
    this.#logger = logger;
  }

  public async create(input: StartRecordingInput, onEnded?: () => void): Promise<RecordingHandle> {
    const manifest = createManifest({
      guildId: input.guildId,
      meetingId: randomUUID(),
      notificationChannelId: input.notificationChannelId,
      startedAt: new Date().toISOString(),
      voiceChannelId: input.voiceChannelId,
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
        "⚠️ Não foi possível iniciar a gravação. Nenhum áudio está sendo capturado.",
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
      const interrupted =
        manifest.status === "recording"
          ? markManifestInterrupted(manifest, new Date().toISOString(), "process_restart")
          : manifest;
      await this.#manifestStore.save(interrupted);
      await this.#notify(
        manifest.notificationChannelId,
        "⚠️ A gravação anterior ficou interrompida e não foi retomada porque o canal está vazio.",
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
      "⚠️ O Summyz foi interrompido. Tentando retomar a gravação desta call.",
    );

    try {
      const handle = await this.#open(recoverableManifest, onEnded, voiceChannel);
      await this.#notify(
        manifest.notificationChannelId,
        "✅ A gravação foi retomada automaticamente.",
      );
      return handle;
    } catch (error) {
      this.#logger.error(
        {
          errorType: getErrorType(error),
          guildId: manifest.guildId,
          meetingId: manifest.meetingId,
        },
        "Falha ao retomar gravação após reinício",
      );
      await this.#notify(
        manifest.notificationChannelId,
        "⚠️ Não foi possível retomar a gravação. O áudio capturado foi preservado.",
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

    const readyManifest =
      manifest.status === "interrupted"
        ? markManifestRecording(manifest, new Date().toISOString())
        : manifest;
    await this.#manifestStore.save(readyManifest);

    const recording = new DiscordVoiceRecording({
      config: this.#config,
      connection,
      guild: voiceChannel.guild,
      logger: this.#logger,
      manifest: readyManifest,
      manifestStore: this.#manifestStore,
      notify: (message) => this.#notify(readyManifest.notificationChannelId, message),
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
        await channel.send({ content: message });
      }
    } catch (error) {
      this.#logger.warn(
        { channelId, errorType: getErrorType(error) },
        "Não foi possível enviar aviso da gravação",
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
  onEnded?: () => void;
}

class DiscordVoiceRecording implements RecordingHandle {
  readonly guildId: string;
  readonly meetingId: string;
  readonly voiceChannelId: string;
  readonly #activeCaptures = new Map<string, ActiveCapture>();
  readonly #config: AppConfig;
  readonly #connection: VoiceConnection;
  readonly #guild: Guild;
  readonly #logger: Logger;
  readonly #manifestStore: ManifestStore;
  readonly #notify: (message: string) => Promise<void>;
  readonly #onEnded: (() => void) | undefined;
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
    this.voiceChannelId = input.manifest.voiceChannelId;
    this.#config = input.config;
    this.#connection = input.connection;
    this.#guild = input.guild;
    this.#logger = input.logger;
    this.#manifest = input.manifest;
    this.#manifestStore = input.manifestStore;
    this.#notify = input.notify;
    this.#onEnded = input.onEnded;
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
        "Métricas da gravação",
      );
    }, 10_000);
    this.#metricsTimer.unref();
    this.#logger.info(
      { guildId: this.guildId, meetingId: this.meetingId, voiceChannelId: this.voiceChannelId },
      "Gravação iniciada",
    );
  }

  public async stop(reason: RecordingStopReason): Promise<void> {
    this.#stopPromise ??= this.#stop(reason);
    await this.#stopPromise;
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
          "Falha ao capturar segmento de áudio",
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
        "Falha ao converter segmento para Ogg/Opus",
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
      "Segmento de áudio finalizado",
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
    await this.#notify(
      "⚠️ A gravação foi interrompida por um problema de conexão. Tentando retomar automaticamente.",
    );
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
        await this.#notify("✅ A gravação foi retomada automaticamente.");
        return;
      } catch (error) {
        this.#logger.warn(
          {
            errorType: getErrorType(error),
            guildId: this.guildId,
            meetingId: this.meetingId,
          },
          "Tentativa de reconexão da gravação falhou",
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
    await this.#notify(
      "⚠️ Não foi possível retomar a gravação em cinco minutos. O áudio capturado foi preservado.",
    );
    await this.stop("reconnect_exhausted");
  }

  async #stop(reason: RecordingStopReason): Promise<void> {
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

    const now = new Date().toISOString();
    if (reason === "command" || reason === "channel_empty") {
      await this.#updateManifest((manifest) => markManifestCompleted(manifest, now));
    } else {
      await this.#updateManifest((manifest) =>
        manifest.status === "recording" ? markManifestInterrupted(manifest, now, reason) : manifest,
      );
    }

    this.#connection.destroy();
    if (reason === "channel_empty") {
      await this.#notify("⏹️ Todos saíram do canal. A gravação foi encerrada automaticamente.");
    } else if (reason === "shutdown") {
      await this.#notify(
        "⚠️ O Summyz foi desligado durante a call. O áudio foi preservado e a retomada ocorrerá no próximo início.",
      );
    }
    this.#logger.info(
      {
        guildId: this.guildId,
        meetingId: this.meetingId,
        ...this.#performanceMetrics(),
        reason,
      },
      "Gravação encerrada",
    );
    this.#onEnded?.();
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
