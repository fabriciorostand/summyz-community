import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createInitialAiProfile, resolveAiProfile } from "../src/ai-profile.js";
import { createDefaultAiPrompts } from "../src/ai-prompts.js";
import { databaseMigrations } from "../src/database/migrations.js";
import { PostgresAiProfileStore } from "../src/database/postgres-ai-profile-store.js";
import { PostgresAnalyticsStore } from "../src/database/postgres-analytics-store.js";
import {
  createPostgresDatabase,
  type PostgresDatabase,
} from "../src/database/postgres-database.js";

const connectionString = process.env.POSTGRES_TEST_URL;

describe.skipIf(connectionString === undefined)("presentation contracts in PostgreSQL", () => {
  it("rejects null prompt modes at the database boundary", async () => {
    await withDatabase(async (database) => {
      await database.initialize();
      const store = new PostgresAiProfileStore(database);
      const profile = createInitialAiProfile("external", "en");
      await store.createProfile(profile);
      await expect(
        database.query(
          "UPDATE ai_profiles SET prompt_modes = jsonb_set(prompt_modes, '{refinement}', 'null'::jsonb) WHERE profile_id = $1",
          [profile.profileId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  it("classifies existing defaults without rewriting profile content and preserves custom text on later saves", async () => {
    await withDatabase(async (database) => {
      for (const migration of databaseMigrations.filter(({ version }) => version <= 15)) {
        await database.query(migration.sql);
      }
      const base = createInitialAiProfile("external", "en");
      const custom = "  Revise em português.\nPreserve exatamente este texto.  ";
      await database.query(
        `INSERT INTO ai_profiles (profile_id, name, profile_type, language, transcription, refinement, summary)
        VALUES ('default-profile', 'Profile 1', 'external', 'auto', $1::jsonb, $2::jsonb, $3::jsonb),
               ('custom-profile', 'Custom', 'external', 'auto', $1::jsonb, $4::jsonb, $5::jsonb)`,
        [
          JSON.stringify(base.transcription),
          JSON.stringify(base.refinement),
          JSON.stringify(base.summary),
          JSON.stringify({ ...base.refinement, prompt: custom }),
          JSON.stringify({ ...base.summary, extractionPrompt: null, consolidationPrompt: custom }),
        ],
      );
      const snapshot =
        "SELECT profile_id, transcription, refinement, summary FROM ai_profiles ORDER BY profile_id";
      const before = await database.query(snapshot);
      const migration = databaseMigrations.find(({ version }) => version === 16);
      if (migration === undefined) throw new Error("Prompt ownership migration is missing");
      await database.query(migration.sql);
      expect((await database.query(snapshot)).rows).toEqual(before.rows);
      const store = new PostgresAiProfileStore(database);
      const profiles = await store.listProfiles();
      const standard = profiles.find(({ profileId }) => profileId === "default-profile");
      const customized = profiles.find(({ profileId }) => profileId === "custom-profile");
      if (standard === undefined || customized === undefined)
        throw new Error("Upgrade lost profiles");
      expect(standard.promptModes).toEqual(base.promptModes);
      expect(customized.promptModes).toMatchObject({
        refinement: "custom",
        summaryExtraction: "custom",
        summaryConsolidation: "custom",
      });
      expect(customized.refinement.prompt).toBe(custom);
      expect(customized.summary.extractionPrompt).toBeNull();
      const edited = {
        ...standard,
        language: "en" as const,
        promptModes: { ...standard.promptModes, summaryExtraction: "custom" as const },
        transcription: { ...standard.transcription, model: "audio" },
        refinement: { ...standard.refinement, model: "review" },
        summary: { ...standard.summary, model: "summary" },
      };
      await store.updateProfile(edited);
      const saved = (await store.listProfiles()).find(
        ({ profileId }) => profileId === edited.profileId,
      );
      if (saved === undefined) throw new Error("Updated profile is missing");
      expect(saved.summary.extractionPrompt).toBe(createDefaultAiPrompts("auto").summaryExtraction);
      expect(saved.summary.consolidationPrompt).toBe(
        createDefaultAiPrompts("en").summaryConsolidation,
      );
      expect(resolveAiProfile(saved).summary.extractionPrompt).toBe(
        edited.summary.extractionPrompt,
      );
    });
  });

  it("filters local dates across UTC midnight and daylight saving boundaries", async () => {
    await withDatabase(async (database) => {
      await database.initialize();
      const instants = [
        "2026-09-29T02:30:00.000Z",
        "2026-09-29T03:00:00.000Z",
        "2026-03-28T23:00:00.000Z",
        "2026-03-29T21:59:59.000Z",
        "2026-03-29T22:00:00.000Z",
      ];
      for (const [index, instant] of instants.entries()) {
        await database.query(
          `INSERT INTO meetings (meeting_id, guild_id, voice_channel_id, notification_channel_id, recording_status, pipeline_status, started_at, persist_content, persist_audio, storage_mode)
          VALUES ($1, 'calendar-contract', 'voice', 'text', 'completed', 'completed', $2, false, false, 'postgres')`,
          [`meeting-${index}`, instant],
        );
      }
      const analytics = new PostgresAnalyticsStore(database);
      const list = (date: string, timeZone: string) =>
        analytics.listMeetings("calendar-contract", {
          dateFrom: date,
          dateTo: date,
          page: 1,
          pageSize: 20,
          timeZone,
        });
      expect(
        (await list("2026-09-28", "America/Sao_Paulo")).items.map(({ meetingId }) => meetingId),
      ).toEqual(["meeting-0"]);
      expect((await list("2026-09-28", "UTC")).items).toEqual([]);
      expect(
        (await list("2026-03-29", "Europe/Berlin")).items.map(({ meetingId }) => meetingId),
      ).toEqual(["meeting-3", "meeting-2"]);
    });
  });
});

async function withDatabase(action: (database: PostgresDatabase) => Promise<void>): Promise<void> {
  const url = new URL(connectionString ?? "postgresql://invalid");
  const admin = new Pool({ connectionString: url.toString() });
  const schema = `presentation_${randomUUID().replaceAll("-", "")}`;
  url.searchParams.set("options", `-c search_path=${schema}`);
  const database = createPostgresDatabase(url.toString());
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await action(database);
  } finally {
    await database.close();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
}
