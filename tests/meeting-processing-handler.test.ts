import { describe, expect, it, vi } from "vitest";

import { MeetingProcessingHandler } from "../src/processing/meeting-processing-handler.js";
import type { ProcessingJobError } from "../src/processing/durable-job-worker.js";
import { createManifest, markManifestCompleted } from "../src/recording/manifest.js";
import {
  createRefinementState,
  markRefinementCompleted,
} from "../src/refinement/refinement-state.js";
import { createSummaryState, markSummaryFailed } from "../src/summary/summary-state.js";
import {
  createTranscriptionState,
  markTranscriptionCompleted,
  markTranscriptionFailed,
  retryFailedTranscription,
  type TranscriptionState,
} from "../src/transcription/transcription-state.js";
import type { ClaimedProcessingJob } from "../src/processing/durable-job-queue.js";

const manifest = markManifestCompleted(
  createManifest({
    guildId: "guild-1",
    meetingId: "meeting-1",
    notificationChannelId: "text-1",
    startedAt: "2026-08-24T10:00:00.000Z",
    voiceChannelId: "voice-1",
  }),
  "2026-08-24T10:01:00.000Z",
);

function createJob(
  jobType: ClaimedProcessingJob["jobType"],
  options: { attemptCount?: number; finalAttempt?: boolean } = {},
): ClaimedProcessingJob {
  return {
    attemptCount: options.attemptCount ?? 1,
    availableAt: new Date("2026-08-24T10:00:00.000Z"),
    finalAttempt: options.finalAttempt ?? false,
    jobId: "11111111-1111-4111-8111-111111111111",
    jobType,
    leaseExpiresAt: new Date("2026-08-24T10:05:00.000Z"),
    maxAttempts: 6,
    meetingId: "meeting-1",
  };
}

function createContext(initialTranscription?: TranscriptionState) {
  let transcription =
    initialTranscription ??
    markTranscriptionCompleted(
      createTranscriptionState("meeting-1", [], "2026-08-24T10:01:00.000Z"),
      "2026-08-24T10:02:00.000Z",
    );
  const refinement = markRefinementCompleted(
    createRefinementState("meeting-1", "2026-08-24T10:02:00.000Z"),
    [],
    0,
    "2026-08-24T10:03:00.000Z",
  );
  const summary = markSummaryFailed(
    createSummaryState("meeting-1", "2026-08-24T10:03:00.000Z"),
    "provider_failed",
    4,
    "2026-08-24T10:04:00.000Z",
  );
  const dependencies = {
    audioCatalog: { persist: vi.fn(async () => true) },
    finalizer: {
      cleanup: vi.fn(async () => undefined),
      persist: vi.fn(async () => undefined),
    },
    meetingStore: {
      load: vi.fn(async () => manifest),
      markArtifactsDeleted: vi.fn(async () => undefined),
      updatePipeline: vi.fn(async () => undefined),
    },
    queue: { enqueue: vi.fn(async () => true) },
    refinementStore: { tryLoad: vi.fn(async () => refinement) },
    refiner: { process: vi.fn(async () => undefined) },
    retention: {
      deleteAudio: vi.fn(async () => undefined),
      deleteWorkspace: vi.fn(async () => undefined),
    },
    summarizer: { process: vi.fn(async () => undefined) },
    summaryStore: { tryLoad: vi.fn(async () => summary) },
    transcriber: { process: vi.fn(async () => undefined) },
    transcriptionStore: {
      prepareRetry: vi.fn(async (_meetingId: string, now: string) => {
        transcription = retryFailedTranscription(transcription, now);
      }),
      tryLoad: vi.fn(async () => transcription),
    },
  };
  return { dependencies, handler: new MeetingProcessingHandler(dependencies) };
}

describe("MeetingProcessingHandler", () => {
  it("remove o áudio e enfileira o refinamento após transcrição concluída", async () => {
    const { dependencies, handler } = createContext();

    await handler.process(createJob("transcription"));

    expect(dependencies.audioCatalog.persist).toHaveBeenCalledWith(manifest);
    expect(dependencies.retention.deleteAudio).toHaveBeenCalledWith(manifest);
    expect(dependencies.queue.enqueue).toHaveBeenCalledWith("meeting-1", "refinement");
  });

  it("agenda retry durável de falha do provedor sem excluir o áudio", async () => {
    const failed = markTranscriptionFailed(
      createTranscriptionState("meeting-1", [], "2026-08-24T10:01:00.000Z"),
      "provider_failed",
      "2026-08-24T10:02:00.000Z",
    );
    const { dependencies, handler } = createContext(failed);

    await expect(handler.process(createJob("transcription", { attemptCount: 2 }))).rejects.toEqual(
      expect.objectContaining<Partial<ProcessingJobError>>({
        failureCode: "provider_unavailable",
      }),
    );

    expect(dependencies.transcriptionStore.prepareRetry).toHaveBeenCalledOnce();
    expect(dependencies.retention.deleteAudio).not.toHaveBeenCalled();
  });

  it("marca uma falha de transcrição como terminal na última tentativa", async () => {
    const failed = markTranscriptionFailed(
      createTranscriptionState("meeting-1", [], "2026-08-24T10:01:00.000Z"),
      "provider_failed",
      "2026-08-24T10:02:00.000Z",
    );
    const { dependencies, handler } = createContext(failed);

    await expect(
      handler.process(createJob("transcription", { attemptCount: 6, finalAttempt: true })),
    ).rejects.toEqual(expect.objectContaining({ failureCode: "provider_failed", terminal: true }));
    expect(dependencies.retention.deleteWorkspace).not.toHaveBeenCalled();
  });

  it("enfileira o resumo depois do refinamento terminal", async () => {
    const { dependencies, handler } = createContext();

    await handler.process(createJob("refinement"));

    expect(dependencies.refiner.process).toHaveBeenCalledWith(manifest, {
      fallbackOnProviderFailure: false,
    });
    expect(dependencies.queue.enqueue).toHaveBeenCalledWith("meeting-1", "summary");
  });

  it("delega ao worker a limpeza após a última falha do refinamento", async () => {
    const { dependencies, handler } = createContext();
    dependencies.refiner.process.mockRejectedValueOnce(new Error("provider"));

    await expect(
      handler.process(createJob("refinement", { attemptCount: 6, finalAttempt: true })),
    ).rejects.toEqual(expect.objectContaining({ failureCode: "provider_unavailable" }));

    expect(dependencies.retention.deleteWorkspace).not.toHaveBeenCalled();
  });

  it("delega ao worker a limpeza após a última falha de publicação", async () => {
    const { dependencies, handler } = createContext();
    dependencies.summarizer.process.mockRejectedValueOnce(new Error("discord"));

    await expect(
      handler.process(createJob("summary", { attemptCount: 6, finalAttempt: true })),
    ).rejects.toEqual(expect.objectContaining({ failureCode: "publication_failed" }));

    expect(dependencies.retention.deleteWorkspace).not.toHaveBeenCalled();
  });

  it("finaliza os artefatos somente depois de resumo e publicação", async () => {
    const { dependencies, handler } = createContext();

    await handler.process(createJob("summary", { finalAttempt: true }));

    expect(dependencies.summarizer.process).toHaveBeenCalledWith(manifest, {
      fallbackOnProviderFailure: true,
    });
    expect(dependencies.finalizer.persist).toHaveBeenCalledWith(manifest);
    expect(dependencies.finalizer.cleanup).not.toHaveBeenCalled();
  });
});
