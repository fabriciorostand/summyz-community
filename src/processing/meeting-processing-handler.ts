import type { MeetingPipelineStatus } from "../database/postgres-meeting-store.js";
import type { RecordingManifest } from "../recording/manifest.js";
import type { RefinementState } from "../refinement/refinement-state.js";
import type { SummaryState } from "../summary/summary-state.js";
import type { TranscriptionState } from "../transcription/transcription-state.js";
import type { ClaimedProcessingJob, ProcessingJobType } from "./durable-job-queue.js";
import { ProcessingJobError, type ProcessingJobHandler } from "./durable-job-worker.js";
import type { MeetingAudioCatalog } from "./meeting-audio-catalog.js";

interface MeetingStore {
  load(meetingId: string): Promise<RecordingManifest>;
  markArtifactsDeleted(meetingId: string): Promise<void>;
  updatePipeline(
    meetingId: string,
    status: MeetingPipelineStatus,
    failureCode?: string,
  ): Promise<void>;
}

interface StageQueue {
  enqueue(meetingId: string, jobType: ProcessingJobType): Promise<boolean>;
}

interface TranscriptionProcessor {
  process(
    manifest: RecordingManifest,
    options?: { notifyTerminalFailure?: boolean },
  ): Promise<void>;
}

interface RefinementProcessor {
  process(
    manifest: RecordingManifest,
    options?: { fallbackOnProviderFailure?: boolean },
  ): Promise<void>;
}

interface SummaryProcessor {
  process(
    manifest: RecordingManifest,
    options?: { fallbackOnProviderFailure?: boolean },
  ): Promise<void>;
}

interface TranscriptionStateStore {
  prepareRetry(meetingId: string, now: string): Promise<void>;
  tryLoad(meetingId: string): Promise<TranscriptionState | undefined>;
}

interface RefinementStateStore {
  tryLoad(meetingId: string): Promise<RefinementState | undefined>;
}

interface SummaryStateStore {
  tryLoad(meetingId: string): Promise<SummaryState | undefined>;
}

interface ArtifactRetention {
  deleteAudio(manifest: RecordingManifest): Promise<void>;
}

interface MeetingFinalizer {
  cleanup(meetingId: string): Promise<void>;
  persist(manifest: RecordingManifest): Promise<void>;
}

interface MeetingProcessingHandlerOptions {
  audioCatalog: MeetingAudioCatalog;
  finalizer: MeetingFinalizer;
  meetingStore: MeetingStore;
  now?: () => Date;
  queue: StageQueue;
  refinementStore: RefinementStateStore;
  refiner: RefinementProcessor;
  retention: ArtifactRetention;
  summarizer: SummaryProcessor;
  summaryStore: SummaryStateStore;
  transcriber: TranscriptionProcessor;
  transcriptionStore: TranscriptionStateStore;
}

export class MeetingProcessingHandler implements ProcessingJobHandler {
  readonly #audioCatalog: MeetingAudioCatalog;
  readonly #finalizer: MeetingFinalizer;
  readonly #meetingStore: MeetingStore;
  readonly #now: () => Date;
  readonly #queue: StageQueue;
  readonly #refinementStore: RefinementStateStore;
  readonly #refiner: RefinementProcessor;
  readonly #retention: ArtifactRetention;
  readonly #summarizer: SummaryProcessor;
  readonly #summaryStore: SummaryStateStore;
  readonly #transcriber: TranscriptionProcessor;
  readonly #transcriptionStore: TranscriptionStateStore;

  public constructor(options: MeetingProcessingHandlerOptions) {
    this.#audioCatalog = options.audioCatalog;
    this.#finalizer = options.finalizer;
    this.#meetingStore = options.meetingStore;
    this.#now = options.now ?? (() => new Date());
    this.#queue = options.queue;
    this.#refinementStore = options.refinementStore;
    this.#refiner = options.refiner;
    this.#retention = options.retention;
    this.#summarizer = options.summarizer;
    this.#summaryStore = options.summaryStore;
    this.#transcriber = options.transcriber;
    this.#transcriptionStore = options.transcriptionStore;
  }

  public async process(job: ClaimedProcessingJob): Promise<void> {
    const manifest = await this.#meetingStore.load(job.meetingId);
    if (job.jobType === "transcription") {
      await this.#processTranscription(job, manifest);
      return;
    }
    if (job.jobType === "refinement") {
      await this.#processRefinement(job, manifest);
      return;
    }
    await this.#processSummary(job, manifest);
  }

  public async cleanup(meetingId: string): Promise<void> {
    await this.#finalizer.cleanup(meetingId);
    await this.#meetingStore.markArtifactsDeleted(meetingId);
  }

  async #processTranscription(
    job: ClaimedProcessingJob,
    manifest: RecordingManifest,
  ): Promise<void> {
    await this.#audioCatalog.persist(manifest);
    await this.#meetingStore.updatePipeline(job.meetingId, "transcribing");
    const previous = await this.#transcriptionStore.tryLoad(job.meetingId);
    if (previous?.status === "failed" && previous.failureCode === "provider_failed") {
      await this.#transcriptionStore.prepareRetry(job.meetingId, this.#now().toISOString());
    }
    await this.#transcriber.process(manifest, {
      notifyTerminalFailure: job.finalAttempt,
    });
    const state = await this.#transcriptionStore.tryLoad(job.meetingId);
    if (state?.status === "completed") {
      await this.#retention.deleteAudio(manifest);
      await this.#queue.enqueue(job.meetingId, "refinement");
      await this.#meetingStore.updatePipeline(job.meetingId, "refining");
      return;
    }

    const failureCode = state?.status === "failed" ? state.failureCode : previous?.failureCode;
    if (failureCode === "provider_failed" && !job.finalAttempt) {
      throw new ProcessingJobError("provider_unavailable");
    }
    const terminalCode = failureCode ?? "transcription_incomplete";
    throw new ProcessingJobError(terminalCode, true);
  }

  async #processRefinement(job: ClaimedProcessingJob, manifest: RecordingManifest): Promise<void> {
    await this.#meetingStore.updatePipeline(job.meetingId, "refining");
    try {
      await this.#refiner.process(manifest, {
        fallbackOnProviderFailure: job.finalAttempt,
      });
    } catch {
      throw new ProcessingJobError("provider_unavailable");
    }
    const state = await this.#refinementStore.tryLoad(job.meetingId);
    if (state?.status !== "completed" && state?.status !== "fallback") {
      throw new ProcessingJobError("refinement_incomplete");
    }
    await this.#queue.enqueue(job.meetingId, "summary");
    await this.#meetingStore.updatePipeline(job.meetingId, "summarizing");
  }

  async #processSummary(job: ClaimedProcessingJob, manifest: RecordingManifest): Promise<void> {
    await this.#meetingStore.updatePipeline(job.meetingId, "summarizing");
    try {
      await this.#summarizer.process(manifest, {
        fallbackOnProviderFailure: job.finalAttempt,
      });
    } catch {
      const state = await this.#summaryStore.tryLoad(job.meetingId);
      const failureCode =
        state?.status === "processing" ? "provider_unavailable" : "publication_failed";
      throw new ProcessingJobError(failureCode);
    }
    await this.#finalizer.persist(manifest);
  }
}
