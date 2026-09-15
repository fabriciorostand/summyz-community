import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresAnalyticsStore } from "../src/database/postgres-analytics-store.js";
import { createPostgresDatabase } from "../src/database/postgres-database.js";
import { PostgresMeetingStore } from "../src/database/postgres-meeting-store.js";
import { DurableJobQueue } from "../src/processing/durable-job-queue.js";
import {
  addParticipant,
  addSegment,
  createManifest,
  markManifestCompleted,
} from "../src/recording/manifest.js";
import {
  completeTranscriptionGroup,
  createTranscriptionState,
  markTranscriptionCompleted,
} from "../src/transcription/transcription-state.js";

const connectionString = process.env.POSTGRES_TEST_URL;

describe.skipIf(connectionString === undefined)("PostgreSQL real", () => {
  const database = createPostgresDatabase(connectionString ?? "postgresql://invalid");
  const meetingId = randomUUID();
  const failedMeetingId = randomUUID();
  const analyticsMeetingId = randomUUID();

  beforeAll(async () => {
    await database.initialize();
  });

  afterAll(async () => {
    await database.query("DELETE FROM meetings WHERE meeting_id = ANY($1::text[])", [
      [meetingId, failedMeetingId, analyticsMeetingId],
    ]);
    await database.close();
  });

  it("persiste talk time de forma idempotente quando os participantes já existem", async () => {
    let manifest = createManifest({
      guildId: "guild-integration",
      meetingId: analyticsMeetingId,
      notificationChannelId: "text-integration",
      startedAt: "2026-08-24T09:00:00.000Z",
      storageMode: "postgres",
      voiceChannelId: "voice-integration",
    });
    manifest = addParticipant(manifest, { displayName: "Ana", userId: "ana" });
    manifest = addSegment(manifest, {
      durationMs: 2_000,
      endedAtMs: 3_000,
      file: "participants/ana/segment-1.ogg",
      segmentId: "segment-1",
      startedAtMs: 1_000,
      userDisplayName: "Ana",
      userId: "ana",
    });
    manifest = markManifestCompleted(manifest, "2026-08-24T09:05:00.000Z");
    await new PostgresMeetingStore(database).save(manifest);
    await database.query("UPDATE processing_jobs SET status = 'completed' WHERE meeting_id = $1", [
      analyticsMeetingId,
    ]);

    let transcription = createTranscriptionState(
      analyticsMeetingId,
      ["segment-1"],
      "2026-08-24T09:05:01.000Z",
    );
    transcription = completeTranscriptionGroup(
      transcription,
      {
        representativeSegmentId: "segment-1",
        result: {
          attempts: 1,
          pieces: [{ endedAtMs: 1_000, startedAtMs: 0, text: "Olá." }],
          words: [{ endedAtMs: 1_000, startedAtMs: 0, text: "Olá." }],
        },
        segmentIds: ["segment-1"],
      },
      "2026-08-24T09:05:02.000Z",
    );
    transcription = markTranscriptionCompleted(transcription, "2026-08-24T09:05:03.000Z");

    const analytics = new PostgresAnalyticsStore(database);
    await analytics.persistParticipation(manifest, transcription);
    await analytics.persistParticipation(manifest, transcription);

    const result = await database.query(
      `SELECT participant.user_id, participant.talk_time_ms, participant.talk_percentage,
              meeting.talk_time_available
       FROM meeting_participants participant
       JOIN meetings meeting ON meeting.meeting_id = participant.meeting_id
       WHERE participant.meeting_id = $1`,
      [analyticsMeetingId],
    );
    expect(result.rows).toEqual([
      {
        talk_percentage: 100,
        talk_time_available: true,
        talk_time_ms: "1000",
        user_id: "ana",
      },
    ]);
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
