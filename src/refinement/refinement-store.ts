import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { type RefinementState, refinementStateSchema } from "./refinement-state.js";

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export class RefinementStore {
  readonly #rootDirectory: string;
  readonly #writeQueues = new Map<string, Promise<void>>();

  public constructor(rootDirectory: string) {
    this.#rootDirectory = resolve(rootDirectory);
  }

  public meetingDirectory(meetingId: string): string {
    if (!SAFE_IDENTIFIER.test(meetingId)) {
      throw new Error("Identificador de armazenamento inválido");
    }
    return resolve(this.#rootDirectory, meetingId);
  }

  public path(meetingId: string): string {
    return resolve(this.meetingDirectory(meetingId), "refinement.json");
  }

  public async save(state: RefinementState): Promise<void> {
    const validated = refinementStateSchema.parse(state);
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

  public async load(meetingId: string): Promise<RefinementState> {
    const pending = this.#writeQueues.get(meetingId);
    if (pending !== undefined) {
      await pending;
    }
    const content = await readFile(this.path(meetingId), "utf8");
    const parsed: unknown = JSON.parse(content);
    return refinementStateSchema.parse(parsed);
  }

  public async tryLoad(meetingId: string): Promise<RefinementState | undefined> {
    try {
      return await this.load(meetingId);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async #write(state: RefinementState): Promise<void> {
    const directory = this.meetingDirectory(state.meetingId);
    const temporaryPath = resolve(
      directory,
      `refinement.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
    );
    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, this.path(state.meetingId));
  }
}
