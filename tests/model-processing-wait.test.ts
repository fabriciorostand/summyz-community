import { describe, expect, it, vi } from "vitest";
import type { PostgresExecutor } from "../src/database/postgres-database.js";
import { type ClaimedProcessingJob, DurableJobQueue } from "../src/processing/durable-job-queue.js";

describe("missing model processing wait", () => {
  it("preserves a final attempt and all meeting artifacts while awaiting installation", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({ rowCount: 1, rows: [] });
    const queue = new DurableJobQueue({ query });
    const job: ClaimedProcessingJob = {
      jobId: "63d3b8c0-e02a-4fdf-8179-a0feec79e7c1",
      meetingId: "meeting",
      jobType: "summary",
      attemptCount: 6,
      maxAttempts: 6,
      finalAttempt: true,
      availableAt: new Date(),
      leaseExpiresAt: new Date(),
    };
    await expect(queue.fail(job, "local_models_missing", "worker")).resolves.toBe("scheduled");
    const sql = query.mock.calls.map(([sql]) => sql).join(" ");
    expect(sql).toContain("attempt_count - 1");
    expect(sql).not.toMatch(/manifest\s*=\s*NULL|DELETE|pipeline_status\s*=\s*'failed'/i);
  });
});
