import { z } from "zod";

import type { PostgresExecutor } from "./postgres-database.js";

const identifierSchema = z.string().min(1).max(128);
const taskIdSchema = z.uuid();
const taskRowSchema = z.object({
  completed_at: z.union([z.string(), z.date()]).nullable(),
  completed_by_user_id: z.string().nullable(),
  deadline_date: z.union([z.string(), z.date()]).nullable(),
  deadline_precision: z.enum(["date", "minute"]).nullable(),
  deadline_text: z.string().nullable(),
  deadline_time: z.string().nullable(),
  deadline_time_zone: z.string().nullable(),
  meeting_id: identifierSchema,
  owner_avatar_url: z.url().nullable(),
  owner_display_name: z.string().nullable(),
  overdue: z.boolean(),
  owner_name: z.string().nullable(),
  owner_user_id: z.string().nullable(),
  task_id: taskIdSchema,
  task_text: z.string().min(1),
});

export interface DashboardTask {
  completedAt: string | null;
  completedByUserId: string | null;
  deadlineDate: string | null;
  deadlinePrecision: "date" | "minute" | null;
  deadlineText: string | null;
  deadlineTime: string | null;
  deadlineTimeZone: string | null;
  meetingId: string;
  ownerAvatarUrl: string | null;
  ownerDisplayName: string | null;
  overdue: boolean;
  ownerName: string | null;
  ownerUserId: string | null;
  taskId: string;
  text: string;
}

export class PostgresTaskStore {
  readonly #database: PostgresExecutor;

  public constructor(database: PostgresExecutor) {
    this.#database = database;
  }

  public async list(
    guildId: string,
    filters: { completed?: boolean; meetingId?: string } = {},
  ): Promise<DashboardTask[]> {
    const result = await this.#database.query(
      `SELECT task.task_id, task.meeting_id, task.task_text, task.owner_name, task.owner_user_id,
              deadline_text, deadline_date, deadline_time, deadline_time_zone,
              deadline_precision, completed_at, completed_by_user_id,
              owner_profile.display_name AS owner_display_name,
              owner_profile.avatar_url AS owner_avatar_url,
              CASE
                WHEN completed_at IS NOT NULL OR deadline_date IS NULL THEN false
                WHEN deadline_precision = 'minute' THEN
                  ((deadline_date + deadline_time) AT TIME ZONE deadline_time_zone) < now()
                ELSE
                  ((deadline_date + interval '1 day')::timestamp AT TIME ZONE deadline_time_zone) <= now()
              END AS overdue
       FROM meeting_tasks task
       LEFT JOIN LATERAL (
         SELECT participant.display_name, participant.avatar_url
         FROM meeting_participants participant
         JOIN meetings meeting ON meeting.meeting_id = participant.meeting_id
         WHERE participant.guild_id = task.guild_id
           AND participant.user_id = task.owner_user_id
         ORDER BY meeting.started_at DESC, participant.meeting_id
         LIMIT 1
       ) owner_profile ON true
       WHERE task.guild_id = $1
         AND ($2::boolean IS NULL OR (completed_at IS NOT NULL) = $2)
         AND ($3::text IS NULL OR task.meeting_id = $3)
       ORDER BY completed_at NULLS FIRST, deadline_date NULLS LAST, deadline_time NULLS LAST,
                created_at DESC, task_index`,
      [
        identifierSchema.parse(guildId),
        filters.completed ?? null,
        filters.meetingId === undefined ? null : identifierSchema.parse(filters.meetingId),
      ],
    );
    return result.rows.map(mapTaskRow);
  }

  public async setCompleted(
    guildId: string,
    taskId: string,
    completedByUserId: string,
    completed: boolean,
  ): Promise<void> {
    const result = await this.#database.query(
      `UPDATE meeting_tasks
       SET completed_at = CASE WHEN $4 THEN now() ELSE NULL END,
           completed_by_user_id = CASE WHEN $4 THEN $3 ELSE NULL END,
           updated_at = now()
       WHERE guild_id = $1 AND task_id = $2::uuid`,
      [
        identifierSchema.parse(guildId),
        taskIdSchema.parse(taskId),
        identifierSchema.parse(completedByUserId),
        z.boolean().parse(completed),
      ],
    );
    if (result.rowCount === 0) throw new Error("Task not found");
  }
}

function mapTaskRow(input: unknown): DashboardTask {
  const row = taskRowSchema.parse(input);
  return {
    completedAt: toIsoDateTime(row.completed_at),
    completedByUserId: row.completed_by_user_id,
    deadlineDate: toDateOnly(row.deadline_date),
    deadlinePrecision: row.deadline_precision,
    deadlineText: row.deadline_text,
    deadlineTime: row.deadline_time?.slice(0, 5) ?? null,
    deadlineTimeZone: row.deadline_time_zone,
    meetingId: row.meeting_id,
    ownerAvatarUrl: row.owner_avatar_url,
    ownerDisplayName: row.owner_display_name,
    overdue: row.overdue,
    ownerName: row.owner_name,
    ownerUserId: row.owner_user_id,
    taskId: row.task_id,
    text: row.task_text,
  };
}

function toIsoDateTime(value: string | Date | null): string | null {
  if (value === null) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function toDateOnly(value: string | Date | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}
