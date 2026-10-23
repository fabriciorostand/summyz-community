import { describe, expect, it, vi } from "vitest";

import { DiscordRestGuildDirectory } from "../src/discord/discord-rest-guild-directory.js";

describe("DiscordRestGuildDirectory", () => {
  it("lista instalações e expõe somente cargos e fóruns configuráveis", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: "guild-1", name: "Equipe" },
            { id: "guild-2", name: "Comunidade" },
          ]),
          { status: 200 },
        ),
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
            {
              joined_at: "2026-09-08T12:00:00.000Z",
              roles: ["role-1"],
              user: { bot: false, discriminator: "0", id: "user-1", username: "Ana" },
            },
            {
              joined_at: "2026-09-08T12:00:00.000Z",
              roles: ["role-1"],
              user: { bot: true, discriminator: "1234", id: "bot-1", username: "Bot" },
            },
          ]),
          { status: 200 },
        ),
      );
    const directory = new DiscordRestGuildDirectory({
      fetch: fetchMock,
      getBotToken: async () => "bot-token",
    });

    await expect(directory.listInstalledGuilds()).resolves.toEqual([
      { iconUrl: null, id: "guild-1", name: "Equipe" },
      { iconUrl: null, id: "guild-2", name: "Comunidade" },
    ]);
    await expect(directory.getResources("guild-1")).resolves.toEqual({
      forums: [{ id: "forum-1", name: "Resumos", tags: [{ id: "tag-1", name: "Reunião" }] }],
      memberCounts: { status: "available" },
      roles: [{ id: "role-1", memberCount: 1, name: "Equipe" }],
    });
    expect(fetchMock.mock.calls.flatMap((call) => JSON.stringify(call[1]))).not.toContain(
      "undefined",
    );
  });

  it("validates the bot token and derives the Discord application id", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ icon: "app-icon", id: "application-1", name: "Summyz" })),
      );
    const directory = new DiscordRestGuildDirectory({
      fetch: fetchMock,
      getBotToken: async () => undefined,
    });

    await expect(directory.inspectBotToken("bot-token")).resolves.toEqual({
      iconUrl: "https://cdn.discordapp.com/app-icons/application-1/app-icon.png?size=128",
      id: "application-1",
      name: "Summyz",
    });
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({
      headers: { authorization: "Bot bot-token" },
    });
  });

  it("lists only guilds where the bot is currently installed", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ icon: "guild-icon", id: "guild-1", name: "Equipe" }])),
      );
    const directory = new DiscordRestGuildDirectory({
      fetch: fetchMock,
      getBotToken: async () => "bot-token",
    });

    await expect(directory.listInstalledGuilds()).resolves.toEqual([
      {
        iconUrl: "https://cdn.discordapp.com/icons/guild-1/guild-icon.png?size=128",
        id: "guild-1",
        name: "Equipe",
      },
    ]);
  });

  it("shares an in-flight bot guild lookup but checks Discord again later", async () => {
    let resolveGuilds: ((response: Response) => void) | undefined;
    const firstResponse = new Promise<Response>((resolve) => {
      resolveGuilds = resolve;
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce(Response.json([{ id: "guild-1", name: "Team" }]));
    const directory = new DiscordRestGuildDirectory({
      fetch: fetchMock,
      getBotToken: async () => "bot-token",
    });

    const first = directory.listInstalledGuilds();
    const second = directory.listInstalledGuilds();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    resolveGuilds?.(Response.json([{ id: "guild-1", name: "Team" }]));
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    await directory.listInstalledGuilds();
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
            user: {
              avatar: null,
              discriminator: "1234",
              id: defaultAvatarUserId,
              username: "no-avatar",
            },
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

    expect(profiles.get(defaultAvatarUserId)?.avatarUrl).toBe(
      "https://cdn.discordapp.com/embed/avatars/0.png",
    );
    expect(profiles.get("200000000000000000")?.avatarUrl).toContain(
      "/avatars/200000000000000000/global.png",
    );
    expect(profiles.get("300000000000000000")?.avatarUrl).toContain(
      "/guilds/guild-1/users/300000000000000000/avatars/guild.png",
    );
  });

  it("lista membros humanos visíveis e resolve concessões somente para membros atuais", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/members?")) {
        return Response.json([
          {
            joined_at: "2026-09-08T12:00:00.000Z",
            nick: "Bruna",
            roles: ["role-2"],
            user: { bot: false, id: "user-2", username: "bruna" },
          },
          {
            joined_at: "2026-09-07T12:00:00.000000+00:00",
            roles: ["role-1"],
            user: { bot: false, id: "user-1", username: "Ana" },
          },
        ]);
      }
      if (url.endsWith("/members/user-1")) {
        return Response.json({
          joined_at: "2026-09-07T12:00:00.000000+00:00",
          roles: ["role-1"],
          user: { bot: false, id: "user-1", username: "Ana" },
        });
      }
      return new Response(null, { status: 404 });
    });
    const directory = new DiscordRestGuildDirectory({
      fetch: fetchMock,
      getBotToken: async () => "bot-token",
    });

    await expect(
      directory.listMembers("guild-1", { page: 1, pageSize: 50, query: "ana" }),
    ).resolves.toMatchObject({
      items: [
        {
          displayName: "Ana",
          joinedAt: "2026-09-07T12:00:00.000Z",
          roleIds: ["role-1"],
          userId: "user-1",
        },
      ],
      status: "available",
      total: 1,
    });
    const members = await directory.getMembersByIds("guild-1", ["user-1", "departed-user"]);
    expect([...members.keys()]).toEqual(["user-1"]);
  });
});
