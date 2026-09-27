import { describe, expect, it, vi } from "vitest";

import { createInitialAiProfile } from "../src/ai-profile.js";
import { PostgresAiProfileStore } from "../src/database/postgres-ai-profile-store.js";
import type { PostgresExecutor } from "../src/database/postgres-database.js";

describe("PostgresAiProfileStore", () => {
  it("rejects a duplicate trimmed name across provider types", async () => {
    const query = vi
      .fn<PostgresExecutor["query"]>()
      .mockResolvedValue({ rowCount: 1, rows: [{ profile_id: "other" }] });
    const transaction = async <T>(action: (executor: PostgresExecutor) => Promise<T>) =>
      action({ query });
    const store = new PostgresAiProfileStore({ query, transaction });
    await expect(store.createProfile(createInitialAiProfile("local", "en"))).rejects.toMatchObject({
      name: "DuplicateProfileNameError",
    });
    expect(query.mock.calls.some(([sql]) => sql.includes("lower(name)"))).toBe(false);
  });
  it("lists installation-wide profiles without an owner filter", async () => {
    const profile = createInitialAiProfile("external", "pt-BR");
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({
      rowCount: 1,
      rows: [toRow(profile)],
    });
    const store = new PostgresAiProfileStore({ query });

    await expect(store.listProfiles()).resolves.toEqual([profile]);
    expect(query.mock.calls[0]?.[0]).not.toMatch(/owner_discord_user_id/i);
    expect(query.mock.calls[0]?.[1]).toBeUndefined();
  });

  it("counts how many servers use each profile", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({
      rowCount: 1,
      rows: [{ profile_id: "profile-1", server_count: 2 }],
    });
    const store = new PostgresAiProfileStore({ query });

    await expect(store.listActiveProfileCounts()).resolves.toEqual(new Map([["profile-1", 2]]));
  });

  it("activates any existing global profile for a server", async () => {
    const query = vi
      .fn<PostgresExecutor["query"]>()
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const store = new PostgresAiProfileStore({ query });

    await expect(store.setActiveProfile("guild-1", "profile-external")).resolves.toBeUndefined();
    await expect(store.setActiveProfile("guild-1", "missing-profile")).rejects.toThrow(
      "AI profile is unavailable",
    );
    expect(query.mock.calls[0]?.[1]).toEqual(["guild-1", "profile-external"]);
  });

  it("prevents deleting an active profile", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({
      rowCount: 1,
      rows: [{ deleted: false }],
    });
    const store = new PostgresAiProfileStore({ query });

    await expect(store.deleteProfile("profile-external")).rejects.toThrow(
      "AI profile cannot be deleted",
    );
  });

  it("updates a profile without an account ownership predicate", async () => {
    const profile = createInitialAiProfile("local", "en");
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({ rowCount: 1, rows: [] });
    const store = new PostgresAiProfileStore({
      query,
      transaction: async (action) => action({ query }),
    });

    await store.updateProfile(profile);
    expect(query.mock.calls[0]?.[0]).not.toMatch(/owner_discord_user_id/i);
  });
});

function toRow(profile: ReturnType<typeof createInitialAiProfile>) {
  return {
    language: profile.language,
    name: profile.name,
    profile_id: profile.profileId,
    profile_type: profile.profileType,
    refinement: profile.refinement,
    summary: profile.summary,
    transcription: profile.transcription,
  };
}
