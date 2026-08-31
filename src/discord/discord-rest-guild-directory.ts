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
  nick: z.string().min(1).nullable().optional(),
  user: z.object({
    global_name: z.string().min(1).nullable().optional(),
    username: z.string().min(1),
  }),
});

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
    const [rolesPayload, channelsPayload] = await Promise.all([
      this.#request(`/guilds/${validatedGuildId}/roles`),
      this.#request(`/guilds/${validatedGuildId}/channels`),
    ]);
    return {
      forums: channelsSchema
        .parse(channelsPayload)
        .filter((channel) => channel.type === 15)
        .map((channel) => ({
          id: channel.id,
          name: channel.name,
          tags: channel.available_tags ?? [],
        })),
      roles: rolesSchema
        .parse(rolesPayload)
        .filter((role) => role.id !== validatedGuildId && role.name !== "@everyone"),
    };
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
