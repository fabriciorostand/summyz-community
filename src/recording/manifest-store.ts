import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { type RecordingManifest, recordingManifestSchema } from "./manifest.js";

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export class ManifestStore {
  readonly #rootDirectory: string;
  readonly #writeQueues = new Map<string, Promise<void>>();

  public constructor(rootDirectory: string) {
    this.#rootDirectory = resolve(rootDirectory);
  }

  public meetingDirectory(meetingId: string): string {
    this.#assertIdentifier(meetingId);
    return this.#resolveInsideRoot(meetingId);
  }

  public segmentPaths(
    meetingId: string,
    userId: string,
    segmentId: string,
  ): {
    finalPath: string;
    relativeFinalPath: string;
    relativeTemporaryPath: string;
    temporaryPath: string;
  } {
    this.#assertIdentifier(meetingId);
    this.#assertIdentifier(userId);
    this.#assertIdentifier(segmentId);
    const relativeDirectory = join("participants", userId);
    const relativeFinalPath = join(relativeDirectory, `${segmentId}.ogg`).replaceAll("\\", "/");
    const relativeTemporaryPath = join(relativeDirectory, `${segmentId}.pcm`).replaceAll("\\", "/");
    const meetingDirectory = this.meetingDirectory(meetingId);

    return {
      finalPath: resolve(meetingDirectory, relativeFinalPath),
      relativeFinalPath,
      relativeTemporaryPath,
      temporaryPath: resolve(meetingDirectory, relativeTemporaryPath),
    };
  }

  public async prepareSegmentDirectory(meetingId: string, userId: string): Promise<void> {
    this.#assertIdentifier(userId);
    await mkdir(resolve(this.meetingDirectory(meetingId), "participants", userId), {
      recursive: true,
    });
  }

  public async save(manifest: RecordingManifest): Promise<void> {
    const validated = recordingManifestSchema.parse(manifest);
    const previous = this.#writeQueues.get(validated.meetingId) ?? Promise.resolve();
    const operation = previous.then(() => this.#write(validated));
    const queuedOperation = operation.catch(() => undefined);
    this.#writeQueues.set(validated.meetingId, queuedOperation);

    try {
      await operation;
    } finally {
      if (this.#writeQueues.get(validated.meetingId) === queuedOperation) {
        this.#writeQueues.delete(validated.meetingId);
      }
    }
  }

  public async load(meetingId: string): Promise<RecordingManifest> {
    const currentWrite = this.#writeQueues.get(meetingId);
    if (currentWrite !== undefined) {
      await currentWrite;
    }
    const content = await readFile(join(this.meetingDirectory(meetingId), "manifest.json"), "utf8");
    return recordingManifestSchema.parse(JSON.parse(content));
  }

  public async listRecoverable(): Promise<RecordingManifest[]> {
    let entries: Dirent<string>[];
    try {
      entries = await readdir(this.#rootDirectory, { withFileTypes: true, encoding: "utf8" });
    } catch (error) {
      if (isFileNotFound(error)) {
        return [];
      }
      throw error;
    }

    const manifests = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && SAFE_IDENTIFIER.test(entry.name))
        .map(async (entry) => {
          try {
            return await this.load(entry.name);
          } catch (error) {
            if (isFileNotFound(error)) {
              return undefined;
            }
            throw error;
          }
        }),
    );

    return manifests.filter(
      (manifest): manifest is RecordingManifest =>
        manifest !== undefined && manifest.status !== "completed",
    );
  }

  async #write(manifest: RecordingManifest): Promise<void> {
    const directory = this.meetingDirectory(manifest.meetingId);
    const manifestPath = join(directory, "manifest.json");
    const temporaryPath = join(directory, `manifest.${process.pid}.${Date.now()}.tmp`);

    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, manifestPath);
  }

  #assertIdentifier(identifier: string): void {
    if (!SAFE_IDENTIFIER.test(identifier)) {
      throw new Error("Identificador de armazenamento inválido");
    }
  }

  #resolveInsideRoot(...parts: string[]): string {
    const resolved = resolve(this.#rootDirectory, ...parts);
    const relativePath = relative(this.#rootDirectory, resolved);
    if (relativePath.startsWith("..") || relativePath === "") {
      if (relativePath !== "") {
        throw new Error("O caminho deve permanecer dentro do diretório de gravações");
      }
    }
    return resolved;
  }
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
