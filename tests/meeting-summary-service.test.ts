import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { MeetingPublisher } from "../src/discord/discord-meeting-publisher.js";
import { createLogger } from "../src/logger.js";
import {
  addSegment,
  createManifest,
  markManifestCompleted,
  type RecordingManifest,
  recordingManifestSchema,
} from "../src/recording/manifest.js";
import {
  createRefinementState,
  markRefinementCompleted,
  markRefinementFallback,
} from "../src/refinement/refinement-state.js";
import { RefinementStore } from "../src/refinement/refinement-store.js";
import type { MeetingSummaryGenerationResult } from "../src/summary/meeting-summary-generator.js";
import {
  MeetingSummaryService,
  type SummaryGenerator,
} from "../src/summary/meeting-summary-service.js";
import { createSummaryState, markSummaryFailed } from "../src/summary/summary-state.js";
import { SummaryStore } from "../src/summary/summary-store.js";
import {
  completeTranscriptionSegment,
  createTranscriptionState,
  markTranscriptionCompleted,
} from "../src/transcription/transcription-state.js";
import { TranscriptionStore } from "../src/transcription/transcription-store.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function createContext() {
  const root = await mkdtemp(join(tmpdir(), "summyz-meeting-summary-"));
  directories.push(root);
  const manifest = recordingManifestSchema.parse(
    markManifestCompleted(
      addSegment(
        createManifest({
          aiConfiguration: {
            language: "auto",
            profileType: "external",
            refinement: { model: "review", provider: "openrouter" },
            summary: { model: "summary", provider: "openrouter" },
            transcription: { model: "stt", provider: "openrouter", vad: {} },
          },
          guildId: "guild-1",
          meetingId: "meeting-1",
          notificationChannelId: "text-1",
          startedAt: "2026-08-17T10:00:00.000Z",
          voiceChannelId: "voice-1",
        }),
        {
          durationMs: 2_000,
          endedAtMs: 12_000,
          file: "participants/user-1/segment-1.ogg",
          segmentId: "segment-1",
          startedAtMs: 10_000,
          userDisplayName: "Ana",
          userId: "user-1",
        },
      ),
      "2026-08-17T10:01:00.000Z",
    ),
  );
  manifest.predominantLanguage = "pt";
  const transcriptionStore = new TranscriptionStore(root);
  let transcription = createTranscriptionState(
    "meeting-1",
    ["segment-1"],
    "2026-08-17T10:01:00.000Z",
  );
  transcription = completeTranscriptionSegment(
    transcription,
    "segment-1",
    {
      attempts: 1,
      pieces: [{ endedAtMs: 2_000, startedAtMs: 0, text: "Está decidido: fluxo A." }],
    },
    "2026-08-17T10:02:00.000Z",
  );
  transcription = markTranscriptionCompleted(transcription, "2026-08-17T10:02:00.000Z");
  await transcriptionStore.save(transcription);
  await transcriptionStore.writeTranscript("meeting-1", "transcrição");
  const refinementStore = new RefinementStore(root);
  await refinementStore.save(
    markRefinementCompleted(
      createRefinementState("meeting-1", "2026-08-17T10:02:00.000Z"),
      [
        {
          endedAtMs: 12_000,
          id: "segment-1:000000",
          speaker: "Ana",
          startedAtMs: 10_000,
          text: "Está decidido: fluxo A revisado.",
        },
      ],
      1,
      "2026-08-17T10:02:30.000Z",
    ),
  );
  const summaryStore = new SummaryStore(root);
  const publishSummary = vi.fn(async () => undefined);
  const publishTranscriptOnly = vi.fn(async () => undefined);
  const publisher: MeetingPublisher = {
    publishSummary,
    publishTranscriptOnly,
  };
  return {
    manifest,
    publishSummary,
    publishTranscriptOnly,
    publisher,
    refinementStore,
    root,
    summaryStore,
    transcriptionStore,
  };
}

const generated: MeetingSummaryGenerationResult = {
  attempts: 1,
  summary: {
    decisions: [{ sourceEntryIds: ["segment-1:000000"], text: "Adotar o fluxo A." }],
    discussedTopics: ["Fluxo A"],
    executiveSummary:
      "A equipe decidiu adotar o fluxo A e atribuiu a preparação do próximo cronograma ao grupo responsável pela reunião.",
    observations: [],
    tasks: [],
  },
};

function explicitLanguageManifest(manifest: RecordingManifest): RecordingManifest {
  return recordingManifestSchema.parse({
    ...manifest,
    aiConfiguration: {
      language: "es",
      profileType: "external",
      refinement: { model: "review", provider: "openrouter" },
      summary: { model: "summary", provider: "openrouter" },
      transcription: { model: "stt", provider: "openrouter", vad: {} },
    },
    predominantLanguage: "pt",
    startedByUserId: "user-1",
  });
}

describe("MeetingSummaryService", () => {
  it("retries language validation and publishes a confirmed direct summary", async () => {
    const context = await createContext();
    const manifest = explicitLanguageManifest(context.manifest);
    const generate = vi.fn(async () => generated);
    const validateLanguage = vi
      .fn()
      .mockReturnValueOnce({ detectedLanguage: "pt", status: "wrong" })
      .mockReturnValueOnce({ detectedLanguage: "en", status: "confirmed" });
    const service = new MeetingSummaryService({
      generator: { generate },
      logger: createLogger("silent"),
      publisher: context.publisher,
      refinementStore: context.refinementStore,
      summaryStore: context.summaryStore,
      transcriptionStore: context.transcriptionStore,
      validateLanguage,
    });

    await service.process(manifest);

    expect(generate).toHaveBeenCalledTimes(2);
    expect(validateLanguage).toHaveBeenCalledWith(expect.any(Object), "es");
    await expect(context.summaryStore.load("meeting-1")).resolves.toMatchObject({
      languageValidation: { attempts: 2, status: "confirmed" },
    });
    expect(context.publishSummary).toHaveBeenCalledOnce();
  });

  it("publishes the final summary after three unconfirmed language attempts", async () => {
    const context = await createContext();
    const manifest = explicitLanguageManifest(context.manifest);
    const generate = vi.fn(async () => generated);
    const service = new MeetingSummaryService({
      generator: { generate },
      logger: createLogger("silent"),
      publisher: context.publisher,
      refinementStore: context.refinementStore,
      summaryStore: context.summaryStore,
      transcriptionStore: context.transcriptionStore,
      validateLanguage: () => ({ detectedLanguage: "pt", status: "wrong" }),
    });

    await service.process(manifest);

    expect(generate).toHaveBeenCalledTimes(3);
    await expect(context.summaryStore.load("meeting-1")).resolves.toMatchObject({
      languageValidation: {
        attempts: 3,
        detectedLanguage: "pt",
        requestedLanguage: "es",
        status: "unconfirmed",
      },
    });
    expect(context.publishSummary).toHaveBeenCalledOnce();
    expect(context.publishTranscriptOnly).not.toHaveBeenCalled();
  });

  it("exige gerador ou resolvedor na construção", async () => {
    const context = await createContext();
    expect(
      () =>
        new MeetingSummaryService({
          logger: createLogger("silent"),
          publisher: context.publisher,
          refinementStore: context.refinementStore,
          summaryStore: context.summaryStore,
          transcriptionStore: context.transcriptionStore,
        }),
    ).toThrow(/generator or resolver/i);
  });

  it("rejeita gravações que ainda não foram concluídas", async () => {
    const context = await createContext();
    const service = new MeetingSummaryService({
      generator: { generate: vi.fn(async () => generated) },
      logger: createLogger("silent"),
      publisher: context.publisher,
      refinementStore: context.refinementStore,
      summaryStore: context.summaryStore,
      transcriptionStore: context.transcriptionStore,
    });
    const recording = createManifest({
      guildId: "guild-1",
      meetingId: "recording-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-17T10:00:00.000Z",
      voiceChannelId: "voice-1",
    });

    await expect(service.process(recording)).rejects.toThrow(/concluída/i);
  });

  it("gera, persiste e publica o resumo sem expor evidências", async () => {
    const context = await createContext();
    const generate = vi.fn(async () => generated);
    const generator: SummaryGenerator = { generate };
    const service = new MeetingSummaryService({
      generator,
      logger: createLogger("silent"),
      publisher: context.publisher,
      refinementStore: context.refinementStore,
      summaryStore: context.summaryStore,
      timeZone: "America/Sao_Paulo",
      transcriptionStore: context.transcriptionStore,
    });

    await service.process(context.manifest);

    expect(generate).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "segment-1:000000",
        speaker: "Ana",
        spokenAt: {
          instant: "2026-08-17T10:00:10.000Z",
          timeZone: "America/Sao_Paulo",
        },
        text: "Está decidido: fluxo A revisado.",
      }),
    ]);
    await expect(context.summaryStore.load("meeting-1")).resolves.toMatchObject({
      attempts: 1,
      status: "completed",
    });
    expect(context.publishSummary).toHaveBeenCalledWith(
      context.manifest,
      expect.objectContaining({ decisions: ["Adotar o fluxo A."] }),
      context.transcriptionStore.transcriptPath("meeting-1"),
    );
    expect(JSON.stringify(context.publishSummary.mock.calls)).not.toContain("sourceEntryIds");
    expect(context.publishTranscriptOnly).not.toHaveBeenCalled();
  });

  it("aceita resolver o gerador assincronamente no momento do processamento", async () => {
    const context = await createContext();
    const generate = vi.fn(async () => generated);
    const resolveGenerator = vi.fn(async () => ({ generate }));
    const service = new MeetingSummaryService({
      logger: createLogger("silent"),
      publisher: context.publisher,
      refinementStore: context.refinementStore,
      resolveGenerator,
      summaryStore: context.summaryStore,
      transcriptionStore: context.transcriptionStore,
    });

    await service.process(context.manifest);

    expect(resolveGenerator).toHaveBeenCalledWith(context.manifest);
    expect(generate).toHaveBeenCalledOnce();
  });

  it("persiste falha terminal e publica somente a transcrição", async () => {
    const context = await createContext();
    const generator: SummaryGenerator = {
      generate: vi.fn(async () => {
        throw new Error("provedor indisponível");
      }),
    };
    const service = new MeetingSummaryService({
      generator,
      logger: createLogger("silent"),
      publisher: context.publisher,
      refinementStore: context.refinementStore,
      summaryStore: context.summaryStore,
      transcriptionStore: context.transcriptionStore,
    });

    await service.process(context.manifest);

    await expect(context.summaryStore.load("meeting-1")).resolves.toMatchObject({
      failureCode: "provider_failed",
      status: "failed",
    });
    expect(context.publishTranscriptOnly).toHaveBeenCalledWith(
      context.manifest,
      context.transcriptionStore.transcriptPath("meeting-1"),
    );
  });

  it("mantém o resumo pendente enquanto ainda restam tentativas duráveis", async () => {
    const context = await createContext();
    const failure = new Error("provedor indisponível");
    const service = new MeetingSummaryService({
      generator: {
        generate: vi.fn(async () => {
          throw failure;
        }),
      },
      logger: createLogger("silent"),
      publisher: context.publisher,
      refinementStore: context.refinementStore,
      summaryStore: context.summaryStore,
      transcriptionStore: context.transcriptionStore,
    });

    await expect(
      service.process(context.manifest, { fallbackOnProviderFailure: false }),
    ).rejects.toBe(failure);

    await expect(context.summaryStore.load("meeting-1")).resolves.toMatchObject({
      status: "processing",
    });
    expect(context.publishTranscriptOnly).not.toHaveBeenCalled();
  });

  it("retoma publicação a partir de estados terminais sem chamar novamente o modelo", async () => {
    const completedContext = await createContext();
    const generate = vi.fn(async () => generated);
    const completedService = new MeetingSummaryService({
      generator: { generate },
      logger: createLogger("silent"),
      publisher: completedContext.publisher,
      refinementStore: completedContext.refinementStore,
      summaryStore: completedContext.summaryStore,
      transcriptionStore: completedContext.transcriptionStore,
    });
    await completedService.process(completedContext.manifest);
    await completedService.process(completedContext.manifest);

    expect(generate).toHaveBeenCalledOnce();
    expect(completedContext.publishSummary).toHaveBeenCalledTimes(2);

    const failedContext = await createContext();
    await failedContext.summaryStore.save(
      markSummaryFailed(
        createSummaryState("meeting-1", "2026-08-17T10:02:00.000Z"),
        "provider_failed",
        4,
        "2026-08-17T10:03:00.000Z",
      ),
    );
    const failedService = new MeetingSummaryService({
      generator: { generate },
      logger: createLogger("silent"),
      publisher: failedContext.publisher,
      refinementStore: failedContext.refinementStore,
      summaryStore: failedContext.summaryStore,
      transcriptionStore: failedContext.transcriptionStore,
    });
    await failedService.process(failedContext.manifest);

    expect(failedContext.publishTranscriptOnly).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledOnce();
  });

  it("aguarda uma transcrição concluída antes de iniciar", async () => {
    const context = await createContext();
    await context.transcriptionStore.save(
      createTranscriptionState("meeting-1", ["segment-1"], "2026-08-17T10:01:00.000Z"),
    );
    const generate = vi.fn(async () => generated);
    const service = new MeetingSummaryService({
      generator: { generate },
      logger: createLogger("silent"),
      publisher: context.publisher,
      refinementStore: context.refinementStore,
      summaryStore: context.summaryStore,
      transcriptionStore: context.transcriptionStore,
    });

    await service.process(context.manifest);

    expect(generate).not.toHaveBeenCalled();
    expect(context.publishSummary).not.toHaveBeenCalled();
  });

  it("aguarda o refinamento e aceita o fallback com a transcrição original", async () => {
    const pendingContext = await createContext();
    await pendingContext.refinementStore.save(
      createRefinementState("meeting-1", "2026-08-17T10:02:00.000Z"),
    );
    const pendingGenerate = vi.fn(async () => generated);
    const pendingService = new MeetingSummaryService({
      generator: { generate: pendingGenerate },
      logger: createLogger("silent"),
      publisher: pendingContext.publisher,
      refinementStore: pendingContext.refinementStore,
      summaryStore: pendingContext.summaryStore,
      transcriptionStore: pendingContext.transcriptionStore,
    });
    await pendingService.process(pendingContext.manifest);
    expect(pendingGenerate).not.toHaveBeenCalled();

    const fallbackContext = await createContext();
    await fallbackContext.refinementStore.save(
      markRefinementFallback(
        createRefinementState("meeting-1", "2026-08-17T10:02:00.000Z"),
        [],
        3,
        "2026-08-17T10:03:00.000Z",
      ),
    );
    const fallbackGenerate = vi.fn(async () => generated);
    const fallbackService = new MeetingSummaryService({
      generator: { generate: fallbackGenerate },
      logger: createLogger("silent"),
      publisher: fallbackContext.publisher,
      refinementStore: fallbackContext.refinementStore,
      summaryStore: fallbackContext.summaryStore,
      transcriptionStore: fallbackContext.transcriptionStore,
    });
    await fallbackService.process(fallbackContext.manifest);
    expect(fallbackGenerate).toHaveBeenCalledWith([]);
  });
});
