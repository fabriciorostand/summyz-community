import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import type { Logger } from "pino";
import { describe, expect, it, vi } from "vitest";

import { createLogger } from "../src/logger.js";
import {
  addSegment,
  createManifest,
  markManifestCompleted,
  requireCurrentMeetingAiConfiguration,
  type RecordingManifest,
  type RecordingSegment,
} from "../src/recording/manifest.js";
import { ManifestStore } from "../src/recording/manifest-store.js";
import { MeetingTranscriptionService } from "../src/transcription/meeting-transcription-service.js";
import { IncompatibleTranscriptionResponseError } from "../src/transcription/openrouter-transcription-provider.js";
import { TranscriptionStore } from "../src/transcription/transcription-store.js";
import type { SpeechAnalyzer } from "../src/transcription/speech-analyzer.js";
import type { TranscriptionProvider } from "../src/transcription/transcription-provider.js";

async function createMeeting(root: string): Promise<{
  manifest: RecordingManifest;
  manifestStore: ManifestStore;
  transcriptionStore: TranscriptionStore;
}> {
  const manifestStore = new ManifestStore(root);
  const transcriptionStore = new TranscriptionStore(root);
  let manifest = createManifest({
    guildId: "guild-1",
    meetingId: "meeting-1",
    notificationChannelId: "text-1",
    startedAt: "2026-08-16T20:00:00.000Z",
    voiceChannelId: "voice-1",
  });
  manifest = addSegment(manifest, {
    durationMs: 2_000,
    endedAtMs: 12_000,
    file: "participants/user-a/segment-a.ogg",
    segmentId: "segment-a",
    startedAtMs: 10_000,
    userDisplayName: "Ana",
    userId: "user-a",
  });
  manifest = addSegment(manifest, {
    durationMs: 2_000,
    endedAtMs: 13_000,
    file: "participants/user-b/segment-b.ogg",
    segmentId: "segment-b",
    startedAtMs: 11_000,
    userDisplayName: "Bruno",
    userId: "user-b",
  });
  manifest = markManifestCompleted(manifest, "2026-08-16T20:01:00.000Z");
  await manifestStore.save(manifest);
  for (const segment of manifest.segments) {
    await manifestStore.prepareSegmentDirectory(manifest.meetingId, segment.userId);
    const filePath = transcriptionStore.resolveMeetingFile(manifest.meetingId, segment.file);
    await writeFile(filePath, segment.segmentId, { encoding: "utf8", flag: "wx" });
  }
  return { manifest, manifestStore, transcriptionStore };
}

function createService(input: {
  interSpeechSilenceMs?: number;
  logger?: Logger;
  manifestStore: ManifestStore;
  notifyFailure?: (manifest: RecordingManifest) => Promise<void>;
  publishTranscriptOnly?: (manifest: RecordingManifest, transcriptPath: string) => Promise<void>;
  provider: TranscriptionProvider;
  resolveSpeechAnalyzer?: (manifest: RecordingManifest) => SpeechAnalyzer;
  speechAnalyzer?: SpeechAnalyzer;
  transcriptionStore: TranscriptionStore;
  convertPcmToOgg?: (inputPath: string, outputPath: string) => Promise<void>;
  writePcmAsWav?: (inputPath: string, outputPath: string) => Promise<void>;
}) {
  return new MeetingTranscriptionService({
    concurrency: 2,
    interSpeechSilenceMs: input.interSpeechSilenceMs ?? 0,
    ...(input.convertPcmToOgg === undefined ? {} : { convertPcmToOgg: input.convertPcmToOgg }),
    logger: input.logger ?? createLogger("silent"),
    manifestStore: input.manifestStore,
    notifyFailure: input.notifyFailure ?? vi.fn(async () => undefined),
    publishTranscriptOnly: input.publishTranscriptOnly ?? vi.fn(async () => undefined),
    now: () => new Date("2026-08-16T20:02:00.000Z"),
    provider: input.provider,
    ...(input.resolveSpeechAnalyzer === undefined
      ? {}
      : { resolveSpeechAnalyzer: input.resolveSpeechAnalyzer }),
    speechAnalyzer:
      input.speechAnalyzer ??
      ({
        analyze: vi.fn(async () => ({
          containsSpeech: true,
          samples: new Float32Array(16_000).fill(0.1),
          speechRanges: [{ endedAtSample: 16_000, startedAtSample: 0 }],
        })),
        close: vi.fn(async () => undefined),
      } satisfies SpeechAnalyzer),
    transcriptionStore: input.transcriptionStore,
    transcriptionMergeMaxGapMs: 2_000,
    transcriptionWindowMaxMs: 30_000,
    ...(input.writePcmAsWav === undefined ? {} : { writePcmAsWav: input.writePcmAsWav }),
  });
}

function firstSegment(manifest: RecordingManifest): RecordingSegment {
  const segment = manifest.segments[0];
  if (segment === undefined) {
    throw new Error("O teste exige pelo menos um segmento");
  }
  return segment;
}

describe("MeetingTranscriptionService", () => {
  it("detecta uma vez na transcrição, persiste só a tag primária e sempre envia auto", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-meeting-language-"));
    const context = await createMeeting(root);
    const configured = createManifest({
      aiConfiguration: {
        language: "es-MX",
        profileType: "external",
        refinement: { model: "review", provider: "openrouter" },
        summary: { model: "summary", provider: "openrouter" },
        transcription: { model: "stt", provider: "openrouter", vad: {} },
        translation: {
          model: "translation",
          provider: "openrouter",
        },
      },
      guildId: context.manifest.guildId,
      meetingId: context.manifest.meetingId,
      notificationChannelId: context.manifest.notificationChannelId,
      startedAt: context.manifest.startedAt,
      voiceChannelId: context.manifest.voiceChannelId,
    });
    let manifest = configured;
    for (const segment of context.manifest.segments) manifest = addSegment(manifest, segment);
    manifest = markManifestCompleted(manifest, "2026-08-16T20:01:00.000Z");
    await context.manifestStore.save(manifest);
    expect(requireCurrentMeetingAiConfiguration(manifest).language).toBe("es-MX");
    const provider: TranscriptionProvider = {
      transcribe: vi.fn(async (input) => {
        expect(input.language).toBe("auto");
        return {
          attempts: 1,
          detectedLanguage: { language: "Portuguese", probability: 0.6 },
          pieces: [{ endedAtMs: 1_000, startedAtMs: 0, text: "Olá." }],
        };
      }),
    };

    await createService({ ...context, provider }).process(manifest);

    const persisted = await context.manifestStore.load(manifest.meetingId);
    expect(persisted.predominantLanguage).toBe("pt");
    expect(persisted).not.toHaveProperty("languageEvidence");
  });

  it("preserva e publica somente a transcrição quando nenhum idioma pode ser determinado", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-meeting-language-failure-"));
    const context = await createMeeting(root);
    const manifest = createManifest({
      aiConfiguration: {
        language: "auto",
        profileType: "external",
        refinement: { model: "review", provider: "openrouter" },
        summary: { model: "summary", provider: "openrouter" },
        transcription: { model: "stt", provider: "openrouter", vad: {} },
        translation: null,
      },
      guildId: context.manifest.guildId,
      meetingId: context.manifest.meetingId,
      notificationChannelId: context.manifest.notificationChannelId,
      startedAt: context.manifest.startedAt,
      voiceChannelId: context.manifest.voiceChannelId,
    });
    let configured = manifest;
    for (const segment of context.manifest.segments) configured = addSegment(configured, segment);
    configured = markManifestCompleted(configured, "2026-08-16T20:01:00.000Z");
    await context.manifestStore.save(configured);
    const publishTranscriptOnly = vi.fn(async () => undefined);

    await createService({
      ...context,
      provider: {
        transcribe: vi.fn(async () => ({
          attempts: 1,
          pieces: [{ endedAtMs: 1_000, startedAtMs: 0, text: "Olá." }],
        })),
      },
      publishTranscriptOnly,
    }).process(configured);

    const transcriptPath = context.transcriptionStore.transcriptPath(configured.meetingId);
    await expect(access(transcriptPath)).resolves.toBeUndefined();
    await expect(context.transcriptionStore.load(configured.meetingId)).resolves.toMatchObject({
      failureCode: "language_detection_failed",
      status: "failed",
    });
    expect(publishTranscriptOnly).toHaveBeenCalledWith(configured, transcriptPath);
  });
  it("só cria transcript.txt depois que todos os segmentos têm sucesso", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-meeting-"));
    const context = await createMeeting(root);
    const provider: TranscriptionProvider = {
      transcribe: vi.fn(async () => ({
        attempts: 1,
        pieces: [
          {
            endedAtMs: 1_000,
            startedAtMs: 0,
            text: "Olá.",
          },
        ],
      })),
    };
    const service = createService({ ...context, provider });

    await service.process(context.manifest);

    await expect(
      readFile(context.transcriptionStore.transcriptPath(context.manifest.meetingId), "utf8"),
    ).resolves.toBe(
      "[00:00:10.000 – 00:00:11.000] Ana: Olá.\n" + "[00:00:11.000 – 00:00:12.000] Bruno: Olá.\n",
    );
    await expect(context.transcriptionStore.load("meeting-1")).resolves.toMatchObject({
      status: "completed",
    });
    await service.process(context.manifest);
    expect(provider.transcribe).toHaveBeenCalledTimes(2);
  });

  it("não cria o txt, preserva os áudios e notifica uma falha terminal", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-meeting-"));
    const context = await createMeeting(root);
    const notifyFailure = vi.fn(async () => undefined);
    const provider: TranscriptionProvider = {
      transcribe: vi.fn(async () => {
        throw new Error("provedor indisponível");
      }),
    };
    const service = createService({ ...context, notifyFailure, provider });

    await expect(service.process(context.manifest)).resolves.toBeUndefined();

    await expect(access(context.transcriptionStore.transcriptPath("meeting-1"))).rejects.toThrow();
    await expect(context.transcriptionStore.load("meeting-1")).resolves.toMatchObject({
      failureCode: "provider_failed",
      status: "failed",
    });
    await expect(
      access(
        context.transcriptionStore.resolveMeetingFile(
          "meeting-1",
          firstSegment(context.manifest).file,
        ),
      ),
    ).resolves.toBeUndefined();
    expect(notifyFailure).toHaveBeenCalledOnce();
  });

  it("adia o aviso da falha enquanto ainda restam tentativas duráveis", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-meeting-"));
    const context = await createMeeting(root);
    const notifyFailure = vi.fn(async () => undefined);
    const service = createService({
      ...context,
      notifyFailure,
      provider: {
        transcribe: vi.fn(async () => {
          throw new Error("provedor indisponível");
        }),
      },
    });

    await service.process(context.manifest, { notifyTerminalFailure: false });

    await expect(context.transcriptionStore.load("meeting-1")).resolves.toMatchObject({
      failureCode: "provider_failed",
      status: "failed",
    });
    expect(notifyFailure).not.toHaveBeenCalled();
  });

  it("registra somente a categoria estrutural segura da resposta incompatível", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-meeting-"));
    const context = await createMeeting(root);
    const destination = new PassThrough();
    let output = "";
    destination.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    const sensitiveContent = "resposta sensível do provedor";
    const error = Object.assign(new IncompatibleTranscriptionResponseError("missing_timestamps"), {
      response: sensitiveContent,
    });
    const provider: TranscriptionProvider = {
      transcribe: vi.fn(async () => {
        throw error;
      }),
    };
    const service = createService({
      ...context,
      logger: createLogger("error", destination),
      provider,
    });

    await service.process(context.manifest);
    await new Promise((resolve) => setImmediate(resolve));

    expect(output).toContain('"incompatibilityReason":"missing_timestamps"');
    expect(output).not.toContain(sensitiveContent);
  });

  it("usa WAV sem perdas quando a nova conversão para Ogg falha", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-meeting-"));
    const manifestStore = new ManifestStore(root);
    const transcriptionStore = new TranscriptionStore(root);
    let manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-fallback",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    manifest = markManifestCompleted(
      addSegment(manifest, {
        durationMs: 1_000,
        endedAtMs: 1_000,
        file: "participants/user-a/segment-a.pcm",
        format: "pcm_s16le",
        segmentId: "segment-a",
        startedAtMs: 0,
        status: "conversion_failed",
        userDisplayName: "Ana",
        userId: "user-a",
      }),
      "2026-08-16T20:01:00.000Z",
    );
    await manifestStore.save(manifest);
    await manifestStore.prepareSegmentDirectory("meeting-fallback", "user-a");
    const pcmPath = transcriptionStore.resolveMeetingFile(
      "meeting-fallback",
      firstSegment(manifest).file,
    );
    await writeFile(pcmPath, Buffer.from([1, 2, 3, 4]));
    const provider: TranscriptionProvider = {
      transcribe: vi.fn(async ({ audio, format }) => {
        expect(format).toBe("wav");
        expect(Buffer.from(audio).subarray(0, 4).toString("ascii")).toBe("RIFF");
        return {
          attempts: 1,
          pieces: [{ endedAtMs: 500, startedAtMs: 0, text: "Recuperado." }],
        };
      }),
    };
    const service = createService({
      convertPcmToOgg: vi.fn(async () => {
        throw new Error("ffmpeg falhou");
      }),
      manifestStore,
      provider,
      transcriptionStore,
    });

    await service.process(manifest);

    expect(provider.transcribe).toHaveBeenCalledOnce();
    await expect(
      readFile(transcriptionStore.transcriptPath("meeting-fallback"), "utf8"),
    ).resolves.toContain("Ana: Recuperado.");
    await expect(access(pcmPath)).resolves.toBeUndefined();
  });

  it("interrompe antes da API quando Ogg e WAV não podem ser preparados", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-meeting-"));
    const manifestStore = new ManifestStore(root);
    const transcriptionStore = new TranscriptionStore(root);
    let manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-failed",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    manifest = markManifestCompleted(
      addSegment(manifest, {
        durationMs: 1_000,
        endedAtMs: 1_000,
        file: "participants/user-a/segment-a.pcm",
        format: "pcm_s16le",
        segmentId: "segment-a",
        startedAtMs: 0,
        status: "conversion_failed",
        userDisplayName: "Ana",
        userId: "user-a",
      }),
      "2026-08-16T20:01:00.000Z",
    );
    await manifestStore.save(manifest);
    await manifestStore.prepareSegmentDirectory("meeting-failed", "user-a");
    const pcmPath = transcriptionStore.resolveMeetingFile(
      "meeting-failed",
      firstSegment(manifest).file,
    );
    await writeFile(pcmPath, Buffer.from([1, 2, 3, 4]));
    const notifyFailure = vi.fn(async () => undefined);
    const provider: TranscriptionProvider = { transcribe: vi.fn() };
    const service = createService({
      convertPcmToOgg: vi.fn(async () => {
        throw new Error("ffmpeg falhou");
      }),
      manifestStore,
      notifyFailure,
      provider,
      transcriptionStore,
      writePcmAsWav: vi.fn(async () => {
        throw new Error("wav falhou");
      }),
    });

    await service.process(manifest, { notifyTerminalFailure: false });

    expect(provider.transcribe).not.toHaveBeenCalled();
    expect(notifyFailure).toHaveBeenCalledOnce();
    await expect(transcriptionStore.load("meeting-failed")).resolves.toMatchObject({
      failureCode: "audio_conversion_failed",
      status: "failed",
    });
  });

  it("usa Ogg temporário quando a nova tentativa de conversão funciona", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-meeting-"));
    const manifestStore = new ManifestStore(root);
    const transcriptionStore = new TranscriptionStore(root);
    let manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-reconverted",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    manifest = markManifestCompleted(
      addSegment(manifest, {
        durationMs: 1_000,
        endedAtMs: 1_000,
        file: "participants/user-a/segment-a.pcm",
        format: "pcm_s16le",
        segmentId: "segment-a",
        startedAtMs: 0,
        status: "conversion_failed",
        userDisplayName: "Ana",
        userId: "user-a",
      }),
      "2026-08-16T20:01:00.000Z",
    );
    await manifestStore.save(manifest);
    await manifestStore.prepareSegmentDirectory("meeting-reconverted", "user-a");
    const pcmPath = transcriptionStore.resolveMeetingFile(
      "meeting-reconverted",
      firstSegment(manifest).file,
    );
    await writeFile(pcmPath, Buffer.from([1, 2, 3, 4]));
    const oggPath = manifestStore.segmentPaths(
      "meeting-reconverted",
      "user-a",
      "segment-a",
    ).finalPath;
    const provider: TranscriptionProvider = {
      transcribe: vi.fn(async ({ audio, format }) => {
        expect(format).toBe("ogg");
        expect(Buffer.from(audio).subarray(0, 4).toString("ascii")).toBe("RIFF");
        return {
          attempts: 1,
          pieces: [{ endedAtMs: 500, startedAtMs: 0, text: "Recuperado." }],
        };
      }),
    };
    const service = createService({
      convertPcmToOgg: async (_inputPath, outputPath) => {
        await writeFile(outputPath, "ogg recuperado");
      },
      manifestStore,
      provider,
      transcriptionStore,
    });

    await service.process(manifest);

    await expect(access(oggPath)).rejects.toThrow();
    await expect(access(pcmPath)).resolves.toBeUndefined();
  });

  it("mantém a falha persistida quando o aviso ao Discord também falha", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-meeting-"));
    const context = await createMeeting(root);
    const service = createService({
      ...context,
      notifyFailure: vi.fn(async () => {
        throw new Error("Discord indisponível");
      }),
      provider: {
        transcribe: vi.fn(async () => {
          throw new Error("provedor indisponível");
        }),
      },
    });

    await service.process(context.manifest);

    await expect(context.transcriptionStore.load("meeting-1")).resolves.toMatchObject({
      status: "failed",
    });
  });

  it("conclui segmentos sem voz sem enviá-los ao provedor", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-meeting-"));
    const context = await createMeeting(root);
    const provider: TranscriptionProvider = { transcribe: vi.fn() };
    const speechAnalyzer: SpeechAnalyzer = {
      analyze: vi.fn(async () => ({
        containsSpeech: false,
        samples: new Float32Array(16_000),
        speechRanges: [],
      })),
      close: vi.fn(async () => undefined),
    };
    const service = createService({ ...context, provider, speechAnalyzer });

    await service.process(context.manifest);

    expect(provider.transcribe).not.toHaveBeenCalled();
    await expect(
      readFile(context.transcriptionStore.transcriptPath("meeting-1"), "utf8"),
    ).resolves.toBe("");
    await expect(context.transcriptionStore.load("meeting-1")).resolves.toMatchObject({
      segments: [
        { attempts: 0, pieces: [], status: "completed" },
        { attempts: 0, pieces: [], status: "completed" },
      ],
      status: "completed",
    });
  });

  it("usa exclusivamente o analisador resolvido para a reunião e encerra seu ciclo de vida", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-meeting-"));
    const context = await createMeeting(root);
    const provider: TranscriptionProvider = {
      transcribe: vi.fn(async () => ({
        attempts: 1,
        pieces: [{ endedAtMs: 500, startedAtMs: 0, text: "Olá" }],
      })),
    };
    const sharedAnalyzer: SpeechAnalyzer = {
      analyze: vi.fn(async () => {
        throw new Error("the shared analyzer must not run");
      }),
      close: vi.fn(async () => undefined),
    };
    const resolvedAnalyzer: SpeechAnalyzer = {
      analyze: vi.fn(async () => ({
        containsSpeech: true,
        samples: new Float32Array(16_000).fill(0.1),
        speechRanges: [{ endedAtSample: 16_000, startedAtSample: 0 }],
      })),
      close: vi.fn(async () => undefined),
    };
    const service = createService({
      ...context,
      provider,
      resolveSpeechAnalyzer: () => resolvedAnalyzer,
      speechAnalyzer: sharedAnalyzer,
    });

    await service.process(context.manifest);

    expect(resolvedAnalyzer.analyze).toHaveBeenCalled();
    expect(resolvedAnalyzer.close).toHaveBeenCalledOnce();
    expect(sharedAnalyzer.analyze).not.toHaveBeenCalled();
    expect(sharedAnalyzer.close).not.toHaveBeenCalled();
  });

  it("interrompe com código específico quando a análise local falha", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-meeting-"));
    const context = await createMeeting(root);
    const provider: TranscriptionProvider = { transcribe: vi.fn() };
    const service = createService({
      ...context,
      provider,
      speechAnalyzer: {
        analyze: vi.fn(async () => {
          throw new Error("modelo local indisponível");
        }),
        close: vi.fn(async () => undefined),
      },
    });

    await service.process(context.manifest);

    expect(provider.transcribe).not.toHaveBeenCalled();
    await expect(context.transcriptionStore.load("meeting-1")).resolves.toMatchObject({
      failureCode: "audio_analysis_failed",
      status: "failed",
    });
  });

  it("consolida falas próximas da mesma pessoa e mantém o relógio original", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-meeting-"));
    const manifestStore = new ManifestStore(root);
    const transcriptionStore = new TranscriptionStore(root);
    let manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-merged",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    manifest = addSegment(manifest, {
      durationMs: 1_000,
      endedAtMs: 11_000,
      file: "participants/user-a/segment-a.ogg",
      segmentId: "segment-a",
      startedAtMs: 10_000,
      userDisplayName: "Ana",
      userId: "user-a",
    });
    manifest = markManifestCompleted(
      addSegment(manifest, {
        durationMs: 1_000,
        endedAtMs: 13_500,
        file: "participants/user-a/segment-b.ogg",
        segmentId: "segment-b",
        startedAtMs: 12_500,
        userDisplayName: "Ana",
        userId: "user-a",
      }),
      "2026-08-16T20:01:00.000Z",
    );
    await manifestStore.save(manifest);
    for (const item of manifest.segments) {
      await manifestStore.prepareSegmentDirectory(manifest.meetingId, item.userId);
      await writeFile(transcriptionStore.resolveMeetingFile(manifest.meetingId, item.file), "ogg");
    }
    const provider: TranscriptionProvider = {
      transcribe: vi.fn(async ({ audioDurationMs }) => {
        expect(audioDurationMs).toBe(2_350);
        return {
          attempts: 1,
          pieces: [{ endedAtMs: 2_350, startedAtMs: 1_350, text: "Segunda fala." }],
        };
      }),
    };
    const service = createService({
      interSpeechSilenceMs: 350,
      manifestStore,
      provider,
      transcriptionStore,
    });

    await service.process(manifest);

    expect(provider.transcribe).toHaveBeenCalledOnce();
    await expect(
      readFile(transcriptionStore.transcriptPath("meeting-merged"), "utf8"),
    ).resolves.toBe("[00:00:12.500 – 00:00:13.500] Ana: Segunda fala.\n");
  });

  it("ignora manifestos que não foram concluídos normalmente", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-meeting-"));
    const manifestStore = new ManifestStore(root);
    const transcriptionStore = new TranscriptionStore(root);
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "recording",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    const provider: TranscriptionProvider = { transcribe: vi.fn() };
    const service = createService({ manifestStore, provider, transcriptionStore });

    await expect(service.process(manifest)).rejects.toThrow(/concluída/i);
    expect(provider.transcribe).not.toHaveBeenCalled();
  });
});
