import { z } from "zod";
import type { PostgresExecutor } from "./postgres-database.js";

const guildIdSchema = z.string().min(1).max(128);
const guildNameSchema = z.string().trim().min(1).max(100);
const guildRowSchema = z.object({
  guild_id: guildIdSchema,
  guild_name: guildNameSchema,
  icon_url: z.url().max(2048).nullable(),
});

export type HistoricalGuild = { iconUrl: string | null; id: string; name: string };

export class PostgresGuildHistoryStore {
  readonly #database: PostgresExecutor;

  public constructor(database: PostgresExecutor) {
    this.#database = database;
  }

  public async remember(guildId: string, name: string, iconUrl: string | null): Promise<void> {
    await this.#database.query(
      `INSERT INTO guild_history (guild_id, guild_name, icon_url)
       VALUES ($1, $2, $3)
       ON CONFLICT (guild_id) DO UPDATE SET
         guild_name = EXCLUDED.guild_name,
         icon_url = EXCLUDED.icon_url,
         updated_at = now()`,
      [
        guildIdSchema.parse(guildId),
        guildNameSchema.parse(name),
        z.url().nullable().parse(iconUrl),
      ],
    );
  }

  public async list(): Promise<HistoricalGuild[]> {
    const result = await this.#database.query(
      `SELECT guild_id, guild_name, icon_url
       FROM guild_history AS history
       WHERE EXISTS (SELECT 1 FROM meetings WHERE guild_id = history.guild_id)
       ORDER BY guild_name, guild_id`,
    );
    return result.rows.map((row) => {
      const parsed = guildRowSchema.parse(row);
      return { iconUrl: parsed.icon_url, id: parsed.guild_id, name: parsed.guild_name };
    });
  }

  public async hasMeetings(guildId: string): Promise<boolean> {
    const result = await this.#database.query(
      "SELECT EXISTS (SELECT 1 FROM meetings WHERE guild_id = $1) AS has_meetings",
      [guildIdSchema.parse(guildId)],
    );
    return z.boolean().parse(result.rows[0]?.has_meetings);
  }

  public async cancelPending(guildId: string): Promise<string[]> {
    const result = await this.#database.query(
      `WITH cancelled_meetings AS (
         UPDATE meetings
         SET pipeline_status = 'failed', failure_code = 'bot_left_guild',
             artifacts_delete_after = NULL, updated_at = now()
         WHERE guild_id = $1 AND pipeline_status NOT IN ('completed', 'failed')
         RETURNING meeting_id
       ), cancelled_jobs AS (
         UPDATE processing_jobs
         SET status = 'failed', last_failure_code = 'bot_left_guild',
             lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
         WHERE meeting_id IN (SELECT meeting_id FROM cancelled_meetings)
           AND status IN ('scheduled', 'active')
         RETURNING job_id
       )
       SELECT meeting_id FROM cancelled_meetings`,
      [guildIdSchema.parse(guildId)],
    );
    return result.rows.map((row) => guildIdSchema.parse(row.meeting_id));
  }
}
