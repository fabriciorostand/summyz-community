import { z } from "zod";

import type { GuildDirectory } from "../api/server.js";

const guildsSchema = z.array(z.object({ id: z.string().min(1) }));
const rolesSchema = z.array(z.object({ id: z.string().min(1), name: z.string().min(1) }));
const channelsSchema = z.array(
  z.object({
    available_tags: z
      .array(z.object({ id: z.string().min(1), name: z.string().min(1) }))
      .optional(),
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.number().int(),
  }),
);
const memberSchema = z.object({
  avatar: z.string().min(1).nullable().optional(),
  nick: z.string().min(1).nullable().optional(),
  user: z.object({
    avatar: z.string().min(1).nullable().optional(),
    discriminator: z
      .string()
      .regex(/^\d{4}$/u)
      .optional(),
    global_name: z.string().min(1).nullable().optional(),
    id: z.string().min(1),
    username: z.string().min(1),
  }),
});
const guildMemberListSchema = z.array(
  z.object({
    roles: z.array(z.string()),
    user: z.object({ bot: z.boolean().optional(), id: z.string().min(1) }),
  }),
);

interface DirectoryOptions {
  fetch: typeof globalThis.fetch;
  getBotToken(): Promise<string | undefined>;
}

export class DiscordRestGuildDirectory implements GuildDirectory {
  readonly #fetch: typeof globalThis.fetch;
  readonly #getBotToken: () => Promise<string | undefined>;

  public constructor(options: DirectoryOptions) {
    this.#fetch = options.fetch;
    this.#getBotToken = options.getBotToken;
  }

  public async getInstalledGuildIds(): Promise<ReadonlySet<string>> {
    const payload = await this.#request("/users/@me/guilds");
    return new Set(guildsSchema.parse(payload).map((guild) => guild.id));
  }

  public async getResources(guildId: string) {
    const validatedGuildId = z.string().min(1).max(128).parse(guildId);
    const [rolesPayload, forums, memberResult] = await Promise.all([
      this.#request(`/guilds/${validatedGuildId}/roles`),
      this.getForums(validatedGuildId),
      this.#listVisibleHumanMembers(validatedGuildId),
    ]);
    const counts = new Map<string, number>();
    if (memberResult.status === "available") {
      for (const member of memberResult.members) {
        for (const roleId of member.roles) counts.set(roleId, (counts.get(roleId) ?? 0) + 1);
      }
    }
    return {
      forums,
      memberCounts:
        memberResult.status === "available"
          ? { status: "available" as const }
          : {
              code: "discord_members_intent_unavailable" as const,
              status: "unavailable" as const,
            },
      roles: rolesSchema
        .parse(rolesPayload)
        .filter((role) => role.id !== validatedGuildId && role.name !== "@everyone")
        .map((role) => ({
          ...role,
          memberCount: memberResult.status === "available" ? (counts.get(role.id) ?? 0) : null,
        })),
    };
  }

  public async getForums(guildId: string) {
    const validatedGuildId = z.string().min(1).max(128).parse(guildId);
    const channelsPayload = await this.#request(`/guilds/${validatedGuildId}/channels`);
    return channelsSchema
      .parse(channelsPayload)
      .filter((channel) => channel.type === 15)
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        tags: channel.available_tags ?? [],
      }));
  }

  async #listVisibleHumanMembers(
    guildId: string,
  ): Promise<{ members: { roles: string[] }[]; status: "available" } | { status: "unavailable" }> {
    const members: { roles: string[] }[] = [];
    let after: string | undefined;
    do {
      const parameters = new URLSearchParams({ limit: "1000" });
      if (after !== undefined) parameters.set("after", after);
      const token = await this.#getBotToken();
      if (token === undefined) throw new Error("Discord bot is not configured");
      const response = await this.#fetch(
        `https://discord.com/api/v10/guilds/${guildId}/members?${parameters}`,
        { headers: { authorization: `Bot ${token}` } },
      );
      if (response.status === 403) return { status: "unavailable" };
      if (!response.ok) throw new Error("Discord bot API request failed");
      const page = guildMemberListSchema.parse(await response.json());
      members.push(
        ...page
          .filter((member) => member.user.bot !== true)
          .map((member) => ({ roles: member.roles })),
      );
      after = page.length === 1_000 ? page.at(-1)?.user.id : undefined;
    } while (after !== undefined);
    return { members, status: "available" };
  }

  public async getMemberDisplayNames(
    guildId: string,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    const validatedGuildId = z.string().min(1).max(128).parse(guildId);
    const names = new Map<string, string>();
    await Promise.all(
      [...new Set(userIds)].map(async (userId) => {
        const validatedUserId = z.string().min(1).max(128).parse(userId);
        const payload = await this.#tryRequest(
          `/guilds/${validatedGuildId}/members/${validatedUserId}`,
        );
        if (payload === undefined) return;
        const member = memberSchema.parse(payload);
        names.set(validatedUserId, member.nick ?? member.user.global_name ?? member.user.username);
      }),
    );
    return names;
  }

  public async getMemberProfiles(
    guildId: string,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, { avatarUrl: string | null; displayName: string }>> {
    const validatedGuildId = z.string().min(1).max(128).parse(guildId);
    const profiles = new Map<string, { avatarUrl: string | null; displayName: string }>();
    await Promise.all(
      [...new Set(userIds)].map(async (userId) => {
        const validatedUserId = z.string().min(1).max(128).parse(userId);
        const payload = await this.#tryRequest(
          `/guilds/${validatedGuildId}/members/${validatedUserId}`,
        );
        if (payload === undefined) return;
        const member = memberSchema.parse(payload);
        const avatarUrl =
          member.avatar !== undefined && member.avatar !== null
            ? `https://cdn.discordapp.com/guilds/${validatedGuildId}/users/${validatedUserId}/avatars/${member.avatar}.png?size=128`
            : member.user.avatar !== undefined && member.user.avatar !== null
              ? `https://cdn.discordapp.com/avatars/${validatedUserId}/${member.user.avatar}.png?size=128`
              : createDefaultAvatarUrl(validatedUserId, member.user.discriminator);
        profiles.set(validatedUserId, {
          avatarUrl,
          displayName: member.nick ?? member.user.global_name ?? member.user.username,
        });
      }),
    );
    return profiles;
  }

  async #request(path: string): Promise<unknown> {
    const token = await this.#getBotToken();
    if (token === undefined) throw new Error("Discord bot is not configured");
    const response = await this.#fetch(`https://discord.com/api/v10${path}`, {
      headers: { authorization: `Bot ${token}` },
    });
    if (!response.ok) throw new Error("Discord bot API request failed");
    const payload: unknown = await response.json();
    return payload;
  }

  async #tryRequest(path: string): Promise<unknown | undefined> {
    const token = await this.#getBotToken();
    if (token === undefined) throw new Error("Discord bot is not configured");
    const response = await this.#fetch(`https://discord.com/api/v10${path}`, {
      headers: { authorization: `Bot ${token}` },
    });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error("Discord bot API request failed");
    return response.json();
  }
}

function createDefaultAvatarUrl(userId: string, discriminator: string | undefined): string | null {
  if (discriminator !== undefined && discriminator !== "0000") {
    return `https://cdn.discordapp.com/embed/avatars/${Number(discriminator) % 5}.png`;
  }
  if (!/^\d+$/u.test(userId)) return null;
  const avatarIndex = Number((BigInt(userId) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${avatarIndex}.png`;
}
