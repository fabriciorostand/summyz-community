import { describe, expect, it, vi } from "vitest";

import { createInitialAiProfile } from "../src/ai-profile.js";
import { PostgresAiProfileStore } from "../src/database/postgres-ai-profile-store.js";
import type { PostgresExecutor } from "../src/database/postgres-database.js";

describe("PostgresAiProfileStore", () => {
  it("cria o Perfil 1 incompleto e o deixa ativo de forma idempotente", async () => {
    const query = vi
      .fn<PostgresExecutor["query"]>()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const store = new PostgresAiProfileStore({ query });

    await store.ensureInitialProfile("guild-1");

    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls.map((call) => call[0]).join("\n")).toMatch(/ai_profiles/i);
    expect(query.mock.calls.map((call) => call[0]).join("\n")).toMatch(/active_ai_profile_id/i);
    expect(query.mock.calls.flatMap((call) => call[1] ?? [])).not.toContain("auto-model");
  });

  it("carrega e valida o perfil ativo", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          guild_id: "guild-1",
          name: "Profile 1",
          profile_id: "guild-1-profile-1",
          refinement: { maxChunkCharacters: 500_000, model: null, provider: null },
          summary: {
            language: "auto",
            maxChunkCharacters: 500_000,
            model: null,
            provider: null,
          },
          transcription: {
            batchSize: "auto",
            interSpeechSilenceMs: 0,
            language: "auto",
            model: null,
            provider: null,
            timestampMode: "word",
          },
        },
      ],
    });
    const store = new PostgresAiProfileStore({ query });

    await expect(store.getActiveProfile("guild-1")).resolves.toMatchObject({
      guildId: "guild-1",
      profileId: "guild-1-profile-1",
      transcription: { model: null },
    });
  });

  it("cria, atualiza e lista múltiplos perfis do servidor", async () => {
    const profile = {
      ...createInitialAiProfile("guild-1", {
        refinement: { model: "qwen3:4b", provider: "ollama" },
        summary: { model: "qwen3:4b", provider: "ollama" },
        transcription: { model: "medium", provider: "faster-whisper" },
      }),
      name: "Qualidade",
      profileId: "profile-quality",
    };
    const row = {
      guild_id: profile.guildId,
      name: profile.name,
      profile_id: profile.profileId,
      refinement: profile.refinement,
      summary: profile.summary,
      transcription: profile.transcription,
    };
    const query = vi
      .fn<PostgresExecutor["query"]>()
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [row] });
    const store = new PostgresAiProfileStore({ query });

    await store.createProfile(profile);
    await store.updateProfile({ ...profile, name: "Qualidade revisada" });
    await expect(store.listProfiles("guild-1")).resolves.toEqual([profile]);

    expect(query.mock.calls[0]?.[0]).toMatch(/INSERT INTO ai_profiles/i);
    expect(query.mock.calls[1]?.[0]).toMatch(/UPDATE ai_profiles/i);
    expect(query.mock.calls[2]?.[0]).toMatch(/ORDER BY/i);
  });

  it("ativa somente um perfil que pertence ao mesmo servidor", async () => {
    const query = vi
      .fn<PostgresExecutor["query"]>()
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const store = new PostgresAiProfileStore({ query });

    await expect(store.setActiveProfile("guild-1", "profile-quality")).resolves.toBeUndefined();
    await expect(store.setActiveProfile("guild-1", "foreign-profile")).rejects.toThrow(
      "AI profile was not found in this guild",
    );
    expect(query.mock.calls[0]?.[0]).toMatch(/EXISTS/i);
  });

  it("recusa atualizar perfil inexistente", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({
      rowCount: 0,
      rows: [],
    });
    const store = new PostgresAiProfileStore({ query });
    const profile = createInitialAiProfile("guild-1");

    await expect(store.updateProfile(profile)).rejects.toThrow(
      "AI profile was not found in this guild",
    );
  });
});
