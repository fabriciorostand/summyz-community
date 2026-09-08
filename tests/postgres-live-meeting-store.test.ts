import { describe, expect, it, vi } from "vitest";

import type { PostgresExecutor } from "../src/database/postgres-database.js";
import { PostgresLiveMeetingStore } from "../src/database/postgres-live-meeting-store.js";

describe("PostgresLiveMeetingStore", () => {
  it("stores current human participants and the speaking subset with a short lease", async () => {
    const query = vi.fn<PostgresExecutor["query"]>(async () => ({ rowCount: 1, rows: [] }));
    const store = new PostgresLiveMeetingStore({ query }, () => new Date("2026-09-07T12:00:00Z"));

    await store.save({
      guildId: "guild-1",
      meetingId: "meeting-1",
      participants: [{ avatarUrl: null, displayName: "Ana", userId: "user-1" }],
      speakingUserIds: ["user-1"],
      voiceChannelId: "voice-1",
    });

    expect(query.mock.calls[0]?.[1]).toEqual([
      "meeting-1",
      "guild-1",
      "voice-1",
      JSON.stringify([{ avatarUrl: null, displayName: "Ana", userId: "user-1" }]),
      JSON.stringify(["user-1"]),
      "2026-09-07T12:00:45.000Z",
    ]);
  });

  it("returns only non-stale live state and can clear it at call end", async () => {
    const query = vi
      .fn<PostgresExecutor["query"]>()
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            ai_profile_id: "profile-1",
            ai_profile_name: "Default OpenRouter",
            guild_id: "guild-1",
            meeting_id: "meeting-1",
            participants: [{ avatarUrl: null, displayName: "Ana", userId: "user-1" }],
            speaking_user_ids: ["user-1"],
            started_at: "2026-09-07T11:45:00.000Z",
            updated_at: "2026-09-07T12:00:00.000Z",
            voice_channel_id: "voice-1",
            voice_channel_name: "launch-week",
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const store = new PostgresLiveMeetingStore({ query });

    await expect(store.getForGuild("guild-1")).resolves.toMatchObject({
      aiProfile: { name: "Default OpenRouter", profileId: "profile-1" },
      meetingId: "meeting-1",
      speakingUserIds: ["user-1"],
      startedAt: "2026-09-07T11:45:00.000Z",
      voiceChannelName: "launch-week",
    });
    await store.clear("meeting-1");

    expect(query.mock.calls[0]?.[0]).toContain("expires_at > now()");
    expect(query.mock.calls[0]?.[0]).toContain("JOIN meetings");
    expect(query.mock.calls[1]?.[0]).toContain("DELETE FROM live_meeting_states");
  });
});
