import { randomUUID } from "node:crypto";

import { z } from "zod";

import { recordingManifestSchema } from "../recording/manifest.js";
import { publicationStateSchema } from "../summary/publication-state.js";
import { summaryStateSchema } from "../summary/summary-state.js";
import type { PostgresExecutor } from "./postgres-database.js";

const contentInputSchema = z.object({
  manifest: recordingManifestSchema,
  meetingId: z.string().min(1).max(128),
  publication: publicationStateSchema,
  rawTranscript: z.string(),
  summary: z.unknown(),
  transcript: z.string(),
});

export interface MeetingContentInput {
  manifest: z.infer<typeof recordingManifestSchema>;
  meetingId: string;
  publication: z.infer<typeof publicationStateSchema>;
  rawTranscript: string;
  summary: unknown;
  transcript: string;
}

export class PostgresMeetingContentStore {
  readonly #database: PostgresExecutor;

  public constructor(database: PostgresExecutor) {
    this.#database = database;
  }

  public async persist(input: MeetingContentInput): Promise<boolean> {
    const validated = contentInputSchema.parse(input);
    const serializedSummary = serializeJson(validated.summary);
    const serializedPublication = serializeJson(validated.publication);
    const serializedManifest = serializeJson(validated.manifest);
    const serializedTasks = serializeJson(extractTasks(validated.summary));
    await this.#database.query(
      `
WITH saved_content AS (
INSERT INTO meeting_contents (
  meeting_id, raw_transcript, transcript, summary, publication, meeting_manifest
) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)
ON CONFLICT (meeting_id) DO UPDATE SET
  raw_transcript = EXCLUDED.raw_transcript,
  transcript = EXCLUDED.transcript,
  summary = EXCLUDED.summary,
  publication = EXCLUDED.publication,
  meeting_manifest = EXCLUDED.meeting_manifest,
  persisted_at = now()
RETURNING meeting_id
)
INSERT INTO meeting_tasks (
  task_id, meeting_id, guild_id, task_index, task_text, owner_name, owner_user_id,
  deadline_text, deadline_date, deadline_time, deadline_time_zone, deadline_precision
)
SELECT task.task_id::uuid, saved_content.meeting_id, meeting.guild_id, task.task_index,
       task.task_text, task.owner_name, owner.user_id, task.deadline_text,
       task.deadline_date::date, task.deadline_time::time, task.deadline_time_zone,
       task.deadline_precision
FROM saved_content
JOIN meetings meeting ON meeting.meeting_id = saved_content.meeting_id
CROSS JOIN jsonb_to_recordset($7::jsonb) AS task(
  task_id text, task_index integer, task_text text, owner_name text, deadline_text text,
  deadline_date text, deadline_time text, deadline_time_zone text, deadline_precision text
)
LEFT JOIN LATERAL (
  SELECT CASE WHEN count(*) = 1 THEN min(participant.user_id) END AS user_id
  FROM meeting_participants participant
  WHERE participant.meeting_id = saved_content.meeting_id
    AND lower(participant.display_name) = lower(task.owner_name)
) owner ON true
ON CONFLICT (meeting_id, task_index) DO NOTHING
`,
      [
        validated.meetingId,
        validated.rawTranscript,
        validated.transcript,
        serializedSummary,
        serializedPublication,
        serializedManifest,
        serializedTasks,
      ],
    );
    return true;
  }

  public async persistPublication(meetingId: string, input: unknown): Promise<void> {
    const validatedMeetingId = z.string().min(1).max(128).parse(meetingId);
    const publication = publicationStateSchema.parse(input);
    if (publication.status !== "completed") {
      throw new Error("Only a completed Discord publication can be persisted");
    }
    await this.#database.query(
      `UPDATE meetings
       SET publication_thread_id = $2, publication_root_message_id = $3, updated_at = now()
       WHERE meeting_id = $1`,
      [validatedMeetingId, publication.threadId, publication.rootMessageId],
    );
  }
}

function extractTasks(summary: unknown): Record<string, unknown>[] {
  const state = summaryStateSchema.safeParse(summary);
  if (!state.success || state.data.status !== "completed") return [];
  return state.data.summary.tasks.map((task, taskIndex) => ({
    deadline_date: nullWhenUndefined(task.deadlineDate),
    deadline_precision: nullWhenUndefined(task.deadlinePrecision),
    deadline_text: nullWhenUndefined(task.deadlineText),
    deadline_time: nullWhenUndefined(task.deadlineTime),
    deadline_time_zone: nullWhenUndefined(task.deadlineTimeZone),
    owner_name: nullWhenUndefined(task.ownerName),
    task_id: randomUUID(),
    task_index: taskIndex,
    task_text: task.text,
  }));
}

function nullWhenUndefined<T>(value: T | undefined): T | null {
  return value ?? null;
}

function serializeJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("O resumo não pode ser serializado como JSON");
  }
  return serialized;
}
