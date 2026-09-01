import { describe, expect, it, vi } from "vitest";

import { createInitialAiProfile } from "../src/ai-profile.js";
import { PostgresAiProfileStore } from "../src/database/postgres-ai-profile-store.js";
import type { PostgresExecutor } from "../src/database/postgres-database.js";

describe("PostgresAiProfileStore", () => {
  it("cria os dois perfis pessoais iniciais sem ativar nenhum servidor", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({ rowCount: 1, rows: [] });
    const store = new PostgresAiProfileStore({ query });

    await store.ensureInitialProfiles("user-1", "pt-BR");

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.every((call) => /INSERT INTO ai_profiles/i.test(call[0]))).toBe(true);
    expect(query.mock.calls.flatMap((call) => call[1] ?? [])).toContain("Perfil 1");
    expect(query.mock.calls.flatMap((call) => call[1] ?? [])).toContain("auto");
    expect(query.mock.calls.map((call) => call[0]).join("\n")).not.toMatch(/active_ai_profile_id/i);
  });

  it("lista somente os perfis pessoais do usuário", async () => {
    const profile = createInitialAiProfile("user-1", "external", "pt-BR");
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({
      rowCount: 1,
      rows: [toRow(profile)],
    });
    const store = new PostgresAiProfileStore({ query });

    await expect(store.listProfiles("user-1")).resolves.toEqual([profile]);

    expect(query.mock.calls[0]?.[0]).toMatch(/owner_user_id = \$1/i);
    expect(query.mock.calls[0]?.[1]).toEqual(["user-1"]);
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

    expect(query.mock.calls[0]?.[0]).toMatch(/owner_user_id/i);
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

  it("impede excluir o último perfil do tipo ou um perfil ativo", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({
      rowCount: 1,
      rows: [{ deleted: false }],
    });
    const store = new PostgresAiProfileStore({ query });

    await expect(store.deleteProfile("user-1", "profile-external")).rejects.toThrow(
      "AI profile cannot be deleted",
    );

    expect(query.mock.calls[0]?.[0]).toMatch(/active_ai_profile_id/i);
    expect(query.mock.calls[0]?.[0]).toMatch(/profile_type/i);
  });

  it("exclui um perfil inativo quando existe outro do mesmo tipo", async () => {
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
    expect(query.mock.calls[0]?.[0]).toMatch(/owner_user_id/i);
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
    owner_user_id: profile.userId,
    profile_id: profile.profileId,
    profile_type: profile.profileType,
    refinement: profile.refinement,
    summary: profile.summary,
    transcription: profile.transcription,
    language: profile.language,
    translation: profile.translation,
  };
}
