import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { RecordingManifest } from "../recording/manifest.js";
import { createMeetingAudioCatalog, type MeetingAudioCatalog } from "./meeting-audio-catalog.js";

export class LocalMeetingAudioCatalog implements MeetingAudioCatalog {
  readonly #recordingsDirectory: string;

  public constructor(recordingsDirectory: string) {
    this.#recordingsDirectory = resolve(recordingsDirectory);
  }

  public async persist(manifest: RecordingManifest): Promise<boolean> {
    if (!manifest.persistMeetingAudio || manifest.storageMode !== "local") return false;
    const catalog = createMeetingAudioCatalog(manifest);
    const directory = resolve(this.#recordingsDirectory, catalog.meetingId);
    const finalPath = resolve(directory, "audio-manifest.json");
    const temporaryPath = resolve(
      directory,
      `audio-manifest.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
    );
    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(catalog, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, finalPath);
    return true;
  }
}
