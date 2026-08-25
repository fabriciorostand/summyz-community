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
      this.#logger.info({ meetingId: manifest.meetingId }, "Áudios da reunião preservados");
      return;
    }
    const participantsDirectory = this.#store.resolveMeetingFile(
      manifest.meetingId,
      "participants",
    );
    await rm(participantsDirectory, { force: true, recursive: true });
    this.#logger.info(
      { meetingId: manifest.meetingId, segmentCount: manifest.segments.length },
      "Áudios temporários da reunião excluídos",
    );
  }

  public async deleteWorkspace(manifest: RecordingManifest): Promise<void> {
    const { meetingId, persistMeetingAudio: retainAudio } = manifest;
    const retainLocalContent = manifest.storageMode === "local" && manifest.persistMeetingContent;
    if (retainAudio && retainLocalContent) {
      this.#logger.info({ meetingId }, "Conteúdo e áudios da reunião preservados");
      return;
    }
    const directory = this.#store.meetingDirectory(meetingId);
    if (retainLocalContent) {
      await rm(resolve(directory, "participants"), { force: true, recursive: true });
      await rm(resolve(directory, "audio-manifest.json"), { force: true });
      this.#logger.info({ meetingId }, "Áudios da reunião excluídos; conteúdo preservado");
      return;
    }

    const entries = await listEntries(directory);
    if (entries === undefined) return;
    const retainedEntries = retainAudio
      ? ["participants", ...(manifest.storageMode === "local" ? ["audio-manifest.json"] : [])]
      : [];
    await Promise.all(
      entries
        .filter((entry) => entry !== "manifest.json" && !retainedEntries.includes(entry))
        .map((entry) => rm(resolve(directory, entry), { force: true, recursive: true })),
    );
    // O manifesto é removido por último para que uma queda permita repetir a mesma política.
    await rm(resolve(directory, "manifest.json"), { force: true });
    if (retainAudio) {
      this.#logger.info({ meetingId }, "Conteúdo temporário excluído; áudios preservados");
      return;
    }
    await rm(directory, { force: true, recursive: true });
    this.#logger.info({ meetingId }, "Artefatos temporários da reunião excluídos");
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
