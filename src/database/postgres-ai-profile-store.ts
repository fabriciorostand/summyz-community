import { z } from "zod";

import { aiProfileSchema, createInitialAiProfile, type AiProfile } from "../ai-profile.js";
import type { PostgresExecutor } from "./postgres-database.js";

const identifierSchema = z.string().min(1).max(128);
const rowSchema = z.object({
  guild_id: z.string().min(1),
  name: z.string().min(1),
  profile_id: z.string().min(1),
  refinement: z.unknown(),
  summary: z.unknown(),
  transcription: z.unknown(),
});

export interface AiProfileStore {
  createProfile(profile: AiProfile): Promise<void>;
  ensureInitialProfile(guildId: string): Promise<void>;
  getActiveProfile(guildId: string): Promise<AiProfile>;
  listProfiles(guildId: string): Promise<AiProfile[]>;
  setActiveProfile(guildId: string, profileId: string): Promise<void>;
  updateProfile(profile: AiProfile): Promise<void>;
}

export class PostgresAiProfileStore implements AiProfileStore {
  readonly #database: PostgresExecutor;

  public constructor(database: PostgresExecutor) {
    this.#database = database;
  }

  public async createProfile(input: AiProfile): Promise<void> {
    const profile = aiProfileSchema.parse(input);
    await this.#database.query(
      `INSERT INTO ai_profiles (
         profile_id, guild_id, name, transcription, refinement, summary
       ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)`,
      serializeProfile(profile),
    );
  }

  public async ensureInitialProfile(guildId: string): Promise<void> {
    const validatedGuildId = identifierSchema.parse(guildId);
    const profile = createInitialAiProfile(validatedGuildId);
    await this.#database.query(
      `INSERT INTO guild_configurations (guild_id)
       VALUES ($1)
       ON CONFLICT (guild_id) DO NOTHING`,
      [validatedGuildId],
    );
    await this.#database.query(
      `INSERT INTO ai_profiles (
         profile_id, guild_id, name, transcription, refinement, summary
       ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)
       ON CONFLICT (profile_id) DO NOTHING`,
      [
        profile.profileId,
        profile.guildId,
        profile.name,
        JSON.stringify(profile.transcription),
        JSON.stringify(profile.refinement),
        JSON.stringify(profile.summary),
      ],
    );
    await this.#database.query(
      `UPDATE guild_configurations
       SET active_ai_profile_id = COALESCE(active_ai_profile_id, $2), updated_at = now()
       WHERE guild_id = $1`,
      [validatedGuildId, profile.profileId],
    );
  }

  public async getActiveProfile(guildId: string): Promise<AiProfile> {
    const result = await this.#database.query(
      `SELECT p.profile_id, p.guild_id, p.name, p.transcription, p.refinement, p.summary
       FROM guild_configurations AS g
       JOIN ai_profiles AS p ON p.profile_id = g.active_ai_profile_id
       WHERE g.guild_id = $1`,
      [identifierSchema.parse(guildId)],
    );
    return parseProfileRow(result.rows[0]);
  }

  public async listProfiles(guildId: string): Promise<AiProfile[]> {
    const result = await this.#database.query(
      `SELECT profile_id, guild_id, name, transcription, refinement, summary
       FROM ai_profiles
       WHERE guild_id = $1
       ORDER BY created_at, profile_id`,
      [identifierSchema.parse(guildId)],
    );
    return result.rows.map((row) => parseProfileRow(row));
  }

  public async setActiveProfile(guildId: string, profileId: string): Promise<void> {
    const validatedGuildId = identifierSchema.parse(guildId);
    const validatedProfileId = identifierSchema.parse(profileId);
    const result = await this.#database.query(
      `UPDATE guild_configurations
       SET active_ai_profile_id = $2, updated_at = now()
       WHERE guild_id = $1
         AND EXISTS (
           SELECT 1 FROM ai_profiles
           WHERE guild_id = $1 AND profile_id = $2
         )`,
      [validatedGuildId, validatedProfileId],
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
           updated_at = now()
       WHERE profile_id = $1 AND guild_id = $2`,
      serializeProfile(profile),
    );
    ensureProfileWasChanged(result.rowCount);
  }
}

function ensureProfileWasChanged(rowCount: number | null): void {
  if (rowCount !== 1) {
    throw new Error("AI profile was not found in this guild");
  }
}

function parseProfileRow(input: unknown): AiProfile {
  const row = rowSchema.parse(input);
  return aiProfileSchema.parse({
    guildId: row.guild_id,
    name: row.name,
    profileId: row.profile_id,
    refinement: row.refinement,
    summary: row.summary,
    transcription: row.transcription,
  });
}

function serializeProfile(profile: AiProfile): readonly unknown[] {
  return [
    profile.profileId,
    profile.guildId,
    profile.name,
    JSON.stringify(profile.transcription),
    JSON.stringify(profile.refinement),
    JSON.stringify(profile.summary),
  ];
}
