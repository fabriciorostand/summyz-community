import {
  DEFAULT_GUILD_SETTINGS,
  type GuildConfigurationStore,
  type GuildSettings,
  type SummaryForumConfiguration,
} from "../src/guild-config-store.js";

interface GuildConfiguration {
  recordingRoleIds: Set<string>;
  settings: GuildSettings;
  summaryForum?: SummaryForumConfiguration;
}

export class InMemoryGuildConfigurationStore implements GuildConfigurationStore {
  readonly #guilds = new Map<string, GuildConfiguration>();

  public async addRecordingRole(guildId: string, roleId: string): Promise<void> {
    this.#getOrCreate(guildId).recordingRoleIds.add(roleId);
  }

  public async clearSummaryForum(guildId: string): Promise<void> {
    const configuration = this.#guilds.get(guildId);
    if (configuration !== undefined) delete configuration.summaryForum;
  }

  public async getGuildSettings(guildId: string): Promise<GuildSettings> {
    return { ...this.#getOrCreate(guildId).settings };
  }

  public async getSummaryForum(guildId: string): Promise<SummaryForumConfiguration | undefined> {
    const summaryForum = this.#guilds.get(guildId)?.summaryForum;
    return summaryForum === undefined ? undefined : { ...summaryForum };
  }

  public async listRecordingRoles(guildId: string): Promise<string[]> {
    return [...this.#getOrCreate(guildId).recordingRoleIds];
  }

  public async removeRecordingRole(guildId: string, roleId: string): Promise<void> {
    this.#getOrCreate(guildId).recordingRoleIds.delete(roleId);
  }

  public async setGuildSettings(guildId: string, settings: GuildSettings): Promise<void> {
    this.#getOrCreate(guildId).settings = { ...settings };
  }

  public async setSummaryForum(
    guildId: string,
    summaryForum: SummaryForumConfiguration,
  ): Promise<void> {
    this.#getOrCreate(guildId).summaryForum = { ...summaryForum };
  }

  #getOrCreate(guildId: string): GuildConfiguration {
    const existing = this.#guilds.get(guildId);
    if (existing !== undefined) return existing;
    const created = {
      recordingRoleIds: new Set<string>(),
      settings: { ...DEFAULT_GUILD_SETTINGS },
    };
    this.#guilds.set(guildId, created);
    return created;
  }
}
