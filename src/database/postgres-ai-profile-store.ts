import { z } from "zod";

import { type AiProfile, aiProfileSchema, canonicalizeAiProfileDefaults } from "../ai-profile.js";
import type { PostgresExecutor } from "./postgres-database.js";

const identifierSchema = z.string().min(1).max(256);
const rowSchema = z.object({
  language: z.unknown(),
  name: z.string().min(1),
  profile_id: z.string().min(1),
  profile_type: z.enum(["external", "local"]),
  refinement: z.unknown(),
  summary: z.unknown(),
  transcription: z.unknown(),
  translation: z.unknown().nullable(),
});

export interface AiProfileStore {
  clearActiveProfile(guildId: string): Promise<void>;
  createProfile(profile: AiProfile): Promise<void>;
  deleteProfile(profileId: string): Promise<void>;
  getActiveProfile(guildId: string): Promise<AiProfile | undefined>;
  listActiveProfileCounts(): Promise<ReadonlyMap<string, number>>;
  listActiveProfileIds(): Promise<Set<string>>;
  listProfiles(): Promise<AiProfile[]>;
  setActiveProfile(guildId: string, profileId: string): Promise<void>;
  updateProfile(profile: AiProfile): Promise<void>;
}

export class StoredAiProfileValidationError extends Error {
  public constructor(cause: unknown) {
    super("Stored AI profile does not match the current contract", { cause });
    this.name = "StoredAiProfileValidationError";
  }
}

export class PostgresAiProfileStore implements AiProfileStore {
  readonly #database: PostgresExecutor;

  public constructor(database: PostgresExecutor) {
    this.#database = database;
  }

  public async clearActiveProfile(guildId: string): Promise<void> {
    await this.#database.query(
      `UPDATE guild_configurations
       SET active_ai_profile_id = NULL, updated_at = now()
       WHERE guild_id = $1`,
      [identifierSchema.parse(guildId)],
    );
  }

  public async createProfile(input: AiProfile): Promise<void> {
    const profile = aiProfileSchema.parse(input);
    await this.#database.query(
      `INSERT INTO ai_profiles (
         profile_id, profile_type, name, transcription, refinement, summary, language, translation
       ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8::jsonb)`,
      serializeProfile(profile),
    );
  }

  public async deleteProfile(profileId: string): Promise<void> {
    const result = await this.#database.query(
      `WITH deleted_profile AS (
         DELETE FROM ai_profiles AS profile
         WHERE profile.profile_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM guild_configurations
             WHERE active_ai_profile_id = profile.profile_id
           )
         RETURNING profile.profile_id
       )
       SELECT EXISTS (SELECT 1 FROM deleted_profile) AS deleted`,
      [identifierSchema.parse(profileId)],
    );
    const parsed = z.object({ deleted: z.boolean() }).safeParse(result.rows[0]);
    if (!parsed.success || !parsed.data.deleted) {
      throw new Error("AI profile cannot be deleted while active");
    }
  }

  public async getActiveProfile(guildId: string): Promise<AiProfile | undefined> {
    const result = await this.#database.query(
      `SELECT profile.profile_id, profile.profile_type, profile.name, profile.transcription,
              profile.refinement, profile.summary, profile.language, profile.translation
       FROM guild_configurations AS guild
       JOIN ai_profiles AS profile ON profile.profile_id = guild.active_ai_profile_id
       WHERE guild.guild_id = $1`,
      [identifierSchema.parse(guildId)],
    );
    return result.rows[0] === undefined ? undefined : parseProfileRow(result.rows[0]);
  }

  public async listProfiles(): Promise<AiProfile[]> {
    const result = await this.#database.query(
      `SELECT profile_id, profile_type, name, transcription, refinement, summary,
              language, translation
       FROM ai_profiles
       ORDER BY profile_type, created_at, profile_id`,
    );
    return result.rows.map((row) => parseProfileRow(row));
  }

  public async listActiveProfileIds(): Promise<Set<string>> {
    const result = await this.#database.query(
      `SELECT DISTINCT active_ai_profile_id AS profile_id
       FROM guild_configurations
       WHERE active_ai_profile_id IS NOT NULL`,
    );
    return new Set(
      z
        .array(z.object({ profile_id: z.string().min(1) }))
        .parse(result.rows)
        .map((row) => row.profile_id),
    );
  }

  public async listActiveProfileCounts(): Promise<ReadonlyMap<string, number>> {
    const result = await this.#database.query(
      `SELECT active_ai_profile_id AS profile_id, count(*)::int AS server_count
       FROM guild_configurations
       WHERE active_ai_profile_id IS NOT NULL
       GROUP BY active_ai_profile_id`,
    );
    return new Map(
      z
        .array(
          z.object({
            profile_id: z.string().min(1),
            server_count: z.coerce.number().int().nonnegative(),
          }),
        )
        .parse(result.rows)
        .map((row) => [row.profile_id, row.server_count] as const),
    );
  }

  public async setActiveProfile(guildId: string, profileId: string): Promise<void> {
    const result = await this.#database.query(
      `UPDATE guild_configurations
       SET active_ai_profile_id = $2, updated_at = now()
       WHERE guild_id = $1
         AND EXISTS (SELECT 1 FROM ai_profiles WHERE profile_id = $2)`,
      [identifierSchema.parse(guildId), identifierSchema.parse(profileId)],
    );
    ensureProfileWasChanged(result.rowCount);
  }

  public async updateProfile(input: AiProfile): Promise<void> {
    const profile = aiProfileSchema.parse(input);
    const result = await this.#database.query(
      `UPDATE ai_profiles
       SET name = $3,
           transcription = $4::jsonb,
           refinement = $5::jsonb,
           summary = $6::jsonb,
           language = $7,
           translation = $8::jsonb,
           updated_at = now()
       WHERE profile_id = $1 AND profile_type = $2`,
      serializeProfile(profile),
    );
    ensureProfileWasChanged(result.rowCount);
  }
}

function ensureProfileWasChanged(rowCount: number | null): void {
  if (rowCount !== 1) throw new Error("AI profile is unavailable");
}

function parseProfileRow(input: unknown): AiProfile {
  try {
    const row = rowSchema.parse(input);
    return aiProfileSchema.parse({
      language: row.language,
      name: row.name,
      profileId: row.profile_id,
      profileType: row.profile_type,
      refinement: row.refinement,
      summary: row.summary,
      transcription: row.transcription,
      translation: row.translation,
    });
  } catch (error) {
    if (error instanceof z.ZodError) throw new StoredAiProfileValidationError(error);
    throw error;
  }
}

function serializeProfile(profile: AiProfile): readonly unknown[] {
  const canonical = canonicalizeAiProfileDefaults(profile);
  return [
    canonical.profileId,
    canonical.profileType,
    canonical.name,
    JSON.stringify(canonical.transcription),
    JSON.stringify(canonical.refinement),
    JSON.stringify(canonical.summary),
    canonical.language,
    canonical.translation === null ? null : JSON.stringify(canonical.translation),
  ];
}
