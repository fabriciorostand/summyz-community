import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { createLogger } from "../src/logger.js";
import type { ClaimedProcessingJob } from "../src/processing/durable-job-queue.js";
import {
  DurableJobWorker,
  ProcessingJobError,
  type ProcessingJobHandler,
  type ProcessingQueue,
} from "../src/processing/durable-job-worker.js";

const job = {
  attemptCount: 1,
  availableAt: new Date("2026-08-24T10:00:00.000Z"),
  finalAttempt: false,
  jobId: "11111111-1111-4111-8111-111111111111",
  jobType: "transcription" as const,
  leaseExpiresAt: new Date("2026-08-24T10:05:00.000Z"),
  maxAttempts: 6,
  meetingId: "meeting-1",
};

function createQueue(claimed: ClaimedProcessingJob = job) {
  return {
    claim: vi.fn(async (): ReturnType<ProcessingQueue["claim"]> => claimed),
    complete: vi.fn(async () => undefined),
    fail: vi.fn(async (): Promise<"failed" | "retained" | "scheduled"> => "scheduled"),
    renew: vi.fn(async () => undefined),
  } satisfies ProcessingQueue;
}

describe("DurableJobWorker", () => {
  it("conclui um job processado com sucesso", async () => {
    const queue = createQueue();
    const handler: ProcessingJobHandler = { process: vi.fn(async () => undefined) };
    const worker = new DurableJobWorker({
      handler,
      logger: createLogger("silent"),
      queue,
      workerId: "worker-1",
    });

    await expect(worker.processNext()).resolves.toBe(true);

    expect(handler.process).toHaveBeenCalledWith(job);
    expect(queue.complete).toHaveBeenCalledWith(job, "worker-1");
  });

  it("persiste a falha segura para retry sem propagar detalhes internos", async () => {
    const queue = createQueue();
    const handler: ProcessingJobHandler = {
      process: vi.fn(async () => {
        throw new ProcessingJobError("provider_unavailable");
      }),
    };
    const worker = new DurableJobWorker({
      handler,
      logger: createLogger("silent"),
      queue,
      workerId: "worker-1",
    });

    await expect(worker.processNext()).resolves.toBe(true);

    expect(queue.fail).toHaveBeenCalledWith(job, "provider_unavailable", "worker-1", false);
    expect(queue.complete).not.toHaveBeenCalled();
  });

  it("não processa quando não existe job disponível", async () => {
    const queue = createQueue();
    queue.claim.mockResolvedValueOnce(undefined);
    const handler: ProcessingJobHandler = { process: vi.fn(async () => undefined) };
    const worker = new DurableJobWorker({
      handler,
      logger: createLogger("silent"),
      queue,
      workerId: "worker-1",
    });

    await expect(worker.processNext()).resolves.toBe(false);
    expect(handler.process).not.toHaveBeenCalled();
  });

  it("registra falhas inesperadas com um código estável", async () => {
    const destination = new PassThrough();
    let output = "";
    destination.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    const queue = createQueue();
    const handler: ProcessingJobHandler = {
      process: vi.fn(async () => {
        throw Object.assign(new Error("detalhe interno sensível"), { code: "23505" });
      }),
    };
    const worker = new DurableJobWorker({
      handler,
      logger: createLogger("warn", destination),
      queue,
      workerId: "worker-1",
    });

    await expect(worker.processNext()).resolves.toBe(true);
    await new Promise((resolve) => setImmediate(resolve));

    expect(queue.fail).toHaveBeenCalledWith(job, "unexpected_error", "worker-1", false);
    expect(output).toContain('"errorCode":"23505"');
    expect(output).toContain('"errorType":"Error"');
    expect(output).toContain('"jobType":"transcription"');
    expect(output).not.toContain("detalhe interno sensível");
  });

  it("limpa artefatos somente depois de persistir uma falha terminal", async () => {
    const queue = createQueue();
    queue.fail.mockResolvedValueOnce("failed");
    const cleanup = vi.fn(async () => undefined);
    const worker = new DurableJobWorker({
      handler: {
        cleanup,
        process: vi.fn(async () => {
          throw new ProcessingJobError("audio_invalid", true);
        }),
      },
      logger: createLogger("silent"),
      queue,
      workerId: "worker-1",
    });

    await worker.processNext();

    expect(queue.fail).toHaveBeenCalledWith(job, "audio_invalid", "worker-1", true);
    expect(cleanup).toHaveBeenCalledWith("meeting-1");
  });

  it("preserva artefatos de uma incompatibilidade elegível para recuperação", async () => {
    const queue = createQueue();
    queue.fail.mockResolvedValueOnce("retained");
    const cleanup = vi.fn(async () => undefined);
    const worker = new DurableJobWorker({
      handler: {
        cleanup,
        process: vi.fn(async () => {
          throw new ProcessingJobError("provider_failed", true, "invalid_timestamps");
        }),
      },
      logger: createLogger("silent"),
      queue,
      workerId: "worker-1",
    });

    await worker.processNext();

    expect(queue.fail).toHaveBeenCalledWith(
      job,
      "provider_failed",
      "worker-1",
      true,
      "invalid_timestamps",
    );
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("respeita uma retenção existente quando uma nova tentativa falha sem resposta", async () => {
    const queue = createQueue();
    queue.fail.mockResolvedValueOnce("retained");
    const cleanup = vi.fn(async () => undefined);
    const worker = new DurableJobWorker({
      handler: {
        cleanup,
        process: vi.fn(async () => {
          throw new ProcessingJobError("provider_unavailable", true);
        }),
      },
      logger: createLogger("silent"),
      queue,
      workerId: "worker-1",
    });

    await worker.processNext();

    expect(queue.fail).toHaveBeenCalledWith(job, "provider_unavailable", "worker-1", true);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("limpa o workspace depois de concluir o job de resumo", async () => {
    const summaryJob = { ...job, jobType: "summary" as const };
    const queue = createQueue(summaryJob);
    const cleanup = vi.fn(async () => undefined);
    const worker = new DurableJobWorker({
      handler: { cleanup, process: vi.fn(async () => undefined) },
      logger: createLogger("silent"),
      queue,
      workerId: "worker-1",
    });

    await worker.processNext();

    expect(queue.complete).toHaveBeenCalledWith(summaryJob, "worker-1");
    expect(cleanup).toHaveBeenCalledWith("meeting-1");
  });

  it("inicia e encerra o polling de forma idempotente", async () => {
    vi.useFakeTimers();
    const queue = createQueue();
    queue.claim.mockResolvedValue(undefined);
    const worker = new DurableJobWorker({
      handler: { process: vi.fn(async () => undefined) },
      logger: createLogger("silent"),
      pollMs: 10,
      queue,
      workerId: "worker-1",
    });

    worker.start();
    worker.start();
    await vi.advanceTimersByTimeAsync(25);
    await worker.shutdown();
    await worker.shutdown();

    expect(queue.claim).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
