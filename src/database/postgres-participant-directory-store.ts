import { z } from "zod";

import type { PostgresExecutor } from "./postgres-database.js";

const identifierSchema = z.string().min(1).max(128);
const rowSchema = z.object({
  avatar_url: z.url().nullable(),
  display_name: z.string().min(1),
  total: z.coerce.number().int().nonnegative(),
  user_id: identifierSchema,
});

export interface MeetingParticipantDirectoryPage {
  items: { avatarUrl: string | null; displayName: string; userId: string }[];
  page: number;
  pageSize: number;
  total: number;
}

export class PostgresParticipantDirectoryStore {
  readonly #database: PostgresExecutor;

  public constructor(database: PostgresExecutor) {
    this.#database = database;
  }

  public async list(
    guildId: string,
    options: { page: number; pageSize: number; query?: string },
  ): Promise<MeetingParticipantDirectoryPage> {
    const validated = z
      .object({
        page: z.number().int().positive(),
        pageSize: z.number().int().min(1).max(100),
        query: z.string().trim().max(100).optional(),
      })
      .parse(options);
    const result = await this.#database.query(
      `WITH candidates AS (
         SELECT participant.user_id, participant.display_name, participant.avatar_url,
                meeting.started_at AS observed_at
         FROM meeting_participants participant
         JOIN meetings meeting ON meeting.meeting_id = participant.meeting_id
         WHERE participant.guild_id = $1
         UNION ALL
         SELECT item->>'userId', item->>'displayName', item->>'avatarUrl', state.updated_at
         FROM live_meeting_states state
         CROSS JOIN LATERAL jsonb_array_elements(state.participants) item
         WHERE state.guild_id = $1 AND state.expires_at > now()
       ), latest AS (
         SELECT DISTINCT ON (user_id) user_id, display_name, avatar_url
         FROM candidates
         ORDER BY user_id, observed_at DESC
       ), filtered AS (
         SELECT user_id, display_name, avatar_url
         FROM latest
         WHERE ($2::text IS NULL OR display_name ILIKE '%' || $2 || '%')
       )
       SELECT user_id, display_name, avatar_url, count(*) OVER()::int AS total
       FROM filtered
       ORDER BY lower(display_name), user_id
       LIMIT $3 OFFSET $4`,
      [
        identifierSchema.parse(guildId),
        validated.query ?? null,
        validated.pageSize,
        (validated.page - 1) * validated.pageSize,
      ],
    );
    return {
      items: result.rows.map((input) => {
        const row = rowSchema.parse(input);
        return {
          avatarUrl: row.avatar_url,
          displayName: row.display_name,
          userId: row.user_id,
        };
      }),
      page: validated.page,
      pageSize: validated.pageSize,
      total: rowSchema.safeParse(result.rows[0]).data?.total ?? 0,
    };
  }
}
