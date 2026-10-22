import { PostgresAiProfileStore } from "summyz-community-shared/database/postgres-ai-profile-store";
import { PostgresAnalyticsStore } from "summyz-community-shared/database/postgres-analytics-store";
import type { PostgresExecutor } from "summyz-community-shared/database/postgres-database";
import { PostgresGuildConfigStore } from "summyz-community-shared/database/postgres-guild-config-store";
import { PostgresModelDownloadStore } from "summyz-community-shared/database/postgres-model-download-store";
import { describe, expect, it, vi } from "vitest";
import { DiscordRestGuildDirectory } from "../src/discord/discord-rest-guild-directory.js";

describe("bounded database queries", () => {
  it("does not query empty server scopes and rejects invalid stored overview fields", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          guild_id: "guild-1",
          summary_forum: null,
          profile_id: "profile-1",
          profile_name: "Profile",
          profile_type: "external",
        },
      ],
    });
    const store = new PostgresGuildConfigStore({ query });
    expect((await store.getGuildSummaries([])).size).toBe(0);
    expect(query).not.toHaveBeenCalled();
    expect(
      (await store.getGuildSummaries(["guild-1"])).get("guild-1")?.activeProfile?.profileId,
    ).toBe("profile-1");
    query.mockResolvedValue({ rowCount: 1, rows: [{ guild_id: 1 }] });
    await expect(store.getGuildSummaries(["guild-1"])).rejects.toThrow();
  });

  it("does not load a credential for empty directories and propagates missing credentials", async () => {
    const getBotToken = vi.fn(async () => undefined);
    const directory = new DiscordRestGuildDirectory({ getBotToken, fetch: vi.fn<typeof fetch>() });
    expect((await directory.getForumsForGuilds([])).size).toBe(0);
    for (const method of [
      "getMembersByIds",
      "getMemberProfiles",
      "getMemberDisplayNames",
    ] as const) {
      expect((await directory[method]("guild-1", [])).size).toBe(0);
    }
    expect(getBotToken).not.toHaveBeenCalled();
    await expect(directory.getMemberProfiles("guild-1", ["user-1"])).rejects.toThrow(
      "not configured",
    );
  });
  it("loads forum directories for multiple servers with a single credential read", async () => {
    const getBotToken = vi.fn(async () => "fixture-credential");
    const directory = new DiscordRestGuildDirectory({
      getBotToken,
      fetch: async () => Response.json([]),
    });
    expect((await directory.getForumsForGuilds(["guild-1", "guild-2"])).size).toBe(2);
    expect(getBotToken).toHaveBeenCalledOnce();
  });

  it("filters and limits scheduler candidates inside PostgreSQL", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({ rowCount: 0, rows: [] });
    await new PostgresModelDownloadStore({ query }).list({ activeOnly: true, limit: 1 });
    expect(query.mock.calls[0]?.[0]).toContain("WHERE status IN");
    expect(query.mock.calls[0]?.[1]).toEqual([1]);
  });

  it("aggregates cost detail in three queries regardless of the number of models", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({ rowCount: 0, rows: [] });
    await new PostgresAnalyticsStore({ query }).getCostDetail("guild-1", {
      dateFrom: "2026-10-01",
      dateTo: "2026-10-20",
      timeZone: "America/Sao_Paulo",
    });
    expect(query).toHaveBeenCalledTimes(3);
  });

  it.each([1, 20, 100])("loads participants for %i meetings in one batch", async (count) => {
    const rows = Array.from({ length: count }, (_, index) => ({
      meeting_id: `meeting-${index}`,
      completed_at: null,
      content_retained: false,
      duration_ms: null,
      failure_code: null,
      pipeline_status: "recording",
      started_at: "2026-10-20T12:00:00Z",
      talk_time_available: false,
      voice_channel_name: null,
      total: count,
    }));
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({ rowCount: 0, rows: [] });
    query.mockResolvedValueOnce({ rowCount: count, rows });
    query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          meeting_id: "meeting-0",
          user_id: "user-1",
          display_name: "Fresh name",
          avatar_url: null,
          talk_time_ms: null,
          talk_percentage: null,
        },
      ],
    });
    const page = await new PostgresAnalyticsStore({ query }).listMeetings("guild-1", {
      page: 1,
      pageSize: count,
      timeZone: "America/Sao_Paulo",
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]?.[1]).toEqual(["guild-1", rows.map((row) => row.meeting_id)]);
    expect(page.items[0]?.participants?.[0]?.displayName).toBe("Fresh name");
    if (count > 1) expect(page.items[1]?.participants).toBeNull();
  });

  it("loads server overview fields in a single scoped query", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          guild_id: "guild-1",
          summary_forum: { forumId: "forum-1" },
          profile_id: null,
          profile_name: null,
          profile_type: null,
        },
      ],
    });
    const result = await new PostgresGuildConfigStore({ query }).getGuildSummaries([
      "guild-1",
      "guild-2",
    ]);
    expect(result.get("guild-1")).toEqual({
      activeProfile: null,
      summaryForum: { forumId: "forum-1" },
    });
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[1]).toEqual([["guild-1", "guild-2"]]);
  });

  it("counts active profiles only for the supplied servers and skips an empty scope", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({ rowCount: 0, rows: [] });
    const store = new PostgresAiProfileStore({ query });
    await store.listActiveProfileCounts(["guild-1", "guild-2"]);
    expect(query.mock.calls[0]?.[0]).toContain("guild_id = ANY($1::text[])");
    expect(query.mock.calls[0]?.[1]).toEqual([["guild-1", "guild-2"]]);
    await store.listActiveProfileCounts([]);
    expect(query).toHaveBeenCalledOnce();
  });

  it.each(["getMemberProfiles", "getMemberDisplayNames", "getMembersByIds"] as const)(
    "%s reads the credential once per operation and refreshes it next time",
    async (method) => {
      const getBotToken = vi.fn(async () => "fixture-credential");
      const request = vi.fn<typeof fetch>(async (url) =>
        Response.json({
          joined_at: "2026-10-20T12:00:00Z",
          user: { id: String(url).split("/").at(-1), username: "Synthetic" },
        }),
      );
      const directory = new DiscordRestGuildDirectory({ getBotToken, fetch: request });
      await directory[method]("guild-1", ["user-1", "user-2", "user-1"]);
      expect(getBotToken).toHaveBeenCalledOnce();
      expect(request).toHaveBeenCalledTimes(2);
      getBotToken.mockResolvedValue("rotated-fixture-credential");
      await directory[method]("guild-1", ["user-1"]);
      expect(getBotToken).toHaveBeenCalledTimes(2);
      expect(request.mock.calls.at(-1)?.[1]?.headers).toEqual({
        authorization: "Bot rotated-fixture-credential",
      });
    },
  );
});
