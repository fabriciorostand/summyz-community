import { z } from "zod";

import type { MeetingPipelineStatus } from "../database/postgres-meeting-store.js";
import type { RecordingManifest } from "../recording/manifest.js";

interface LocalManifestReader {
  load(meetingId: string): Promise<RecordingManifest>;
}

interface LocalTerminalStore {
  listTerminalMeetingIds(): Promise<string[]>;
  markArtifactsDeleted(meetingId: string): Promise<void>;
}

const pipelineStatusSchema = z.enum([
  "recording",
  "queued",
  "transcribing",
  "refining",
  "summarizing",
  "publishing",
  "completed",
  "failed",
]);

export class LocalMeetingStore {
  readonly #manifestStore: LocalManifestReader;
  readonly #terminalStore: LocalTerminalStore;

  public constructor(manifestStore: LocalManifestReader, terminalStore: LocalTerminalStore) {
    this.#manifestStore = manifestStore;
    this.#terminalStore = terminalStore;
  }

  public async load(meetingId: string): Promise<RecordingManifest> {
    return this.#manifestStore.load(meetingId);
  }

  public async updatePipeline(
    meetingId: string,
    status: MeetingPipelineStatus,
    failureCode?: string,
  ): Promise<void> {
    z.string().min(1).max(128).parse(meetingId);
    pipelineStatusSchema.parse(status);
    if (failureCode !== undefined) {
      z.string()
        .min(1)
        .max(100)
        .regex(/^[a-z0-9_]+$/)
        .parse(failureCode);
    }
  }

  public async listTerminalMeetingIds(): Promise<string[]> {
    return this.#terminalStore.listTerminalMeetingIds();
  }

  public async markArtifactsDeleted(meetingId: string): Promise<void> {
    await this.#terminalStore.markArtifactsDeleted(meetingId);
  }
}
