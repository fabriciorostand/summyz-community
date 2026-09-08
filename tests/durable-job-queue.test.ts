import { describe, expect, it, vi } from "vitest";
import type { PostgresExecutor, PostgresQueryResult } from "../src/database/postgres-database.js";
import { DurableJobQueue } from "../src/processing/durable-job-queue.js";

function createExecutor(results: PostgresQueryResult[]) {
  const query = vi.fn(
    async (_text: string, _values?: readonly unknown[]) =>
      results.shift() ?? { rowCount: 0, rows: [] },
  );
  return { executor: { query } satisfies PostgresExecutor, query };
}

const claimedRow = {
  attempt_count: 1,
  available_at: new Date("2026-08-24T10:00:00.000Z"),
  job_id: "11111111-1111-4111-8111-111111111111",
  job_type: "transcription",
  lease_expires_at: new Date("2026-08-24T10:05:00.000Z"),
  max_attempts: 6,
  meeting_id: "meeting-1",
};

describe("DurableJobQueue", () => {
  it("enfileira uma única etapa por reunião de forma idempotente", async () => {
    const { executor, query } = createExecutor([
      { rowCount: 1, rows: [{ job_id: claimedRow.job_id }] },
    ]);
    const queue = new DurableJobQueue(executor, {
      createId: () => claimedRow.job_id,
      now: () => new Date("2026-08-24T10:00:00.000Z"),
    });

    await expect(queue.enqueue("meeting-1", "transcription")).resolves.toBe(true);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (meeting_id, job_type) DO NOTHING"),
      [claimedRow.job_id, "meeting-1", "transcription", "2026-08-24T10:00:00.000Z", 6, 1],
    );
  });

  it("reserva atomicamente um job disponível ou com lease expirado", async () => {
    const { executor, query } = createExecutor([{ rowCount: 1, rows: [claimedRow] }]);
    const queue = new DurableJobQueue(executor, {
      now: () => new Date("2026-08-24T10:00:00.000Z"),
    });

    await expect(queue.claim("worker-1")).resolves.toMatchObject({
      attemptCount: 1,
      finalAttempt: false,
      jobType: "transcription",
      meetingId: "meeting-1",
    });

    expect(query.mock.calls[0]?.[0]).toContain("FOR UPDATE SKIP LOCKED");
    expect(query.mock.calls[0]?.[0]).toContain("lease_expires_at <= $1");
  });

  it("agenda os cinco atrasos confirmados e encerra na sexta execução", async () => {
    const { executor, query } = createExecutor([
      { rowCount: 1, rows: [] },
      { rowCount: 1, rows: [] },
    ]);
    const queue = new DurableJobQueue(executor, {
      now: () => new Date("2026-08-24T10:00:00.000Z"),
    });

    await expect(
      queue.fail(
        { ...toClaimedJob(claimedRow), attemptCount: 1 },
        "provider_unavailable",
        "worker-1",
      ),
    ).resolves.toBe("scheduled");
    expect(query.mock.calls[0]?.[1]).toContain("2026-08-24T10:01:00.000Z");

    await expect(
      queue.fail(
        { ...toClaimedJob(claimedRow), attemptCount: 6, finalAttempt: true },
        "provider_unavailable",
        "worker-1",
      ),
    ).resolves.toBe("failed");
    expect(query.mock.calls[1]?.[0]).toContain("status = 'failed'");
    expect(query.mock.calls[1]?.[0]).toContain("pipeline_status = 'failed'");
  });

  it("encerra imediatamente uma falha permanente", async () => {
    const { executor, query } = createExecutor([{ rowCount: 1, rows: [] }]);
    const queue = new DurableJobQueue(executor, {
      now: () => new Date("2026-08-24T10:00:00.000Z"),
    });

    await expect(
      queue.fail(toClaimedJob(claimedRow), "audio_invalid", "worker-1", true),
    ).resolves.toBe("failed");

    expect(query.mock.calls[0]?.[0]).toContain("WITH failed_job AS");
    expect(query.mock.calls[0]?.[1]).toEqual([
      claimedRow.job_id,
      "worker-1",
      "audio_invalid",
      "2026-08-24T10:00:00.000Z",
      null,
      "2026-08-25T10:00:00.000Z",
    ]);
  });

  it("preserva por 24 horas uma incompatibilidade recuperável sem renovar o prazo", async () => {
    const { executor, query } = createExecutor([
      { rowCount: 1, rows: [{ artifacts_retained: true }] },
    ]);
    const queue = new DurableJobQueue(executor, {
      now: () => new Date("2026-08-24T10:00:00.000Z"),
    });

    await expect(
      queue.fail(
        { ...toClaimedJob(claimedRow), attemptCount: 6, finalAttempt: true },
        "provider_failed",
        "worker-1",
        true,
        "invalid_timestamps",
      ),
    ).resolves.toBe("retained");

    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/COALESCE\(artifacts_delete_after, \$6::timestamptz\)/),
      [
        claimedRow.job_id,
        "worker-1",
        "provider_failed",
        "2026-08-24T10:00:00.000Z",
        "invalid_timestamps",
        "2026-08-25T10:00:00.000Z",
      ],
    );
  });

  it("não cancela uma retenção existente quando a recuperação termina com falha de rede", async () => {
    const { executor, query } = createExecutor([
      { rowCount: 1, rows: [{ artifacts_retained: true }] },
    ]);
    const queue = new DurableJobQueue(executor, {
      now: () => new Date("2026-08-24T10:00:00.000Z"),
    });

    await expect(
      queue.fail(
        { ...toClaimedJob(claimedRow), attemptCount: 6, finalAttempt: true },
        "provider_unavailable",
        "worker-1",
        true,
      ),
    ).resolves.toBe("retained");

    expect(query.mock.calls[0]?.[0]).toMatch(
      /transcription_recovery_reason IS NOT NULL[\s\S]+artifacts_delete_after > \$4::timestamptz/,
    );
  });

  it("reabre uma incompatibilidade uma única vez por versão de recuperação", async () => {
    const { executor, query } = createExecutor([
      { rowCount: 1, rows: [{ meeting_id: "meeting-1" }] },
    ]);
    const queue = new DurableJobQueue(executor, {
      now: () => new Date("2026-08-24T10:00:00.000Z"),
    });

    await expect(queue.recoverEligibleTranscriptions(2)).resolves.toEqual(["meeting-1"]);

    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(
        /transcription_recovery_version < \$1[\s\S]+attempt_count = 0[\s\S]+transcription_recovery_version = \$1/,
      ),
      [2, "2026-08-24T10:00:00.000Z", 6],
    );
  });

  it("rejeita uma versão de recuperação inválida antes de consultar o banco", async () => {
    const { executor, query } = createExecutor([]);
    const queue = new DurableJobQueue(executor);

    await expect(queue.recoverEligibleTranscriptions(0)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it("conclui o job e o estágio terminal na mesma operação", async () => {
    const { executor, query } = createExecutor([{ rowCount: 1, rows: [] }]);
    const queue = new DurableJobQueue(executor, {
      now: () => new Date("2026-08-24T10:00:00.000Z"),
    });

    await queue.complete({ ...toClaimedJob(claimedRow), jobType: "summary" }, "worker-1");

    expect(query.mock.calls[0]?.[0]).toContain("WITH completed_job AS");
    expect(query.mock.calls[0]?.[0]).toContain("pipeline_status = 'completed'");
  });

  it("rejeita uma linha inválida recebida do banco", async () => {
    const { executor } = createExecutor([
      { rowCount: 1, rows: [{ ...claimedRow, job_type: "delete" }] },
    ]);
    const queue = new DurableJobQueue(executor);

    await expect(queue.claim("worker-1")).rejects.toThrow();
  });

  it("renova o lease somente para o worker que reservou o job", async () => {
    const { executor, query } = createExecutor([{ rowCount: 1, rows: [] }]);
    const queue = new DurableJobQueue(executor, {
      leaseMs: 300_000,
      now: () => new Date("2026-08-24T10:00:00.000Z"),
    });

    await queue.renew(toClaimedJob(claimedRow), "worker-1");

    expect(query).toHaveBeenCalledWith(expect.stringContaining("lease_expires_at = $3"), [
      claimedRow.job_id,
      "worker-1",
      "2026-08-24T10:05:00.000Z",
      "2026-08-24T10:00:00.000Z",
    ]);
  });
});

function toClaimedJob(row: typeof claimedRow) {
  return {
    attemptCount: row.attempt_count,
    availableAt: row.available_at,
    finalAttempt: false,
    jobId: row.job_id,
    jobType: row.job_type as "transcription",
    leaseExpiresAt: row.lease_expires_at,
    maxAttempts: row.max_attempts,
    meetingId: row.meeting_id,
  };
}
