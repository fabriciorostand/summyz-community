import { z } from "zod";

import {
  type AiProfile,
  aiProfileSchema,
  canonicalizeAiProfileDefaults,
  createInitialAiProfiles,
} from "../ai-profile.js";
import type { PostgresExecutor } from "./postgres-database.js";

const identifierSchema = z.string().min(1).max(256);
const rowSchema = z.object({
  name: z.string().min(1),
  owner_user_id: z.string().min(1),
  profile_id: z.string().min(1),
  profile_type: z.enum(["external", "local"]),
  language: z.unknown(),
  refinement: z.unknown(),
  summary: z.unknown(),
  transcription: z.unknown(),
  translation: z.unknown().nullable(),
});

export interface AiProfileStore {
  clearActiveProfile(guildId: string): Promise<void>;
  createProfile(profile: AiProfile): Promise<void>;
  deleteProfile(userId: string, profileId: string): Promise<void>;
  ensureInitialProfiles(userId: string, language: "en" | "pt-BR"): Promise<void>;
  getActiveProfile(guildId: string): Promise<AiProfile | undefined>;
  getActiveProfileForDiscordOwner(
    guildId: string,
    discordOwnerId: string,
  ): Promise<AiProfile | undefined>;
  listProfiles(userId: string): Promise<AiProfile[]>;
  listActiveProfileIds(userId: string): Promise<Set<string>>;
  listActiveProfileCounts(userId: string): Promise<ReadonlyMap<string, number>>;
  setActiveProfile(guildId: string, userId: string, profileId: string): Promise<void>;
  updateProfile(userId: string, profile: AiProfile): Promise<void>;
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
         profile_id, owner_user_id, profile_type, name, transcription, refinement, summary,
         language, translation
       ) VALUES ($1, $2::uuid, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9::jsonb)`,
      serializeProfile(profile),
    );
  }

  public async deleteProfile(userId: string, profileId: string): Promise<void> {
    const result = await this.#database.query(
      `WITH target AS (
         SELECT profile_id, profile_type
         FROM ai_profiles
         WHERE owner_user_id = $1::uuid AND profile_id = $2
       ), same_type_count AS (
         SELECT count(*) AS total
         FROM ai_profiles AS profile
         JOIN target ON target.profile_type = profile.profile_type
         WHERE profile.owner_user_id = $1::uuid
       ), deleted_profile AS (
         DELETE FROM ai_profiles AS profile
         WHERE profile.owner_user_id = $1::uuid
           AND profile.profile_id = $2
           AND (SELECT total FROM same_type_count) > 1
           AND NOT EXISTS (
             SELECT 1 FROM guild_configurations
             WHERE active_ai_profile_id = profile.profile_id
           )
         RETURNING profile.profile_id
       )
       SELECT EXISTS (SELECT 1 FROM deleted_profile) AS deleted`,
      [identifierSchema.parse(userId), identifierSchema.parse(profileId)],
    );
    const parsed = z.object({ deleted: z.boolean() }).safeParse(result.rows[0]);
    if (!parsed.success || !parsed.data.deleted) {
      throw new Error(
        "AI profile cannot be deleted while active or while it is the last of its type",
      );
    }
  }

  public async ensureInitialProfiles(userId: string, language: "en" | "pt-BR"): Promise<void> {
    const profiles = createInitialAiProfiles(identifierSchema.parse(userId), language);
    for (const profile of profiles) {
      await this.#database.query(
        `INSERT INTO ai_profiles (
           profile_id, owner_user_id, profile_type, name, transcription, refinement, summary,
           language, translation
         ) VALUES ($1, $2::uuid, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9::jsonb)
         ON CONFLICT DO NOTHING`,
        serializeProfile(profile),
      );
    }
  }

  public async getActiveProfile(guildId: string): Promise<AiProfile | undefined> {
    const result = await this.#database.query(
      `SELECT p.profile_id, p.owner_user_id, p.profile_type, p.name,
              p.transcription, p.refinement, p.summary, p.language, p.translation
       FROM guild_configurations AS guild
       JOIN ai_profiles AS p ON p.profile_id = guild.active_ai_profile_id
       WHERE guild.guild_id = $1`,
      [identifierSchema.parse(guildId)],
    );
    return result.rows[0] === undefined ? undefined : parseProfileRow(result.rows[0]);
  }

  public async getActiveProfileForDiscordOwner(
    guildId: string,
    discordOwnerId: string,
  ): Promise<AiProfile | undefined> {
    const result = await this.#database.query(
      `SELECT profile.profile_id, profile.owner_user_id, profile.profile_type, profile.name,
              profile.transcription, profile.refinement, profile.summary,
              profile.language, profile.translation
       FROM guild_configurations AS guild
       JOIN ai_profiles AS profile ON profile.profile_id = guild.active_ai_profile_id
       JOIN discord_connections AS connection ON connection.user_id = profile.owner_user_id
       WHERE guild.guild_id = $1 AND connection.discord_user_id = $2`,
      [identifierSchema.parse(guildId), identifierSchema.parse(discordOwnerId)],
    );
    return result.rows[0] === undefined ? undefined : parseProfileRow(result.rows[0]);
  }

  public async listProfiles(userId: string): Promise<AiProfile[]> {
    const result = await this.#database.query(
      `SELECT profile_id, owner_user_id, profile_type, name, transcription, refinement, summary,
              language, translation
       FROM ai_profiles
       WHERE owner_user_id = $1::uuid
       ORDER BY profile_type, created_at, profile_id`,
      [identifierSchema.parse(userId)],
    );
    return result.rows.map((row) => parseProfileRow(row));
  }

  public async listActiveProfileIds(userId: string): Promise<Set<string>> {
    const result = await this.#database.query(
      `SELECT DISTINCT guild.active_ai_profile_id AS profile_id
       FROM guild_configurations AS guild
       JOIN ai_profiles AS profile ON profile.profile_id = guild.active_ai_profile_id
       WHERE profile.owner_user_id = $1::uuid`,
      [identifierSchema.parse(userId)],
    );
    return new Set(
      z
        .array(z.object({ profile_id: z.string().min(1) }))
        .parse(result.rows)
        .map((row) => row.profile_id),
    );
  }

  public async listActiveProfileCounts(userId: string): Promise<ReadonlyMap<string, number>> {
    const result = await this.#database.query(
      `SELECT guild.active_ai_profile_id AS profile_id, count(*)::int AS server_count
       FROM guild_configurations guild
       JOIN ai_profiles profile ON profile.profile_id = guild.active_ai_profile_id
       WHERE profile.owner_user_id = $1::uuid
       GROUP BY guild.active_ai_profile_id`,
      [identifierSchema.parse(userId)],
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

  public async setActiveProfile(guildId: string, userId: string, profileId: string): Promise<void> {
    const result = await this.#database.query(
      `UPDATE guild_configurations
       SET active_ai_profile_id = $2, updated_at = now()
       WHERE guild_id = $1
         AND EXISTS (
           SELECT 1 FROM ai_profiles
           WHERE profile_id = $2 AND owner_user_id = $3::uuid
         )`,
      [
        identifierSchema.parse(guildId),
        identifierSchema.parse(profileId),
        identifierSchema.parse(userId),
      ],
    );
    ensureProfileWasChanged(result.rowCount);
  }

  public async updateProfile(userId: string, input: AiProfile): Promise<void> {
    const profile = aiProfileSchema.parse(input);
    const validatedUserId = identifierSchema.parse(userId);
    if (profile.userId !== validatedUserId) {
      throw new Error("AI profile is unavailable to this user");
    }
    const result = await this.#database.query(
      `UPDATE ai_profiles
       SET name = $4,
           transcription = $5::jsonb,
           refinement = $6::jsonb,
           summary = $7::jsonb,
           language = $8,
           translation = $9::jsonb,
           updated_at = now()
       WHERE profile_id = $1
         AND owner_user_id = $2::uuid
         AND profile_type = $3`,
      serializeProfile(profile),
    );
    ensureProfileWasChanged(result.rowCount);
  }
}

function ensureProfileWasChanged(rowCount: number | null): void {
  if (rowCount !== 1) {
    throw new Error("AI profile is unavailable to this user");
  }
}

function parseProfileRow(input: unknown): AiProfile {
  try {
    const row = rowSchema.parse(input);
    return aiProfileSchema.parse({
      name: row.name,
      language: row.language,
      profileId: row.profile_id,
      profileType: row.profile_type,
      refinement: row.refinement,
      summary: row.summary,
      transcription: row.transcription,
      translation: row.translation,
      userId: row.owner_user_id,
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
    canonical.userId,
    canonical.profileType,
    canonical.name,
    JSON.stringify(canonical.transcription),
    JSON.stringify(canonical.refinement),
    JSON.stringify(canonical.summary),
    canonical.language,
    canonical.translation === null ? null : JSON.stringify(canonical.translation),
  ];
}
