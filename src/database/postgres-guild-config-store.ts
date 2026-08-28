import { z } from "zod";

import {
  DEFAULT_GUILD_SETTINGS,
  type GuildConfigurationStore,
  type GuildSettings,
  type SummaryForumConfiguration,
} from "../guild-config-store.js";
import type { PostgresExecutor } from "./postgres-database.js";

const identifierSchema = z.string().min(1).max(128);
const recordingRolesSchema = z.array(z.string().min(1).max(128));
const summaryForumSchema = z.object({
  forumId: z.string().min(1).max(128),
  tagId: z.string().min(1).max(128).optional(),
});
const guildSettingsSchema = z.object({
  botLanguage: z.enum(["en", "pt-BR"]),
  persistMeetingAudio: z.boolean(),
  persistMeetingContent: z.boolean(),
});

export class PostgresGuildConfigStore implements GuildConfigurationStore {
  readonly #database: PostgresExecutor;

  public constructor(database: PostgresExecutor) {
    this.#database = database;
  }

  public async listRecordingRoles(guildId: string): Promise<string[]> {
    const result = await this.#database.query(
      "SELECT recording_role_ids FROM guild_configurations WHERE guild_id = $1",
      [identifierSchema.parse(guildId)],
    );
    const row = result.rows[0];
    return row === undefined ? [] : recordingRolesSchema.parse(row.recording_role_ids);
  }

  public async getSummaryForum(guildId: string): Promise<SummaryForumConfiguration | undefined> {
    const result = await this.#database.query(
      "SELECT summary_forum FROM guild_configurations WHERE guild_id = $1",
      [identifierSchema.parse(guildId)],
    );
    const value = result.rows[0]?.summary_forum;
    return value === undefined || value === null ? undefined : summaryForumSchema.parse(value);
  }

  public async getGuildSettings(guildId: string): Promise<GuildSettings> {
    const result = await this.#database.query(
      `SELECT bot_language, persist_meeting_content, persist_meeting_audio
       FROM guild_configurations WHERE guild_id = $1`,
      [identifierSchema.parse(guildId)],
    );
    const row = result.rows[0];
    if (row === undefined) return { ...DEFAULT_GUILD_SETTINGS };
    return guildSettingsSchema.parse({
      botLanguage: row.bot_language,
      persistMeetingAudio: row.persist_meeting_audio,
      persistMeetingContent: row.persist_meeting_content,
    });
  }

  public async setGuildSettings(guildId: string, settings: GuildSettings): Promise<void> {
    const validated = guildSettingsSchema.parse(settings);
    await this.#database.query(
      `INSERT INTO guild_configurations (
         guild_id, bot_language, persist_meeting_content, persist_meeting_audio
       ) VALUES ($1, $2, $3, $4)
       ON CONFLICT (guild_id) DO UPDATE SET
         bot_language = EXCLUDED.bot_language,
         persist_meeting_content = EXCLUDED.persist_meeting_content,
         persist_meeting_audio = EXCLUDED.persist_meeting_audio,
         updated_at = now()`,
      [
        identifierSchema.parse(guildId),
        validated.botLanguage,
        validated.persistMeetingContent,
        validated.persistMeetingAudio,
      ],
    );
  }

  public async addRecordingRole(guildId: string, roleId: string): Promise<void> {
    await this.#database.query(
      `
INSERT INTO guild_configurations (guild_id, recording_role_ids)
VALUES ($1, jsonb_build_array($2::text))
ON CONFLICT (guild_id) DO UPDATE SET
  recording_role_ids = CASE
    WHEN guild_configurations.recording_role_ids @> jsonb_build_array($2::text)
      THEN guild_configurations.recording_role_ids
    ELSE guild_configurations.recording_role_ids || jsonb_build_array($2::text)
  END,
  updated_at = now()
`,
      [identifierSchema.parse(guildId), identifierSchema.parse(roleId)],
    );
  }

  public async removeRecordingRole(guildId: string, roleId: string): Promise<void> {
    await this.#database.query(
      `
UPDATE guild_configurations
SET recording_role_ids = (
  SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
  FROM jsonb_array_elements(recording_role_ids) AS value
  WHERE value <> to_jsonb($2::text)
), updated_at = now()
WHERE guild_id = $1
`,
      [identifierSchema.parse(guildId), identifierSchema.parse(roleId)],
    );
  }

  public async setSummaryForum(
    guildId: string,
    summaryForum: SummaryForumConfiguration,
  ): Promise<void> {
    const validated = summaryForumSchema.parse(summaryForum);
    await this.#database.query(
      `
INSERT INTO guild_configurations (guild_id, summary_forum)
VALUES ($1, $2::jsonb)
ON CONFLICT (guild_id) DO UPDATE SET summary_forum = EXCLUDED.summary_forum, updated_at = now()
`,
      [identifierSchema.parse(guildId), JSON.stringify(validated)],
    );
  }

  public async clearSummaryForum(guildId: string): Promise<void> {
    await this.#database.query(
      "UPDATE guild_configurations SET summary_forum = NULL, updated_at = now() WHERE guild_id = $1",
      [identifierSchema.parse(guildId)],
    );
  }
}
