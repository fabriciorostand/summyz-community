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
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { roles: ["role-1"], user: { bot: false, id: "user-1", username: "Ana" } },
            { roles: ["role-1"], user: { bot: true, id: "bot-1", username: "Bot" } },
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
      memberCounts: { status: "available" },
      roles: [{ id: "role-1", memberCount: 1, name: "Equipe" }],
    });
    expect(fetchMock.mock.calls.flatMap((call) => JSON.stringify(call[1]))).not.toContain(
      "undefined",
    );
  });

  it("keeps resources available when the privileged members intent is disabled", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: "role-1", name: "Equipe" }])))
      .mockResolvedValueOnce(new Response(JSON.stringify([])))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));
    const directory = new DiscordRestGuildDirectory({
      fetch: fetchMock,
      getBotToken: async () => "bot-token",
    });

    await expect(directory.getResources("guild-1")).resolves.toMatchObject({
      memberCounts: { code: "discord_members_intent_unavailable", status: "unavailable" },
      roles: [{ id: "role-1", memberCount: null }],
    });
  });

  it("lista fóruns sem carregar todos os membros do servidor", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { available_tags: [], id: "forum-1", name: "Resumos", type: 15 },
          { id: "text-1", name: "geral", type: 0 },
        ]),
      ),
    );
    const directory = new DiscordRestGuildDirectory({
      fetch: fetchMock,
      getBotToken: async () => "bot-token",
    });

    await expect(directory.getForums("guild-1")).resolves.toEqual([
      { id: "forum-1", name: "Resumos", tags: [] },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/guilds/guild-1/channels");
  });

  it("retorna avatar do servidor, global ou padrão para cada membro", async () => {
    const defaultAvatarUserId = "100000000000000000";
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith(`/members/${defaultAvatarUserId}`)) {
        return new Response(
          JSON.stringify({
            nick: "Sem avatar",
            user: { avatar: null, id: defaultAvatarUserId, username: "no-avatar" },
          }),
        );
      }
      if (url.endsWith("/members/200000000000000000")) {
        return new Response(
          JSON.stringify({
            nick: null,
            user: {
              avatar: "global",
              global_name: "Global",
              id: "200000000000000000",
              username: "global-user",
            },
          }),
        );
      }
      return new Response(
        JSON.stringify({
          avatar: "guild",
          nick: "Guild",
          user: { avatar: "global", id: "300000000000000000", username: "guild-user" },
        }),
      );
    });
    const directory = new DiscordRestGuildDirectory({
      fetch: fetchMock,
      getBotToken: async () => "bot-token",
    });

    const profiles = await directory.getMemberProfiles("guild-1", [
      defaultAvatarUserId,
      "200000000000000000",
      "300000000000000000",
    ]);

    expect(profiles.get(defaultAvatarUserId)?.avatarUrl).toMatch(
      /^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/[0-5]\.png$/u,
    );
    expect(profiles.get("200000000000000000")?.avatarUrl).toContain(
      "/avatars/200000000000000000/global.png",
    );
    expect(profiles.get("300000000000000000")?.avatarUrl).toContain(
      "/guilds/guild-1/users/300000000000000000/avatars/guild.png",
    );
  });
});
