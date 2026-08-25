import type { RecordingManifest } from "../recording/manifest.js";

export interface MeetingContentStore {
  persist(input: {
    manifest: RecordingManifest;
    meetingId: string;
    publication: unknown;
    rawTranscript: string;
    summary: unknown;
    transcript: string;
  }): Promise<boolean>;
}

interface FinalizationTranscriptionStore {
  readRawTranscript(meetingId: string): Promise<string>;
  readTranscript(meetingId: string): Promise<string>;
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
  publicationStore: FinalizationPublicationStore;
  retention: FinalizationRetention;
  summaryStore: FinalizationSummaryStore;
  transcriptionStore: FinalizationTranscriptionStore;
}

export class MeetingFinalizer {
  readonly #contentStore: MeetingContentStore;
  readonly #manifestStore: FinalizationManifestStore;
  readonly #publicationStore: FinalizationPublicationStore;
  readonly #retention: FinalizationRetention;
  readonly #summaryStore: FinalizationSummaryStore;
  readonly #transcriptionStore: FinalizationTranscriptionStore;

  public constructor(options: MeetingFinalizerOptions) {
    this.#contentStore = options.contentStore;
    this.#manifestStore = options.manifestStore;
    this.#publicationStore = options.publicationStore;
    this.#retention = options.retention;
    this.#summaryStore = options.summaryStore;
    this.#transcriptionStore = options.transcriptionStore;
  }

  public async persist(manifest: RecordingManifest): Promise<void> {
    const { meetingId } = manifest;
    if (manifest.persistMeetingContent) {
      const [rawTranscript, transcript, summary, publication] = await Promise.all([
        this.#transcriptionStore.readRawTranscript(meetingId),
        this.#transcriptionStore.readTranscript(meetingId),
        this.#summaryStore.load(meetingId),
        this.#publicationStore.load(meetingId),
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
