import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import {
  type CostAttempt,
  costAttemptSchema,
  type CostLedgerStore,
  type CostMeetingRange,
  type CostMeetingRecord,
  costMeetingRecordSchema,
  type CostMeetingWithAttempts,
  toCostMeetingRecord,
} from "./cost-ledger.js";
import type { RecordingManifest } from "../recording/manifest.js";

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export class LocalCostLedgerStore implements CostLedgerStore {
  readonly #rootDirectory: string;
  readonly #meetingWrites = new Map<string, Promise<void>>();

  public constructor(rootDirectory: string) {
    this.#rootDirectory = resolve(rootDirectory);
  }

  public async saveMeeting(manifest: RecordingManifest): Promise<void> {
    const meeting = toCostMeetingRecord(manifest);
    const key = `${meeting.guildId}:${meeting.meetingId}`;
    const previous = this.#meetingWrites.get(key) ?? Promise.resolve();
    const operation = previous.then(() => this.#writeJson(this.#meetingPath(meeting), meeting));
    const queued = operation.catch(() => undefined);
    this.#meetingWrites.set(key, queued);
    try {
      await operation;
    } finally {
      if (this.#meetingWrites.get(key) === queued) this.#meetingWrites.delete(key);
    }
  }

  public async saveAttempt(attempt: CostAttempt): Promise<void> {
    const validated = costAttemptSchema.parse(attempt);
    const path = this.#inside(
      "guilds",
      validated.guildId,
      "meetings",
      validated.meetingId,
      validated.phase,
      `${validated.attemptId}.json`,
    );
    await this.#writeJson(path, validated);
  }

  public async getMeeting(
    guildId: string,
    meetingId: string,
  ): Promise<CostMeetingWithAttempts | undefined> {
    this.#assertIdentifier(guildId);
    this.#assertIdentifier(meetingId);
    const meeting = await this.#readMeeting(this.#meetingPath({ guildId, meetingId }));
    if (meeting === undefined) return undefined;
    return { attempts: await this.#readAttempts(meeting), meeting };
  }

  public async listMeetings(
    guildId: string,
    range: CostMeetingRange,
  ): Promise<CostMeetingWithAttempts[]> {
    this.#assertIdentifier(guildId);
    const root = this.#inside("guilds", guildId, "meetings");
    const entries = await listDirectories(root);
    const meetings = await Promise.all(
      entries.map((entry) => this.#readMeeting(join(root, entry.name, "meeting.json"))),
    );
    const selected = meetings.filter(
      (meeting): meeting is CostMeetingRecord =>
        meeting !== undefined &&
        meeting.startedAt >= range.startedAtOrAfter &&
        meeting.startedAt < range.endedBefore,
    );
    return Promise.all(
      selected.map(async (meeting) => ({
        attempts: await this.#readAttempts(meeting),
        meeting,
      })),
    );
  }

  public async listReconciliationCandidates(guildId?: string): Promise<CostAttempt[]> {
    const candidates: CostAttempt[] = [];
    const guildRoot = this.#inside("guilds");
    const guildNames =
      guildId === undefined
        ? (await listDirectories(guildRoot)).map((entry) => entry.name)
        : [guildId];
    for (const guildName of guildNames) {
      const meetingRoot = this.#inside("guilds", guildName, "meetings");
      for (const meetingEntry of await listDirectories(meetingRoot)) {
        const meeting = await this.#readMeeting(
          join(meetingRoot, meetingEntry.name, "meeting.json"),
        );
        if (meeting === undefined) continue;
        const attempts = await this.#readAttempts(meeting);
        candidates.push(
          ...attempts.filter(
            (attempt) =>
              attempt.provider === "openrouter" &&
              attempt.generationId !== null &&
              (attempt.financialStatus === "pending" || attempt.model === null),
          ),
        );
      }
    }
    return candidates;
  }

  async #readAttempts(meeting: CostMeetingRecord): Promise<CostAttempt[]> {
    const attempts: CostAttempt[] = [];
    for (const phase of ["transcription", "refinement", "summary"] as const) {
      const directory = this.#inside(
        "guilds",
        meeting.guildId,
        "meetings",
        meeting.meetingId,
        phase,
      );
      for (const entry of await listFiles(directory)) {
        if (!entry.name.endsWith(".json")) continue;
        const content = await readFile(join(directory, entry.name), "utf8");
        const attempt = costAttemptSchema.parse(JSON.parse(content));
        if (attempt.guildId !== meeting.guildId || attempt.meetingId !== meeting.meetingId) {
          throw new Error("O lançamento financeiro não pertence ao diretório informado");
        }
        attempts.push(attempt);
      }
    }
    return attempts.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  }

  async #readMeeting(path: string): Promise<CostMeetingRecord | undefined> {
    try {
      return costMeetingRecordSchema.parse(JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
      if (isFileNotFound(error)) return undefined;
      throw error;
    }
  }

  #meetingPath(input: Pick<CostMeetingRecord, "guildId" | "meetingId">): string {
    return this.#inside("guilds", input.guildId, "meetings", input.meetingId, "meeting.json");
  }

  async #writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, path);
  }

  #inside(...parts: string[]): string {
    for (const part of parts) {
      if (part !== "guilds" && part !== "meetings" && !part.endsWith(".json")) {
        if (!["transcription", "refinement", "summary"].includes(part)) {
          this.#assertIdentifier(part);
        }
      }
    }
    const path = resolve(this.#rootDirectory, ...parts);
    const relativePath = relative(this.#rootDirectory, path);
    if (relativePath.startsWith("..") || relativePath === "") {
      throw new Error("O caminho financeiro deve permanecer dentro do diretório configurado");
    }
    return path;
  }

  #assertIdentifier(identifier: string): void {
    if (!SAFE_IDENTIFIER.test(identifier)) throw new Error("Identificador financeiro inválido");
  }
}

async function listDirectories(path: string): Promise<Dirent<string>[]> {
  return (await listEntries(path)).filter((entry) => entry.isDirectory());
}

async function listFiles(path: string): Promise<Dirent<string>[]> {
  return (await listEntries(path)).filter((entry) => entry.isFile());
}

async function listEntries(path: string): Promise<Dirent<string>[]> {
  try {
    return await readdir(path, { encoding: "utf8", withFileTypes: true });
  } catch (error) {
    if (isFileNotFound(error)) return [];
    throw error;
  }
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
