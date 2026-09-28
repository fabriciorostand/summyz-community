import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createInitialAiProfile, externalAiProfileSchema } from "../src/ai-profile.js";
import { databaseMigrations } from "../src/database/migrations.js";
import { PostgresAiProfileStore } from "../src/database/postgres-ai-profile-store.js";
import { createPostgresDatabase } from "../src/database/postgres-database.js";
import { PostgresMeetingStore } from "../src/database/postgres-meeting-store.js";
import { DurableJobQueue } from "../src/processing/durable-job-queue.js";
import {
  createManifest,
  type MeetingAiConfiguration,
  markManifestCompleted,
} from "../src/recording/manifest.js";

const connectionString = process.env.POSTGRES_TEST_URL;
const pendingStatuses = [
  "recording",
  "queued",
  "transcribing",
  "refining",
  "summarizing",
  "publishing",
] as const;

describe.skipIf(connectionString === undefined)(
  "contrato real de atualização do PostgreSQL",
  () => {
    it.each([9, 14, 15])(
      "preserva calls, jobs, custos e catálogo de áudio ao atualizar da versão %i",
      async (baseline) => {
        const adminPool = new Pool({
          connectionString: connectionString ?? "postgresql://invalid",
        });
        const schemaName = `upgrade_${randomUUID().replaceAll("-", "")}`;
        await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
        const scopedDatabase = createPostgresDatabase(withSearchPath(connectionString, schemaName));

        try {
          await scopedDatabase.query(`
CREATE TABLE schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)
`);
          for (const migration of databaseMigrations.filter(({ version }) => version <= baseline)) {
            await scopedDatabase.query(migration.sql);
            await scopedDatabase.query("INSERT INTO schema_migrations (version) VALUES ($1)", [
              migration.version,
            ]);
          }

          const meetingIds = new Map<(typeof pendingStatuses)[number], string>();
          for (const status of pendingStatuses) {
            const meetingId = randomUUID();
            meetingIds.set(status, meetingId);
            const recordingManifest = createManifest({
              aiConfiguration: externalAiConfiguration,
              guildId: "guild-upgrade-contract",
              meetingId,
              notificationChannelId: "text-upgrade-contract",
              startedAt: "2026-09-03T20:00:00.000Z",
              storageMode: "postgres",
              voiceChannelId: "voice-upgrade-contract",
            });
            const manifest =
              status === "recording"
                ? recordingManifest
                : markManifestCompleted(recordingManifest, "2026-09-03T20:10:00.000Z");
            await scopedDatabase.query(
              `
INSERT INTO meetings (
  meeting_id, guild_id, voice_channel_id, notification_channel_id,
  recording_status, pipeline_status, manifest, persist_content, persist_audio,
  storage_mode, started_at, completed_at, voice_channel_name
) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, false, false, 'postgres', $8, $9, $10)
`,
              [
                meetingId,
                manifest.guildId,
                manifest.voiceChannelId,
                manifest.notificationChannelId,
                manifest.status,
                status,
                JSON.stringify(manifest),
                manifest.startedAt,
                manifest.completedAt ?? null,
                manifest.voiceChannelName ?? null,
              ],
            );
            if (status !== "recording") {
              await scopedDatabase.query(
                `
INSERT INTO processing_jobs (
  job_id, meeting_id, job_type, status, available_at, max_attempts
) VALUES ($1, $2, 'transcription', 'scheduled', now(), 6)
`,
                [randomUUID(), meetingId],
              );
            }
            await scopedDatabase.query(
              `
INSERT INTO meeting_audio_segments (
  meeting_id, segment_id, user_id, user_display_name, relative_path,
  format, status, started_at_ms, ended_at_ms, duration_ms
) VALUES ($1, $2, 'user-upgrade', 'User Upgrade', 'participants/user-upgrade/segment.ogg',
  'ogg_opus', 'ready', 0, 1000, 1000)
`,
              [meetingId, `segment-${status}`],
            );
          }

          const transcribingMeetingId = meetingIds.get("transcribing");
          if (transcribingMeetingId === undefined) {
            throw new Error("Expected a transcribing meeting in the upgrade contract");
          }
          await scopedDatabase.query(
            `
UPDATE processing_jobs
SET status = 'active', attempt_count = 5, lease_expires_at = now() - interval '1 minute'
WHERE meeting_id = $1
`,
            [transcribingMeetingId],
          );
          await scopedDatabase.query(
            `
INSERT INTO provider_cost_attempts (
  attempt_id, meeting_id, guild_id, phase, execution, provider, model,
  started_at, ended_at, outcome, financial_status
) VALUES ($1, $2, 'guild-upgrade-contract', 'transcription', 'api', 'openrouter',
  'openai/whisper-large-v3', now() - interval '1 minute', now(), 'failure', 'unattributed')
`,
            [randomUUID(), transcribingMeetingId],
          );

          const snapshotSql = `SELECT
          (SELECT jsonb_agg(jsonb_build_array(meeting_id, manifest, pipeline_status) ORDER BY meeting_id) FROM meetings) AS meetings,
          (SELECT jsonb_agg(jsonb_build_array(job_id, status, attempt_count, meeting_id) ORDER BY job_id) FROM processing_jobs) AS jobs,
          (SELECT jsonb_agg(to_jsonb(attempt) ORDER BY attempt_id) FROM provider_cost_attempts attempt) AS costs,
          (SELECT jsonb_agg(to_jsonb(segment) ORDER BY segment_id) FROM meeting_audio_segments segment) AS audio`;
          const beforeUpgrade = await scopedDatabase.query(snapshotSql);
          await scopedDatabase.initialize();
          expect((await scopedDatabase.query(snapshotSql)).rows).toEqual(beforeUpgrade.rows);

          const profile = externalAiProfileSchema.parse(
            createInitialAiProfile("external", "pt-BR"),
          );
          await new PostgresAiProfileStore(scopedDatabase).createProfile({
            ...profile,
            language: "en",
            profileId: randomUUID(),
            transcription: { ...profile.transcription, language: "pt-BR" },
          });
          const configuredProfiles = await new PostgresAiProfileStore(
            scopedDatabase,
          ).listProfiles();
          expect(configuredProfiles).toMatchObject([
            { language: "en", transcription: { language: "pt-BR" } },
          ]);

          const meetingStore = new PostgresMeetingStore(scopedDatabase);

          const meetings = await scopedDatabase.query(
            "SELECT meeting_id, pipeline_status, manifest IS NOT NULL AS has_manifest FROM meetings WHERE guild_id = 'guild-upgrade-contract' ORDER BY pipeline_status",
          );
          expect(meetings.rows).toHaveLength(pendingStatuses.length);
          expect(meetings.rows.every((row) => row.has_manifest === true)).toBe(true);
          expect(meetings.rows.map((row) => row.pipeline_status).sort()).toEqual(
            [...pendingStatuses].sort(),
          );

          const jobs = await scopedDatabase.query(
            `
SELECT meeting_id
FROM processing_jobs
WHERE meeting_id = ANY($1::text[])
  AND (status = 'scheduled' OR (status = 'active' AND lease_expires_at <= now()))
`,
            [[...meetingIds.values()]],
          );
          expect(jobs.rows).toHaveLength(pendingStatuses.length - 1);

          const preserved = await scopedDatabase.query(
            `
SELECT
  (SELECT count(*)::integer FROM meeting_audio_segments WHERE meeting_id = ANY($1::text[])) AS audio_count,
  (SELECT count(*)::integer FROM provider_cost_attempts WHERE meeting_id = $2) AS cost_count,
  (SELECT count(*)::integer FROM schema_migrations WHERE checksum IS NULL) AS missing_checksum_count,
  to_regclass('meeting_tasks') IS NOT NULL AS has_meeting_tasks,
  to_regclass('live_meeting_states') IS NOT NULL AS has_live_meeting_states,
  to_regclass('runtime_component_heartbeats') IS NOT NULL AS has_runtime_heartbeats
`,
            [[...meetingIds.values()], transcribingMeetingId],
          );
          expect(preserved.rows).toEqual([
            {
              audio_count: pendingStatuses.length,
              cost_count: 1,
              has_live_meeting_states: true,
              has_meeting_tasks: true,
              has_runtime_heartbeats: true,
              missing_checksum_count: 0,
            },
          ]);

          await expect(meetingStore.listRecoverable()).resolves.toHaveLength(1);
        } finally {
          await scopedDatabase.close();
          await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
          await adminPool.end();
        }
      },
    );

    it("reabre uma incompatibilidade uma vez por versão e mantém o primeiro prazo", async () => {
      const adminPool = new Pool({ connectionString: connectionString ?? "postgresql://invalid" });
      const schemaName = `recovery_${randomUUID().replaceAll("-", "")}`;
      await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
      const scopedDatabase = createPostgresDatabase(withSearchPath(connectionString, schemaName));

      try {
        await scopedDatabase.initialize();
        const meetingId = randomUUID();
        const manifest = markManifestCompleted(
          createManifest({
            aiConfiguration: externalAiConfiguration,
            guildId: "guild-recovery-contract",
            meetingId,
            notificationChannelId: "text-recovery-contract",
            startedAt: "2026-09-03T10:00:00.000Z",
            storageMode: "postgres",
            voiceChannelId: "voice-recovery-contract",
          }),
          "2026-09-03T10:10:00.000Z",
        );
        await new PostgresMeetingStore(scopedDatabase).save(manifest);
        await scopedDatabase.query(
          `
UPDATE processing_jobs
SET status = 'failed', attempt_count = 6, last_failure_code = 'provider_failed'
WHERE meeting_id = $1 AND job_type = 'transcription'
`,
          [meetingId],
        );
        await scopedDatabase.query(
          `
UPDATE meetings
SET pipeline_status = 'failed', failure_code = 'provider_failed',
    transcription_recovery_reason = 'invalid_timestamps',
    artifacts_delete_after = '2026-09-04T10:00:00.000Z'
WHERE meeting_id = $1
`,
          [meetingId],
        );
        const now = () => new Date("2026-09-03T11:00:00.000Z");
        const queue = new DurableJobQueue(scopedDatabase, { now });

        await expect(queue.recoverEligibleTranscriptions(2)).resolves.toEqual([meetingId]);
        await expect(queue.recoverEligibleTranscriptions(2)).resolves.toEqual([]);

        const claimed = await queue.claim("recovery-worker");
        expect(claimed).toMatchObject({
          attemptCount: 1,
          finalAttempt: false,
          maxAttempts: 6,
          meetingId,
        });
        if (claimed === undefined) throw new Error("Expected the recovered transcription job");
        await expect(
          queue.fail(
            { ...claimed, attemptCount: 6, finalAttempt: true },
            "provider_failed",
            "recovery-worker",
            true,
            "invalid_timestamps",
          ),
        ).resolves.toBe("retained");

        await expect(queue.recoverEligibleTranscriptions(3)).resolves.toEqual([meetingId]);
        const networkFailureJob = await queue.claim("network-failure-worker");
        if (networkFailureJob === undefined) {
          throw new Error("Expected the second recovered transcription job");
        }
        await expect(
          queue.fail(
            { ...networkFailureJob, attemptCount: 6, finalAttempt: true },
            "provider_unavailable",
            "network-failure-worker",
            true,
          ),
        ).resolves.toBe("retained");
        await expect(queue.recoverEligibleTranscriptions(3)).resolves.toEqual([]);

        const result = await scopedDatabase.query(
          `
SELECT
  meeting.pipeline_status,
  meeting.artifacts_delete_after,
  job.status AS job_status,
  job.attempt_count,
  job.transcription_recovery_version
FROM meetings AS meeting
JOIN processing_jobs AS job ON job.meeting_id = meeting.meeting_id
WHERE meeting.meeting_id = $1 AND job.job_type = 'transcription'
`,
          [meetingId],
        );
        expect(result.rows).toEqual([
          {
            artifacts_delete_after: new Date("2026-09-04T10:00:00.000Z"),
            attempt_count: 1,
            job_status: "failed",
            pipeline_status: "failed",
            transcription_recovery_version: 3,
          },
        ]);
      } finally {
        await scopedDatabase.close();
        await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
        await adminPool.end();
      }
    });
  },
);

const externalAiConfiguration: MeetingAiConfiguration = {
  language: "auto",
  profileType: "external",
  refinement: { model: "review-model", provider: "openrouter" },
  summary: { model: "summary-model", provider: "openrouter" },
  transcription: {
    model: "openai/whisper-large-v3",
    provider: "openrouter",
    vad: {},
  },
};

function withSearchPath(baseConnectionString: string | undefined, schemaName: string): string {
  if (baseConnectionString === undefined) throw new Error("POSTGRES_TEST_URL is required");
  const url = new URL(baseConnectionString);
  url.searchParams.set("options", `-c search_path=${schemaName}`);
  return url.toString();
}
