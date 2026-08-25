import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

import type { ProcessingQueue } from "./durable-job-worker.js";
import type { ClaimedProcessingJob, ProcessingJobType } from "./durable-job-queue.js";

const MAX_JOB_ATTEMPTS = 6;
const DEFAULT_LEASE_MS = 5 * 60_000;
const RETRY_DELAYS_MS = [60_000, 300_000, 900_000, 3_600_000, 21_600_000] as const;

const persistedJobSchema = z.object({
  attemptCount: z.number().int().nonnegative(),
  availableAt: z.iso.datetime(),
  completedAt: z.iso.datetime().optional(),
  createdAt: z.iso.datetime(),
  jobId: z.uuid(),
  jobType: z.enum(["transcription", "refinement", "summary"]),
  lastFailureCode: z.string().min(1).max(100).optional(),
  leaseExpiresAt: z.iso.datetime().optional(),
  leaseOwner: z.string().min(1).max(128).optional(),
  maxAttempts: z.number().int().positive(),
  meetingId: z.string().min(1).max(128),
  status: z.enum(["scheduled", "active", "completed", "failed"]),
  updatedAt: z.iso.datetime(),
});

type PersistedJob = z.infer<typeof persistedJobSchema>;

const localProcessingStateSchema = z.object({
  jobs: z.array(persistedJobSchema),
  schemaVersion: z.literal(1),
  terminalMeetings: z.record(
    z.string(),
    z.object({
      artifactsDeleted: z.boolean(),
      failureCode: z.string().min(1).max(100).optional(),
      status: z.enum(["completed", "failed"]),
      updatedAt: z.iso.datetime(),
    }),
  ),
});

type LocalProcessingState = z.infer<typeof localProcessingStateSchema>;

interface LocalDurableJobQueueOptions {
  createId?: () => string;
  leaseMs?: number;
  now?: () => Date;
}

const EMPTY_STATE: LocalProcessingState = {
  jobs: [],
  schemaVersion: 1,
  terminalMeetings: {},
};

export class LocalDurableJobQueue implements ProcessingQueue {
  readonly #createId: () => string;
  readonly #filePath: string;
  readonly #leaseMs: number;
  readonly #now: () => Date;
  #operations: Promise<void> = Promise.resolve();

  public constructor(filePath: string, options: LocalDurableJobQueueOptions = {}) {
    this.#createId = options.createId ?? randomUUID;
    this.#filePath = filePath;
    this.#leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    this.#now = options.now ?? (() => new Date());
  }

  public async initialize(): Promise<void> {
    await this.#mutate((state) => {
      const now = this.#now().toISOString();
      for (const job of state.jobs) {
        if (job.status === "active") {
          job.status = "scheduled";
          job.availableAt = now;
          job.leaseExpiresAt = undefined;
          job.leaseOwner = undefined;
          job.updatedAt = now;
        }
      }
    });
  }

  public async enqueue(meetingId: string, jobType: ProcessingJobType): Promise<boolean> {
    const validatedMeetingId = z.string().min(1).max(128).parse(meetingId);
    const validatedJobType = z.enum(["transcription", "refinement", "summary"]).parse(jobType);
    return this.#mutate((state) => {
      if (
        state.jobs.some(
          (job) => job.meetingId === validatedMeetingId && job.jobType === validatedJobType,
        )
      ) {
        return false;
      }
      const now = this.#now().toISOString();
      state.jobs.push({
        attemptCount: 0,
        availableAt: now,
        createdAt: now,
        jobId: this.#createId(),
        jobType: validatedJobType,
        maxAttempts: MAX_JOB_ATTEMPTS,
        meetingId: validatedMeetingId,
        status: "scheduled",
        updatedAt: now,
      });
      return true;
    });
  }

  public async claim(workerId: string): Promise<ClaimedProcessingJob | undefined> {
    const validatedWorkerId = z.string().min(1).max(128).parse(workerId);
    return this.#mutate((state) => {
      const now = this.#now();
      const nowIso = now.toISOString();
      const job = state.jobs
        .filter(
          (candidate) =>
            (candidate.status === "scheduled" && candidate.availableAt <= nowIso) ||
            (candidate.status === "active" &&
              candidate.leaseExpiresAt !== undefined &&
              candidate.leaseExpiresAt <= nowIso),
        )
        .sort(
          (left, right) =>
            left.availableAt.localeCompare(right.availableAt) ||
            left.createdAt.localeCompare(right.createdAt),
        )[0];
      if (job === undefined) {
        return undefined;
      }
      job.status = "active";
      job.attemptCount += 1;
      job.leaseOwner = validatedWorkerId;
      job.leaseExpiresAt = new Date(now.getTime() + this.#leaseMs).toISOString();
      job.updatedAt = nowIso;
      return toClaimedJob(job);
    });
  }

  public async complete(job: ClaimedProcessingJob, workerId: string): Promise<void> {
    await this.#mutate((state) => {
      const persisted = findOwnedActiveJob(state, job.jobId, workerId);
      if (persisted === undefined) return;
      const now = this.#now().toISOString();
      persisted.status = "completed";
      persisted.completedAt = now;
      persisted.leaseExpiresAt = undefined;
      persisted.leaseOwner = undefined;
      persisted.updatedAt = now;
      if (persisted.jobType === "summary") {
        state.terminalMeetings[persisted.meetingId] = {
          artifactsDeleted: false,
          status: "completed",
          updatedAt: now,
        };
      }
    });
  }

  public async renew(job: ClaimedProcessingJob, workerId: string): Promise<void> {
    await this.#mutate((state) => {
      const persisted = findOwnedActiveJob(state, job.jobId, workerId);
      if (persisted === undefined) return;
      const now = this.#now();
      persisted.leaseExpiresAt = new Date(now.getTime() + this.#leaseMs).toISOString();
      persisted.updatedAt = now.toISOString();
    });
  }

  public async fail(
    job: ClaimedProcessingJob,
    failureCode: string,
    workerId: string,
    terminal = false,
  ): Promise<"failed" | "scheduled"> {
    const validatedFailureCode = z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9_]+$/)
      .parse(failureCode);
    return this.#mutate((state) => {
      const persisted = findOwnedActiveJob(state, job.jobId, workerId);
      const now = this.#now();
      if (persisted === undefined) {
        return terminal || job.finalAttempt ? "failed" : "scheduled";
      }
      persisted.lastFailureCode = validatedFailureCode;
      persisted.leaseExpiresAt = undefined;
      persisted.leaseOwner = undefined;
      persisted.updatedAt = now.toISOString();
      if (terminal || job.finalAttempt || job.attemptCount >= job.maxAttempts) {
        persisted.status = "failed";
        state.terminalMeetings[persisted.meetingId] = {
          artifactsDeleted: false,
          failureCode: validatedFailureCode,
          status: "failed",
          updatedAt: now.toISOString(),
        };
        return "failed";
      }
      const delayMs = RETRY_DELAYS_MS[job.attemptCount - 1];
      if (delayMs === undefined) {
        throw new Error("A política de retry não cobre a tentativa atual");
      }
      persisted.status = "scheduled";
      persisted.availableAt = new Date(now.getTime() + delayMs).toISOString();
      return "scheduled";
    });
  }

  public async listTerminalMeetingIds(): Promise<string[]> {
    return this.#read((state) =>
      Object.entries(state.terminalMeetings)
        .filter(([, terminal]) => !terminal.artifactsDeleted)
        .map(([meetingId]) => meetingId)
        .sort(),
    );
  }

  public async markArtifactsDeleted(meetingId: string): Promise<void> {
    const validatedMeetingId = z.string().min(1).max(128).parse(meetingId);
    await this.#mutate((state) => {
      const terminal = state.terminalMeetings[validatedMeetingId];
      if (terminal !== undefined) {
        terminal.artifactsDeleted = true;
        terminal.updatedAt = this.#now().toISOString();
      }
    });
  }

  async #read<T>(read: (state: LocalProcessingState) => T): Promise<T> {
    const previous = this.#operations;
    let result: { value: T } | undefined;
    const operation = previous.then(async () => {
      result = { value: read(await this.#load()) };
    });
    this.#operations = operation.catch(() => undefined);
    await operation;
    if (result === undefined) throw new Error("A leitura do estado local não foi concluída");
    return result.value;
  }

  async #mutate<T>(update: (state: LocalProcessingState) => T): Promise<T> {
    const previous = this.#operations;
    let result: { value: T } | undefined;
    const operation = previous.then(async () => {
      const state = await this.#load();
      result = { value: update(state) };
      await this.#write(state);
    });
    this.#operations = operation.catch(() => undefined);
    await operation;
    if (result === undefined) throw new Error("A atualização do estado local não foi concluída");
    return result.value;
  }

  async #load(): Promise<LocalProcessingState> {
    try {
      const content = await readFile(this.#filePath, "utf8");
      const parsed: unknown = JSON.parse(content);
      return localProcessingStateSchema.parse(parsed);
    } catch (error) {
      if (isFileNotFound(error)) return structuredClone(EMPTY_STATE);
      throw error;
    }
  }

  async #write(state: LocalProcessingState): Promise<void> {
    const validated = localProcessingStateSchema.parse(state);
    const directory = dirname(this.#filePath);
    const temporaryPath = `${this.#filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, this.#filePath);
  }
}

function findOwnedActiveJob(
  state: LocalProcessingState,
  jobId: string,
  workerId: string,
): PersistedJob | undefined {
  return state.jobs.find(
    (job) => job.jobId === jobId && job.status === "active" && job.leaseOwner === workerId,
  );
}

function toClaimedJob(job: PersistedJob): ClaimedProcessingJob {
  if (job.leaseExpiresAt === undefined) {
    throw new Error("Job ativo sem lease persistido");
  }
  return {
    attemptCount: job.attemptCount,
    availableAt: new Date(job.availableAt),
    finalAttempt: job.attemptCount >= job.maxAttempts,
    jobId: job.jobId,
    jobType: job.jobType,
    leaseExpiresAt: new Date(job.leaseExpiresAt),
    maxAttempts: job.maxAttempts,
    meetingId: job.meetingId,
  };
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
