import { randomUUID } from "node:crypto";

import type { Logger } from "pino";
import { z } from "zod";

import type { ClaimedProcessingJob } from "./durable-job-queue.js";

export interface ProcessingQueue {
  claim(workerId: string): Promise<ClaimedProcessingJob | undefined>;
  complete(job: ClaimedProcessingJob, workerId: string): Promise<void>;
  fail(
    job: ClaimedProcessingJob,
    failureCode: string,
    workerId: string,
    terminal?: boolean,
  ): Promise<"failed" | "scheduled">;
  renew(job: ClaimedProcessingJob, workerId: string): Promise<void>;
}

export interface ProcessingJobHandler {
  cleanup?(meetingId: string): Promise<void>;
  process(job: ClaimedProcessingJob): Promise<void>;
}

export class ProcessingJobError extends Error {
  public readonly failureCode: string;
  public readonly terminal: boolean;

  public constructor(failureCode: string, terminal = false) {
    const validated = z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9_]+$/)
      .parse(failureCode);
    super("O processamento durável falhou");
    this.name = "ProcessingJobError";
    this.failureCode = validated;
    this.terminal = terminal;
  }
}

interface DurableJobWorkerOptions {
  handler: ProcessingJobHandler;
  heartbeatMs?: number;
  logger: Logger;
  pollMs?: number;
  queue: ProcessingQueue;
  workerId?: string;
}

export class DurableJobWorker {
  readonly #handler: ProcessingJobHandler;
  readonly #heartbeatMs: number;
  readonly #logger: Logger;
  readonly #pollMs: number;
  readonly #queue: ProcessingQueue;
  readonly #workerId: string;
  #active: Promise<void> | undefined;
  #claiming = false;
  #pollTimer: NodeJS.Timeout | undefined;

  public constructor(options: DurableJobWorkerOptions) {
    this.#handler = options.handler;
    this.#heartbeatMs = options.heartbeatMs ?? 60_000;
    this.#logger = options.logger;
    this.#pollMs = options.pollMs ?? 1_000;
    this.#queue = options.queue;
    this.#workerId = options.workerId ?? randomUUID();
  }

  public start(): void {
    if (this.#pollTimer !== undefined) {
      return;
    }
    void this.#poll();
    this.#pollTimer = setInterval(() => {
      void this.#poll();
    }, this.#pollMs);
    this.#pollTimer.unref();
  }

  public async processNext(): Promise<boolean> {
    if (this.#active !== undefined || this.#claiming) {
      return false;
    }
    this.#claiming = true;
    let job: ClaimedProcessingJob | undefined;
    try {
      job = await this.#queue.claim(this.#workerId);
    } finally {
      this.#claiming = false;
    }
    if (job === undefined) {
      return false;
    }

    const operation = this.#process(job);
    this.#active = operation;
    try {
      await operation;
    } finally {
      if (this.#active === operation) {
        this.#active = undefined;
      }
    }
    return true;
  }

  public async shutdown(): Promise<void> {
    if (this.#pollTimer !== undefined) {
      clearInterval(this.#pollTimer);
      this.#pollTimer = undefined;
    }
    if (this.#active !== undefined) {
      await this.#active;
    }
  }

  async #poll(): Promise<void> {
    try {
      await this.processNext();
    } catch (error) {
      this.#logger.error(
        { errorType: getErrorType(error) },
        "Falha ao consultar ou atualizar a fila durável",
      );
    }
  }

  async #process(job: ClaimedProcessingJob): Promise<void> {
    const heartbeat = setInterval(() => {
      void this.#queue.renew(job, this.#workerId).catch((error: unknown) => {
        this.#logger.error(
          { errorType: getErrorType(error), jobId: job.jobId, meetingId: job.meetingId },
          "Falha ao renovar o lease do processamento",
        );
      });
    }, this.#heartbeatMs);
    heartbeat.unref();
    try {
      await this.#handler.process(job);
      await this.#queue.complete(job, this.#workerId);
    } catch (error) {
      const failureCode =
        error instanceof ProcessingJobError ? error.failureCode : "unexpected_error";
      const terminal = error instanceof ProcessingJobError && error.terminal;
      const status = await this.#queue.fail(job, failureCode, this.#workerId, terminal);
      this.#logger.warn(
        {
          attemptCount: job.attemptCount,
          failureCode,
          jobId: job.jobId,
          jobStatus: status,
          meetingId: job.meetingId,
        },
        "Etapa do processamento não foi concluída",
      );
      if (status === "failed") {
        await this.#cleanup(job.meetingId);
      }
      return;
    } finally {
      clearInterval(heartbeat);
    }
    if (job.jobType === "summary") {
      await this.#cleanup(job.meetingId);
    }
  }

  async #cleanup(meetingId: string): Promise<void> {
    try {
      await this.#handler.cleanup?.(meetingId);
    } catch (error) {
      this.#logger.error(
        { errorType: getErrorType(error), meetingId },
        "Falha ao excluir artefatos temporários após estado terminal",
      );
    }
  }
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
