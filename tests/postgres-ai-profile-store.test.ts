import { describe, expect, it, vi } from "vitest";

import { createInitialAiProfile } from "../src/ai-profile.js";
import { PostgresAiProfileStore } from "../src/database/postgres-ai-profile-store.js";
import type { PostgresExecutor } from "../src/database/postgres-database.js";

describe("PostgresAiProfileStore", () => {
  it("lista somente os perfis pessoais do usuário", async () => {
    const profile = createInitialAiProfile("user-1", "external", "pt-BR");
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({
      rowCount: 1,
      rows: [toRow(profile)],
    });
    const store = new PostgresAiProfileStore({ query });

    await expect(store.listProfiles("user-1")).resolves.toEqual([profile]);

    expect(query.mock.calls[0]?.[0]).toMatch(/owner_discord_user_id = \$1/i);
    expect(query.mock.calls[0]?.[1]).toEqual(["user-1"]);
  });

  it("counts how many servers use each profile", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({
      rowCount: 1,
      rows: [{ profile_id: "profile-1", server_count: 2 }],
    });
    const store = new PostgresAiProfileStore({ query });

    await expect(store.listActiveProfileCounts("user-1")).resolves.toEqual(
      new Map([["profile-1", 2]]),
    );
    expect(query.mock.calls[0]?.[0]).toContain("count(*)");
  });

  it("ativa globalmente um perfil pessoal no servidor autorizado", async () => {
    const query = vi
      .fn<PostgresExecutor["query"]>()
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const store = new PostgresAiProfileStore({ query });

    await expect(
      store.setActiveProfile("guild-1", "user-1", "profile-external"),
    ).resolves.toBeUndefined();
    await expect(store.setActiveProfile("guild-1", "user-1", "foreign-profile")).rejects.toThrow(
      "AI profile is unavailable to this user",
    );

    expect(query.mock.calls[0]?.[0]).toMatch(/owner_discord_user_id/i);
    expect(query.mock.calls[0]?.[1]).toEqual(["guild-1", "profile-external", "user-1"]);
  });

  it("permite remover a seleção ativa sem escolher um tipo pelo usuário", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({ rowCount: 1, rows: [] });
    const store = new PostgresAiProfileStore({ query });

    await store.clearActiveProfile("guild-1");

    expect(query.mock.calls[0]?.[0]).toMatch(/active_ai_profile_id = NULL/i);
  });

  it("só resolve o perfil ativo quando ele pertence ao proprietário atual no Discord", async () => {
    const profile = createInitialAiProfile("user-1", "external", "pt-BR");
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({
      rowCount: 1,
      rows: [toRow(profile)],
    });
    const store = new PostgresAiProfileStore({ query });

    await expect(
      store.getActiveProfileForDiscordOwner("guild-1", "discord-owner-1"),
    ).resolves.toEqual(profile);

    expect(query.mock.calls[0]?.[0]).toMatch(/discord_connections/i);
    expect(query.mock.calls[0]?.[0]).toMatch(/discord_user_id = \$2/i);
    expect(query.mock.calls[0]?.[1]).toEqual(["guild-1", "discord-owner-1"]);
  });

  it("retorna ausência quando o servidor não possui um perfil ativo pessoal", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({ rowCount: 0, rows: [] });
    const store = new PostgresAiProfileStore({ query });

    await expect(store.getActiveProfile("guild-1")).resolves.toBeUndefined();
    await expect(
      store.getActiveProfileForDiscordOwner("guild-1", "discord-owner-1"),
    ).resolves.toBeUndefined();

    expect(query.mock.calls[0]?.[0]).not.toMatch(/IS NOT NULL/i);
  });

  it("prevents deleting an active profile", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({
      rowCount: 1,
      rows: [{ deleted: false }],
    });
    const store = new PostgresAiProfileStore({ query });

    await expect(store.deleteProfile("user-1", "profile-external")).rejects.toThrow(
      "AI profile cannot be deleted",
    );

    expect(query.mock.calls[0]?.[0]).toMatch(/active_ai_profile_id/i);
    expect(query.mock.calls[0]?.[0]).not.toMatch(/same_type_count/i);
  });

  it("deletes the final profile when it is inactive", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({
      rowCount: 1,
      rows: [{ deleted: true }],
    });
    const store = new PostgresAiProfileStore({ query });

    await expect(store.deleteProfile("user-1", "profile-external-2")).resolves.toBeUndefined();
  });

  it("atualiza somente um perfil pertencente ao usuário", async () => {
    const profile = createInitialAiProfile("user-1", "local", "en");
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({ rowCount: 0, rows: [] });
    const store = new PostgresAiProfileStore({ query });

    await expect(store.updateProfile("user-1", profile)).rejects.toThrow(
      "AI profile is unavailable to this user",
    );
    expect(query.mock.calls[0]?.[0]).toMatch(/owner_discord_user_id/i);
  });

  it("rejeita atualizar um perfil que declara outro proprietário antes de consultar o banco", async () => {
    const profile = createInitialAiProfile("user-1", "local", "en");
    const query = vi.fn<PostgresExecutor["query"]>();
    const store = new PostgresAiProfileStore({ query });

    await expect(store.updateProfile("user-2", profile)).rejects.toThrow(
      "AI profile is unavailable to this user",
    );
    expect(query).not.toHaveBeenCalled();
  });
});

function toRow(profile: ReturnType<typeof createInitialAiProfile>) {
  return {
    name: profile.name,
    owner_discord_user_id: profile.userId,
    profile_id: profile.profileId,
    profile_type: profile.profileType,
    refinement: profile.refinement,
    summary: profile.summary,
    transcription: profile.transcription,
    language: profile.language,
    translation: profile.translation,
  };
}
