import type { RecordingManifest } from "../recording/manifest.js";
import type { TranscriptionState } from "../transcription/transcription-state.js";

export interface MeetingContentStore {
  persist(input: {
    manifest: RecordingManifest;
    meetingId: string;
    publication: unknown;
    rawTranscript: string;
    summary: unknown;
    transcript: string;
  }): Promise<boolean>;
  persistPublication(meetingId: string, publication: unknown): Promise<void>;
}

interface FinalizationTranscriptionStore {
  readRawTranscript(meetingId: string): Promise<string>;
  readTranscript(meetingId: string): Promise<string>;
  load?(meetingId: string): Promise<TranscriptionState>;
}

interface ParticipationStore {
  persistParticipation(
    manifest: RecordingManifest,
    transcription: TranscriptionState,
  ): Promise<void>;
}

interface FinalizationSummaryStore {
  load(meetingId: string): Promise<unknown>;
}

interface FinalizationPublicationStore {
  load(meetingId: string): Promise<unknown>;
}

interface FinalizationRetention {
  deleteWorkspace(manifest: RecordingManifest): Promise<void>;
}

interface FinalizationManifestStore {
  tryLoad(meetingId: string): Promise<RecordingManifest | undefined>;
}

interface MeetingFinalizerOptions {
  contentStore: MeetingContentStore;
  manifestStore: FinalizationManifestStore;
  participationStore?: ParticipationStore;
  publicationStore: FinalizationPublicationStore;
  retention: FinalizationRetention;
  summaryStore: FinalizationSummaryStore;
  transcriptionStore: FinalizationTranscriptionStore;
}

export class MeetingFinalizer {
  readonly #contentStore: MeetingContentStore;
  readonly #manifestStore: FinalizationManifestStore;
  readonly #publicationStore: FinalizationPublicationStore;
  readonly #participationStore: ParticipationStore | undefined;
  readonly #retention: FinalizationRetention;
  readonly #summaryStore: FinalizationSummaryStore;
  readonly #transcriptionStore: FinalizationTranscriptionStore;

  public constructor(options: MeetingFinalizerOptions) {
    this.#contentStore = options.contentStore;
    this.#manifestStore = options.manifestStore;
    this.#publicationStore = options.publicationStore;
    this.#participationStore = options.participationStore;
    this.#retention = options.retention;
    this.#summaryStore = options.summaryStore;
    this.#transcriptionStore = options.transcriptionStore;
  }

  public async persist(manifest: RecordingManifest): Promise<void> {
    const { meetingId } = manifest;
    if (this.#participationStore !== undefined) {
      if (this.#transcriptionStore.load === undefined) {
        throw new Error("The transcription state loader is required for talk time");
      }
      const transcription = await this.#transcriptionStore.load(meetingId);
      if (transcription.wordTimingAvailable) {
        await this.#participationStore.persistParticipation(manifest, transcription);
      }
    }
    const publication = await this.#publicationStore.load(meetingId);
    await this.#contentStore.persistPublication(meetingId, publication);
    if (manifest.persistMeetingContent) {
      const [rawTranscript, transcript, summary] = await Promise.all([
        this.#transcriptionStore.readRawTranscript(meetingId),
        this.#transcriptionStore.readTranscript(meetingId),
        this.#summaryStore.load(meetingId),
      ]);
      await this.#contentStore.persist({
        manifest,
        meetingId,
        publication,
        rawTranscript,
        summary,
        transcript,
      });
    }
  }

  public async cleanup(meetingId: string): Promise<void> {
    const manifest = await this.#manifestStore.tryLoad(meetingId);
    if (manifest === undefined) return;
    await this.#retention.deleteWorkspace(manifest);
  }
}
