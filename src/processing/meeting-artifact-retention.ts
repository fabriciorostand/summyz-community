import { readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

import type { Logger } from "pino";

import type { RecordingManifest } from "../recording/manifest.js";
import type { TranscriptionStore } from "../transcription/transcription-store.js";

export class MeetingArtifactRetention {
  readonly #logger: Logger;
  readonly #store: TranscriptionStore;

  public constructor(store: TranscriptionStore, logger: Logger) {
    this.#logger = logger;
    this.#store = store;
  }

  public async deleteAudio(manifest: RecordingManifest): Promise<void> {
    if (manifest.persistMeetingAudio) {
      this.#logger.info({ meetingId: manifest.meetingId }, "Meeting audio preserved");
      return;
    }
    const participantsDirectory = this.#store.resolveMeetingFile(
      manifest.meetingId,
      "participants",
    );
    await rm(participantsDirectory, { force: true, recursive: true });
    this.#logger.info(
      { meetingId: manifest.meetingId, segmentCount: manifest.segments.length },
      "Temporary meeting audio deleted",
    );
  }

  public async deleteWorkspace(manifest: RecordingManifest): Promise<void> {
    const { meetingId, persistMeetingAudio: retainAudio } = manifest;
    const directory = this.#store.meetingDirectory(meetingId);
    const entries = await listEntries(directory);
    if (entries === undefined) return;
    const retainedEntries = retainAudio ? ["participants"] : [];
    await Promise.all(
      entries
        .filter((entry) => entry !== "manifest.json" && !retainedEntries.includes(entry))
        .map((entry) => rm(resolve(directory, entry), { force: true, recursive: true })),
    );
    // Remove the manifest last so the same policy can run again after a crash.
    await rm(resolve(directory, "manifest.json"), { force: true });
    if (retainAudio) {
      this.#logger.info({ meetingId }, "Temporary content deleted; audio preserved");
      return;
    }
    await rm(directory, { force: true, recursive: true });
    this.#logger.info({ meetingId }, "Temporary meeting artifacts deleted");
  }
}

async function listEntries(directory: string): Promise<string[] | undefined> {
  try {
    return await readdir(directory);
  } catch (error) {
    if (isFileNotFound(error)) return undefined;
    throw error;
  }
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
