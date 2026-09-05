import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, win32 } from "node:path";

import {
  retryFailedTranscription,
  type TranscriptionState,
  transcriptionStateSchema,
} from "./transcription-state.js";

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export class TranscriptionStore {
  readonly #rootDirectory: string;
  readonly #writeQueues = new Map<string, Promise<void>>();

  public constructor(rootDirectory: string) {
    this.#rootDirectory = resolve(rootDirectory);
  }

  public meetingDirectory(meetingId: string): string {
    this.#assertIdentifier(meetingId);
    return resolve(this.#rootDirectory, meetingId);
  }

  public resolveMeetingFile(meetingId: string, relativePath: string): string {
    if (relativePath.length === 0 || isAbsolute(relativePath) || win32.isAbsolute(relativePath)) {
      throw new Error("O caminho deve permanecer dentro do diretório da reunião");
    }
    const directory = this.meetingDirectory(meetingId);
    const resolved = resolve(directory, relativePath);
    const pathFromMeeting = relative(directory, resolved);
    if (
      pathFromMeeting.length === 0 ||
      pathFromMeeting === ".." ||
      pathFromMeeting.startsWith(`..\\`) ||
      pathFromMeeting.startsWith("../")
    ) {
      throw new Error("O caminho deve permanecer dentro do diretório da reunião");
    }
    return resolved;
  }

  public transcriptPath(meetingId: string): string {
    return this.resolveMeetingFile(meetingId, "transcript.txt");
  }

  public rawTranscriptPath(meetingId: string): string {
    return this.resolveMeetingFile(meetingId, "transcript.raw.txt");
  }

  public async readTranscript(meetingId: string): Promise<string> {
    return readFile(this.transcriptPath(meetingId), "utf8");
  }

  public async readRawTranscript(meetingId: string): Promise<string> {
    return readFile(this.rawTranscriptPath(meetingId), "utf8");
  }

  public async preserveRawTranscript(meetingId: string): Promise<string> {
    try {
      return await readFile(this.rawTranscriptPath(meetingId), "utf8");
    } catch (error) {
      if (!isFileNotFound(error)) {
        throw error;
      }
    }
    const directory = this.meetingDirectory(meetingId);
    const temporaryPath = this.resolveMeetingFile(
      meetingId,
      `transcript.raw.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
    );
    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, await readFile(this.transcriptPath(meetingId)), { flag: "wx" });
    try {
      await link(temporaryPath, this.rawTranscriptPath(meetingId));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
        throw error;
      }
    } finally {
      await rm(temporaryPath, { force: true });
    }
    return readFile(this.rawTranscriptPath(meetingId), "utf8");
  }

  public async save(state: TranscriptionState): Promise<void> {
    const validated = transcriptionStateSchema.parse(state);
    const previous = this.#writeQueues.get(validated.meetingId) ?? Promise.resolve();
    const operation = previous.then(() => this.#writeState(validated));
    const queued = operation.catch(() => undefined);
    this.#writeQueues.set(validated.meetingId, queued);
    try {
      await operation;
    } finally {
      if (this.#writeQueues.get(validated.meetingId) === queued) {
        this.#writeQueues.delete(validated.meetingId);
      }
    }
  }

  public async load(meetingId: string): Promise<TranscriptionState> {
    const pending = this.#writeQueues.get(meetingId);
    if (pending !== undefined) {
      await pending;
    }
    const content = await readFile(
      this.resolveMeetingFile(meetingId, "transcription.json"),
      "utf8",
    );
    const parsed: unknown = JSON.parse(content);
    return transcriptionStateSchema.parse(parsed);
  }

  public async tryLoad(meetingId: string): Promise<TranscriptionState | undefined> {
    try {
      return await this.load(meetingId);
    } catch (error) {
      if (isFileNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  public async writeTranscript(meetingId: string, transcript: string): Promise<void> {
    const directory = this.meetingDirectory(meetingId);
    const finalPath = this.transcriptPath(meetingId);
    const temporaryPath = this.resolveMeetingFile(
      meetingId,
      `transcript.${process.pid}.${Date.now()}.tmp`,
    );
    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, transcript, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, finalPath);
  }

  public async removeTranscript(meetingId: string): Promise<void> {
    await rm(this.transcriptPath(meetingId), { force: true });
  }

  public async prepareRetry(meetingId: string, now: string): Promise<void> {
    const state = await this.load(meetingId);
    await this.save(retryFailedTranscription(state, now));
  }

  async #writeState(state: TranscriptionState): Promise<void> {
    const directory = this.meetingDirectory(state.meetingId);
    const finalPath = this.resolveMeetingFile(state.meetingId, "transcription.json");
    const temporaryPath = this.resolveMeetingFile(
      state.meetingId,
      `transcription.${process.pid}.${Date.now()}.tmp`,
    );
    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, finalPath);
  }

  #assertIdentifier(identifier: string): void {
    if (!SAFE_IDENTIFIER.test(identifier)) {
      throw new Error("Identificador de armazenamento inválido");
    }
  }
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
