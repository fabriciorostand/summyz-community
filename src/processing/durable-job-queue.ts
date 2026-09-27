import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { PostgresExecutor } from "../database/postgres-database.js";
import {
  CURRENT_TRANSCRIPTION_RECOVERY_VERSION,
  TRANSCRIPTION_FAILURE_RETENTION_MS,
  type TranscriptionRecoveryReason,
  transcriptionRecoveryReasonSchema,
} from "../transcription/transcription-recovery-policy.js";

const jobTypeSchema = z.enum(["transcription", "refinement", "summary"]);
export type ProcessingJobType = z.infer<typeof jobTypeSchema>;

const claimedJobRowSchema = z.object({
  attempt_count: z.number().int().positive(),
  available_at: z.coerce.date(),
  job_id: z.uuid(),
  job_type: jobTypeSchema,
  lease_expires_at: z.coerce.date(),
  max_attempts: z.number().int().positive(),
  meeting_id: z.string().min(1),
});

export interface ClaimedProcessingJob {
  attemptCount: number;
  availableAt: Date;
  finalAttempt: boolean;
  jobId: string;
  jobType: ProcessingJobType;
  leaseExpiresAt: Date;
  maxAttempts: number;
  meetingId: string;
}

interface DurableJobQueueOptions {
  createId?: () => string;
  leaseMs?: number;
  now?: () => Date;
}

const MAX_JOB_ATTEMPTS = 6;
const RETRY_DELAYS_MS = [60_000, 300_000, 900_000, 3_600_000, 21_600_000] as const;
const DEFAULT_LEASE_MS = 5 * 60_000;

export class DurableJobQueue {
  readonly #createId: () => string;
  readonly #database: PostgresExecutor;
  readonly #leaseMs: number;
  readonly #now: () => Date;

  public constructor(database: PostgresExecutor, options: DurableJobQueueOptions = {}) {
    this.#createId = options.createId ?? randomUUID;
    this.#database = database;
    this.#leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    this.#now = options.now ?? (() => new Date());
  }

  public async enqueue(meetingId: string, jobType: ProcessingJobType): Promise<boolean> {
    const validatedMeetingId = z.string().min(1).max(128).parse(meetingId);
    const validatedJobType = jobTypeSchema.parse(jobType);
    const result = await this.#database.query(
      `
INSERT INTO processing_jobs (
  job_id, meeting_id, job_type, status, available_at, max_attempts,
  transcription_recovery_version
) VALUES ($1, $2, $3, 'scheduled', $4, $5, $6)
ON CONFLICT (meeting_id, job_type) DO NOTHING
RETURNING job_id
`,
      [
        this.#createId(),
        validatedMeetingId,
        validatedJobType,
        this.#now().toISOString(),
        MAX_JOB_ATTEMPTS,
        CURRENT_TRANSCRIPTION_RECOVERY_VERSION,
      ],
    );
    return result.rowCount === 1;
  }

  public async claim(workerId: string): Promise<ClaimedProcessingJob | undefined> {
    const validatedWorkerId = z.string().min(1).max(128).parse(workerId);
    const now = this.#now();
    const leaseExpiresAt = new Date(now.getTime() + this.#leaseMs);
    const result = await this.#database.query(
      `
WITH candidate AS (
  SELECT job_id
  FROM processing_jobs
  WHERE
    (status = 'scheduled' AND available_at <= $1)
    OR (status = 'active' AND lease_expires_at <= $1)
  ORDER BY available_at, created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
UPDATE processing_jobs AS job
SET
  status = 'active',
  attempt_count = job.attempt_count + 1,
  lease_owner = $2,
  lease_expires_at = $3,
  updated_at = $1
FROM candidate
WHERE job.job_id = candidate.job_id
RETURNING
  job.job_id,
  job.meeting_id,
  job.job_type,
  job.attempt_count,
  job.max_attempts,
  job.available_at,
  job.lease_expires_at
`,
      [now.toISOString(), validatedWorkerId, leaseExpiresAt.toISOString()],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }
    const parsed = claimedJobRowSchema.parse(row);
    return {
      attemptCount: parsed.attempt_count,
      availableAt: parsed.available_at,
      finalAttempt: parsed.attempt_count >= parsed.max_attempts,
      jobId: parsed.job_id,
      jobType: parsed.job_type,
      leaseExpiresAt: parsed.lease_expires_at,
      maxAttempts: parsed.max_attempts,
      meetingId: parsed.meeting_id,
    };
  }

  public async complete(job: ClaimedProcessingJob, workerId: string): Promise<void> {
    const now = this.#now().toISOString();
    await this.#database.query(
      `
WITH completed_job AS (
UPDATE processing_jobs
SET
  status = 'completed',
  completed_at = $3,
  lease_owner = NULL,
  lease_expires_at = NULL,
  updated_at = $3
WHERE job_id = $1 AND status = 'active' AND lease_owner = $2
RETURNING meeting_id, job_type
)
UPDATE meetings
SET pipeline_status = 'completed', failure_code = NULL, manifest = NULL, updated_at = $3
WHERE meeting_id IN (
  SELECT meeting_id FROM completed_job WHERE job_type = 'summary'
)
`,
      [job.jobId, workerId, now],
    );
  }

  public async renew(job: ClaimedProcessingJob, workerId: string): Promise<void> {
    const now = this.#now();
    const leaseExpiresAt = new Date(now.getTime() + this.#leaseMs).toISOString();
    await this.#database.query(
      `
UPDATE processing_jobs
SET lease_expires_at = $3, updated_at = $4
WHERE job_id = $1 AND status = 'active' AND lease_owner = $2
`,
      [job.jobId, workerId, leaseExpiresAt, now.toISOString()],
    );
  }

  public async fail(
    job: ClaimedProcessingJob,
    failureCode: string,
    workerId: string,
    terminal = false,
    transcriptionRecoveryReason?: TranscriptionRecoveryReason,
  ): Promise<"failed" | "retained" | "scheduled"> {
    if (failureCode === "local_models_missing" || failureCode === "local_models_unavailable") {
      await this.#database.query(
        `WITH waiting AS (
        UPDATE processing_jobs SET status = 'scheduled', attempt_count = greatest(0, attempt_count - 1),
          available_at = now() + interval '30 seconds', last_failure_code = $3,
          lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
        WHERE job_id = $1 AND status = 'active' AND lease_owner = $2 RETURNING meeting_id
      ) UPDATE meetings SET failure_code = $3, updated_at = now()
        WHERE meeting_id IN (SELECT meeting_id FROM waiting)`,
        [job.jobId, workerId, failureCode],
      );
      return "scheduled";
    }
    const validatedFailureCode = z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9_]+$/)
      .parse(failureCode);
    const now = this.#now();
    const validatedRecoveryReason =
      transcriptionRecoveryReason === undefined
        ? null
        : transcriptionRecoveryReasonSchema.parse(transcriptionRecoveryReason);
    if (terminal || job.finalAttempt || job.attemptCount >= job.maxAttempts) {
      const artifactsDeleteAfter = new Date(
        now.getTime() + TRANSCRIPTION_FAILURE_RETENTION_MS,
      ).toISOString();
      const result = await this.#database.query(
        `
WITH failed_job AS (
UPDATE processing_jobs
SET
  status = 'failed',
  last_failure_code = $3,
  lease_owner = NULL,
  lease_expires_at = NULL,
  updated_at = $4
WHERE job_id = $1 AND status = 'active' AND lease_owner = $2
RETURNING meeting_id, job_type
)
UPDATE meetings AS meeting
SET
  pipeline_status = 'failed',
  failure_code = $3,
  manifest = CASE
    WHEN EXISTS (SELECT 1 FROM failed_job WHERE job_type = 'transcription')
      AND (
        $5::text IS NOT NULL
        OR (
          meeting.transcription_recovery_reason IS NOT NULL
          AND meeting.artifacts_delete_after > $4::timestamptz
        )
      )
      THEN manifest
    ELSE NULL
  END,
  transcription_recovery_reason = CASE
    WHEN EXISTS (SELECT 1 FROM failed_job WHERE job_type = 'transcription')
      AND (
        $5::text IS NOT NULL
        OR (
          meeting.transcription_recovery_reason IS NOT NULL
          AND meeting.artifacts_delete_after > $4::timestamptz
        )
      )
      THEN COALESCE($5::text, meeting.transcription_recovery_reason)
    ELSE NULL
  END,
  artifacts_delete_after = CASE
    WHEN EXISTS (SELECT 1 FROM failed_job WHERE job_type = 'transcription')
      AND (
        $5::text IS NOT NULL
        OR (
          meeting.transcription_recovery_reason IS NOT NULL
          AND meeting.artifacts_delete_after > $4::timestamptz
        )
      )
      THEN COALESCE(artifacts_delete_after, $6::timestamptz)
    ELSE NULL
  END,
  updated_at = $4
WHERE meeting_id IN (SELECT meeting_id FROM failed_job)
RETURNING artifacts_delete_after IS NOT NULL
  AND artifacts_delete_after > $4::timestamptz AS artifacts_retained
`,
        [
          job.jobId,
          workerId,
          validatedFailureCode,
          now.toISOString(),
          validatedRecoveryReason,
          artifactsDeleteAfter,
        ],
      );
      return result.rows[0]?.artifacts_retained === true ? "retained" : "failed";
    }

    const delayMs = RETRY_DELAYS_MS[job.attemptCount - 1];
    if (delayMs === undefined) {
      throw new Error("A política de retry não cobre a tentativa atual");
    }
    const availableAt = new Date(now.getTime() + delayMs).toISOString();
    await this.#database.query(
      `
UPDATE processing_jobs
SET
  status = 'scheduled',
  available_at = $3,
  last_failure_code = $4,
  lease_owner = NULL,
  lease_expires_at = NULL,
  updated_at = $5
WHERE job_id = $1 AND status = 'active' AND lease_owner = $2
`,
      [job.jobId, workerId, availableAt, validatedFailureCode, now.toISOString()],
    );
    return "scheduled";
  }

  public async recoverEligibleTranscriptions(recoveryVersion: number): Promise<string[]> {
    const validatedRecoveryVersion = z.number().int().positive().parse(recoveryVersion);
    const now = this.#now().toISOString();
    const result = await this.#database.query(
      `
WITH eligible AS (
  SELECT job.job_id
  FROM processing_jobs AS job
  JOIN meetings AS meeting ON meeting.meeting_id = job.meeting_id
  WHERE job.job_type = 'transcription'
    AND job.status = 'failed'
    AND job.transcription_recovery_version < $1
    AND meeting.pipeline_status = 'failed'
    AND meeting.transcription_recovery_reason IS NOT NULL
    AND meeting.artifacts_delete_after > $2
    AND meeting.artifacts_deleted_at IS NULL
    AND meeting.manifest IS NOT NULL
  FOR UPDATE OF job SKIP LOCKED
), recovered_jobs AS (
  UPDATE processing_jobs AS job
  SET
    status = 'scheduled',
    attempt_count = 0,
    max_attempts = $3,
    available_at = $2,
    last_failure_code = NULL,
    lease_owner = NULL,
    lease_expires_at = NULL,
    completed_at = NULL,
    transcription_recovery_version = $1,
    updated_at = $2
  FROM eligible
  WHERE job.job_id = eligible.job_id
  RETURNING job.meeting_id
)
UPDATE meetings AS meeting
SET pipeline_status = 'queued', failure_code = NULL, updated_at = $2
FROM recovered_jobs
WHERE meeting.meeting_id = recovered_jobs.meeting_id
RETURNING meeting.meeting_id
`,
      [validatedRecoveryVersion, now, MAX_JOB_ATTEMPTS],
    );
    return result.rows.map((row) => z.string().min(1).max(128).parse(row.meeting_id));
  }
}
