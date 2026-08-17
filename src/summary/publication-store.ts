import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { type PublicationState, publicationStateSchema } from "./publication-state.js";

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export class PublicationStore {
  readonly #rootDirectory: string;
  readonly #writeQueues = new Map<string, Promise<void>>();

  public constructor(rootDirectory: string) {
    this.#rootDirectory = resolve(rootDirectory);
  }

  public path(meetingId: string): string {
    this.#assertIdentifier(meetingId);
    return resolve(this.#rootDirectory, meetingId, "publication.json");
  }

  public async save(state: PublicationState): Promise<void> {
    const validated = publicationStateSchema.parse(state);
    const previous = this.#writeQueues.get(validated.meetingId) ?? Promise.resolve();
    const operation = previous.then(() => this.#write(validated));
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

  public async load(meetingId: string): Promise<PublicationState> {
    const pending = this.#writeQueues.get(meetingId);
    if (pending !== undefined) {
      await pending;
    }
    const content = await readFile(this.path(meetingId), "utf8");
    const parsed: unknown = JSON.parse(content);
    return publicationStateSchema.parse(parsed);
  }

  public async tryLoad(meetingId: string): Promise<PublicationState | undefined> {
    try {
      return await this.load(meetingId);
    } catch (error) {
      if (isFileNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async #write(state: PublicationState): Promise<void> {
    const directory = resolve(this.#rootDirectory, state.meetingId);
    const temporaryPath = resolve(
      directory,
      `publication.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
    );
    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, this.path(state.meetingId));
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
