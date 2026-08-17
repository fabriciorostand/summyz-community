import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { type SummaryState, summaryStateSchema } from "./summary-state.js";

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export class SummaryStore {
  readonly #rootDirectory: string;
  readonly #writeQueues = new Map<string, Promise<void>>();

  public constructor(rootDirectory: string) {
    this.#rootDirectory = resolve(rootDirectory);
  }

  public meetingDirectory(meetingId: string): string {
    this.#assertIdentifier(meetingId);
    return resolve(this.#rootDirectory, meetingId);
  }

  public path(meetingId: string): string {
    return resolve(this.meetingDirectory(meetingId), "summary.json");
  }

  public async save(state: SummaryState): Promise<void> {
    const validated = summaryStateSchema.parse(state);
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

  public async load(meetingId: string): Promise<SummaryState> {
    const pending = this.#writeQueues.get(meetingId);
    if (pending !== undefined) {
      await pending;
    }
    const content = await readFile(this.path(meetingId), "utf8");
    const parsed: unknown = JSON.parse(content);
    return summaryStateSchema.parse(parsed);
  }

  public async tryLoad(meetingId: string): Promise<SummaryState | undefined> {
    try {
      return await this.load(meetingId);
    } catch (error) {
      if (isFileNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async #write(state: SummaryState): Promise<void> {
    const directory = this.meetingDirectory(state.meetingId);
    const temporaryPath = resolve(
      directory,
      `summary.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
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
