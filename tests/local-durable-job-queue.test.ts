import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LocalDurableJobQueue } from "../src/processing/local-durable-job-queue.js";

describe("LocalDurableJobQueue", () => {
  it("persiste jobs e recupera um lease ativo após reinício", async () => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-local-queue-"));
    const filePath = join(directory, "processing.json");
    const first = new LocalDurableJobQueue(filePath, {
      createId: () => "11111111-1111-4111-8111-111111111111",
      now: () => new Date("2026-08-24T10:00:00.000Z"),
    });
    await first.initialize();
    await first.enqueue("meeting-1", "transcription");
    await expect(first.claim("worker-1")).resolves.toMatchObject({ attemptCount: 1 });

    const recovered = new LocalDurableJobQueue(filePath, {
      now: () => new Date("2026-08-24T10:00:05.000Z"),
    });
    await recovered.initialize();

    await expect(recovered.claim("worker-2")).resolves.toMatchObject({
      attemptCount: 2,
      meetingId: "meeting-1",
    });
  });

  it("preserva o agendamento do retry entre instâncias", async () => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-local-queue-"));
    const filePath = join(directory, "processing.json");
    let now = new Date("2026-08-24T10:00:00.000Z");
    const queue = new LocalDurableJobQueue(filePath, {
      createId: () => "11111111-1111-4111-8111-111111111111",
      now: () => now,
    });
    await queue.initialize();
    await queue.enqueue("meeting-1", "transcription");
    const job = await queue.claim("worker-1");
    if (job === undefined) throw new Error("Job esperado");
    await queue.fail(job, "provider_unavailable", "worker-1");

    now = new Date("2026-08-24T10:00:59.000Z");
    await expect(queue.claim("worker-1")).resolves.toBeUndefined();
    now = new Date("2026-08-24T10:01:00.000Z");
    await expect(queue.claim("worker-1")).resolves.toMatchObject({ attemptCount: 2 });
  });

  it("registra limpeza pendente ao concluir resumo", async () => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-local-queue-"));
    const queue = new LocalDurableJobQueue(join(directory, "processing.json"), {
      createId: () => "11111111-1111-4111-8111-111111111111",
      now: () => new Date("2026-08-24T10:00:00.000Z"),
    });
    await queue.initialize();
    await queue.enqueue("meeting-1", "summary");
    const job = await queue.claim("worker-1");
    if (job === undefined) throw new Error("Job esperado");
    await queue.complete(job, "worker-1");

    await expect(queue.listTerminalMeetingIds()).resolves.toEqual(["meeting-1"]);
    await queue.markArtifactsDeleted("meeting-1");
    await expect(queue.listTerminalMeetingIds()).resolves.toEqual([]);
  });

  it("encerra imediatamente uma falha permanente", async () => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-local-queue-"));
    const queue = new LocalDurableJobQueue(join(directory, "processing.json"), {
      createId: () => "11111111-1111-4111-8111-111111111111",
      now: () => new Date("2026-08-24T10:00:00.000Z"),
    });
    await queue.initialize();
    await queue.enqueue("meeting-1", "transcription");
    const job = await queue.claim("worker-1");
    if (job === undefined) throw new Error("Job esperado");

    await expect(queue.fail(job, "audio_invalid", "worker-1", true)).resolves.toBe("failed");
    await expect(queue.listTerminalMeetingIds()).resolves.toEqual(["meeting-1"]);
  });

  it("é idempotente e ignora operações de um worker que não possui o lease", async () => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-local-queue-"));
    const queue = new LocalDurableJobQueue(join(directory, "processing.json"), {
      createId: () => "11111111-1111-4111-8111-111111111111",
      now: () => new Date("2026-08-24T10:00:00.000Z"),
    });
    await queue.initialize();
    await expect(queue.enqueue("meeting-1", "transcription")).resolves.toBe(true);
    await expect(queue.enqueue("meeting-1", "transcription")).resolves.toBe(false);
    const job = await queue.claim("worker-1");
    if (job === undefined) throw new Error("Job esperado");

    await queue.renew(job, "worker-2");
    await queue.complete(job, "worker-2");
    await expect(queue.fail(job, "provider_unavailable", "worker-2")).resolves.toBe("scheduled");
    await expect(queue.fail(job, "audio_invalid", "worker-2", true)).resolves.toBe("failed");
    await queue.markArtifactsDeleted("unknown-meeting");

    await expect(queue.listTerminalMeetingIds()).resolves.toEqual([]);
  });

  it("recupera um lease vencido e não marca etapa intermediária como terminal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-local-queue-"));
    const filePath = join(directory, "processing.json");
    let now = new Date("2026-08-24T10:00:00.000Z");
    const queue = new LocalDurableJobQueue(filePath, {
      createId: () => "11111111-1111-4111-8111-111111111111",
      leaseMs: 1_000,
      now: () => now,
    });
    await queue.initialize();
    await queue.enqueue("meeting-1", "transcription");
    await expect(queue.claim("worker-1")).resolves.toBeDefined();

    now = new Date("2026-08-24T10:00:01.000Z");
    const recovered = await queue.claim("worker-2");
    if (recovered === undefined) throw new Error("Lease vencido deveria ser recuperado");
    await queue.renew(recovered, "worker-2");
    await queue.complete(recovered, "worker-2");

    await expect(queue.claim("worker-2")).resolves.toBeUndefined();
    await expect(queue.listTerminalMeetingIds()).resolves.toEqual([]);
  });

  it("encerra na última tentativa mesmo sem sinalização explícita de falha terminal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-local-queue-"));
    const filePath = join(directory, "processing.json");
    let now = new Date("2026-08-24T10:00:00.000Z");
    const queue = new LocalDurableJobQueue(filePath, {
      createId: () => "11111111-1111-4111-8111-111111111111",
      now: () => now,
    });
    await queue.initialize();
    await queue.enqueue("meeting-1", "transcription");

    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const job = await queue.claim("worker-1");
      if (job === undefined) throw new Error("Job esperado");
      const status = await queue.fail(job, "provider_unavailable", "worker-1");
      if (attempt < 6) {
        expect(status).toBe("scheduled");
        now = new Date(now.getTime() + 24 * 60 * 60 * 1_000);
      } else {
        expect(status).toBe("failed");
      }
    }

    await expect(queue.listTerminalMeetingIds()).resolves.toEqual(["meeting-1"]);
  });
});
