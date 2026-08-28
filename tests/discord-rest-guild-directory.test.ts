import { describe, expect, it, vi } from "vitest";

import { DiscordRestGuildDirectory } from "../src/discord/discord-rest-guild-directory.js";

describe("DiscordRestGuildDirectory", () => {
  it("lista instalações e expõe somente cargos e fóruns configuráveis", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: "guild-1" }, { id: "guild-2" }]), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: "everyone", name: "@everyone" },
            { id: "role-1", name: "Equipe" },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              available_tags: [{ id: "tag-1", name: "Reunião" }],
              id: "forum-1",
              name: "Resumos",
              type: 15,
            },
            { id: "text-1", name: "geral", type: 0 },
          ]),
          { status: 200 },
        ),
      );
    const directory = new DiscordRestGuildDirectory({
      fetch: fetchMock,
      getBotToken: async () => "bot-token",
    });

    await expect(directory.getInstalledGuildIds()).resolves.toEqual(
      new Set(["guild-1", "guild-2"]),
    );
    await expect(directory.getResources("guild-1")).resolves.toEqual({
      forums: [{ id: "forum-1", name: "Resumos", tags: [{ id: "tag-1", name: "Reunião" }] }],
      roles: [{ id: "role-1", name: "Equipe" }],
    });
    expect(fetchMock.mock.calls.flatMap((call) => JSON.stringify(call[1]))).not.toContain(
      "undefined",
    );
  });
});
