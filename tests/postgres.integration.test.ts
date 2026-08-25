import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresDatabase } from "../src/database/postgres-database.js";
import { PostgresMeetingStore } from "../src/database/postgres-meeting-store.js";
import { DurableJobQueue } from "../src/processing/durable-job-queue.js";
import { createManifest, markManifestCompleted } from "../src/recording/manifest.js";

const connectionString = process.env.POSTGRES_TEST_URL;

describe.skipIf(connectionString === undefined)("PostgreSQL real", () => {
  const database = createPostgresDatabase(connectionString ?? "postgresql://invalid");
  const meetingId = randomUUID();
  const failedMeetingId = randomUUID();

  beforeAll(async () => {
    await database.initialize();
  });

  afterAll(async () => {
    await database.query("DELETE FROM meetings WHERE meeting_id = ANY($1::text[])", [
      [meetingId, failedMeetingId],
    ]);
    await database.close();
  });

  it("migra o schema e cria o job junto com a conclusão da reunião", async () => {
    const store = new PostgresMeetingStore(database);
    const completed = markManifestCompleted(
      createManifest({
        guildId: "guild-integration",
        meetingId,
        notificationChannelId: "text-integration",
        startedAt: "2026-08-24T10:00:00.000Z",
        storageMode: "postgres",
        voiceChannelId: "voice-integration",
      }),
      "2026-08-24T10:01:00.000Z",
    );

    await store.save(completed);

    const result = await database.query(
      `
SELECT meeting.pipeline_status, job.job_type, job.status
FROM meetings AS meeting
JOIN processing_jobs AS job ON job.meeting_id = meeting.meeting_id
WHERE meeting.meeting_id = $1
`,
      [meetingId],
    );
    expect(result.rows).toEqual([
      { job_type: "transcription", pipeline_status: "queued", status: "scheduled" },
    ]);
  });

  it("conclui ou falha job e reunião atomicamente", async () => {
    const queue = new DurableJobQueue(database);
    await database.query("UPDATE processing_jobs SET status = 'completed' WHERE meeting_id = $1", [
      meetingId,
    ]);
    await queue.enqueue(meetingId, "summary");
    const summaryJob = await queue.claim("integration-worker");
    expect(summaryJob?.jobType).toBe("summary");
    if (summaryJob === undefined) {
      throw new Error("O job de resumo não foi reservado");
    }
    await queue.complete(summaryJob, "integration-worker");

    const store = new PostgresMeetingStore(database);
    await store.save(
      markManifestCompleted(
        createManifest({
          guildId: "guild-integration",
          meetingId: failedMeetingId,
          notificationChannelId: "text-integration",
          startedAt: "2026-08-24T11:00:00.000Z",
          storageMode: "postgres",
          voiceChannelId: "voice-integration",
        }),
        "2026-08-24T11:01:00.000Z",
      ),
    );
    const failedJob = await queue.claim("integration-worker");
    if (failedJob === undefined) {
      throw new Error("O job destinado à falha não foi reservado");
    }
    await queue.fail(failedJob, "audio_invalid", "integration-worker", true);

    const terminalMeetings = await database.query(
      "SELECT meeting_id, pipeline_status, manifest FROM meetings WHERE meeting_id = ANY($1::text[]) ORDER BY meeting_id",
      [[meetingId, failedMeetingId]],
    );
    expect(terminalMeetings.rows).toEqual(
      expect.arrayContaining([
        { manifest: null, meeting_id: meetingId, pipeline_status: "completed" },
        { manifest: null, meeting_id: failedMeetingId, pipeline_status: "failed" },
      ]),
    );
  });
});
