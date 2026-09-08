import { z } from "zod";

import type { GuildDirectory, GuildMemberDirectoryItem } from "../api/server-contracts.js";

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
  joined_at: z.iso.datetime({ offset: true }).optional(),
  nick: z.string().min(1).nullable().optional(),
  roles: z.array(z.string()).default([]),
  user: z.object({
    avatar: z.string().min(1).nullable().optional(),
    bot: z.boolean().optional(),
    discriminator: z
      .string()
      .regex(/^\d{4}$/u)
      .optional(),
    global_name: z.string().min(1).nullable().optional(),
    id: z.string().min(1),
    username: z.string().min(1),
  }),
});
const guildMemberListSchema = z.array(memberSchema);

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
        for (const roleId of member.roleIds) counts.set(roleId, (counts.get(roleId) ?? 0) + 1);
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
  ): Promise<
    { members: GuildMemberDirectoryItem[]; status: "available" } | { status: "unavailable" }
  > {
    const members: GuildMemberDirectoryItem[] = [];
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
      members.push(...page.flatMap((member) => toDirectoryItem(guildId, member)));
      after = page.length === 1_000 ? page.at(-1)?.user.id : undefined;
    } while (after !== undefined);
    return { members, status: "available" };
  }

  public async listMembers(
    guildId: string,
    options: { page: number; pageSize: number; query?: string; roleId?: string },
  ) {
    const validatedGuildId = z.string().min(1).max(128).parse(guildId);
    const validated = z
      .object({
        page: z.number().int().positive(),
        pageSize: z.number().int().min(1).max(100),
        query: z.string().trim().max(100).optional(),
        roleId: z.string().min(1).max(128).optional(),
      })
      .parse(options);
    const result = await this.#listVisibleHumanMembers(validatedGuildId);
    if (result.status === "unavailable") {
      return {
        code: "discord_members_intent_unavailable" as const,
        status: "unavailable" as const,
      };
    }
    const normalizedQuery = validated.query?.toLocaleLowerCase();
    const filtered = result.members
      .filter(
        (member) =>
          (normalizedQuery === undefined ||
            member.displayName.toLocaleLowerCase().includes(normalizedQuery)) &&
          (validated.roleId === undefined || member.roleIds.includes(validated.roleId)),
      )
      .sort((left, right) =>
        left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" }),
      );
    const offset = (validated.page - 1) * validated.pageSize;
    return {
      items: filtered.slice(offset, offset + validated.pageSize),
      page: validated.page,
      pageSize: validated.pageSize,
      status: "available" as const,
      total: filtered.length,
    };
  }

  public async getMembersByIds(
    guildId: string,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, GuildMemberDirectoryItem>> {
    const validatedGuildId = z.string().min(1).max(128).parse(guildId);
    const validatedUserIds = z.array(z.string().min(1).max(128)).max(1_000).parse(userIds);
    const members = new Map<string, GuildMemberDirectoryItem>();
    for (let index = 0; index < validatedUserIds.length; index += 10) {
      const batch = validatedUserIds.slice(index, index + 10);
      await Promise.all(
        batch.map(async (userId) => {
          const payload = await this.#tryRequest(`/guilds/${validatedGuildId}/members/${userId}`);
          if (payload === undefined) return;
          const item = toDirectoryItem(validatedGuildId, memberSchema.parse(payload))[0];
          if (item !== undefined) members.set(userId, item);
        }),
      );
    }
    return members;
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

function toDirectoryItem(
  guildId: string,
  member: z.infer<typeof memberSchema>,
): GuildMemberDirectoryItem[] {
  if (member.user.bot === true || member.joined_at === undefined) return [];
  const avatarUrl =
    member.avatar !== undefined && member.avatar !== null
      ? `https://cdn.discordapp.com/guilds/${guildId}/users/${member.user.id}/avatars/${member.avatar}.png?size=128`
      : member.user.avatar !== undefined && member.user.avatar !== null
        ? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png?size=128`
        : createDefaultAvatarUrl(member.user.id, member.user.discriminator);
  return [
    {
      avatarUrl,
      displayName: member.nick ?? member.user.global_name ?? member.user.username,
      joinedAt: new Date(member.joined_at).toISOString(),
      roleIds: member.roles,
      userId: member.user.id,
    },
  ];
}
