import { describe, expect, it, vi } from "vitest";

import type { PostgresExecutor } from "../src/database/postgres-database.js";
import { PostgresParticipantDirectoryStore } from "../src/database/postgres-participant-directory-store.js";

describe("PostgresParticipantDirectoryStore", () => {
  it("lists latest historical and live participants with search and pagination", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          avatar_url: "https://cdn.discordapp.com/avatar.png",
          display_name: "Ana",
          total: 3,
          user_id: "user-1",
        },
      ],
    });
    const store = new PostgresParticipantDirectoryStore({ query });

    await expect(store.list("guild-1", { page: 2, pageSize: 1, query: "ana" })).resolves.toEqual({
      items: [
        {
          avatarUrl: "https://cdn.discordapp.com/avatar.png",
          displayName: "Ana",
          userId: "user-1",
        },
      ],
      page: 2,
      pageSize: 1,
      total: 3,
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("meeting_participants"), [
      "guild-1",
      "ana",
      1,
      1,
    ]);
    expect(query.mock.calls[0]?.[0]).toContain("live_meeting_states");
  });

  it("returns an empty page without inventing a total", async () => {
    const store = new PostgresParticipantDirectoryStore({
      query: vi.fn(async () => ({ rowCount: 0, rows: [] })),
    });

    await expect(store.list("guild-1", { page: 1, pageSize: 50 })).resolves.toEqual({
      items: [],
      page: 1,
      pageSize: 50,
      total: 0,
    });
  });
});
