import {
  DEFAULT_GUILD_SETTINGS,
  type GuildConfigurationStore,
  type GuildSettings,
  type RecordingPermissions,
  type SummaryForumConfiguration,
} from "../src/guild-config-store.js";

interface GuildConfiguration {
  recordingRoleIds: Set<string>;
  recordingUserGrants: RecordingPermissions["userGrants"];
  settings: GuildSettings;
  summaryForum?: SummaryForumConfiguration;
}

export class InMemoryGuildConfigurationStore implements GuildConfigurationStore {
  readonly #guilds = new Map<string, GuildConfiguration>();

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

  public async getRecordingPermissions(guildId: string): Promise<RecordingPermissions> {
    const configuration = this.#getOrCreate(guildId);
    return {
      roleIds: [...configuration.recordingRoleIds],
      userGrants: [...configuration.recordingUserGrants],
    };
  }

  public async removeRecordingUser(guildId: string, userId: string): Promise<void> {
    const configuration = this.#getOrCreate(guildId);
    configuration.recordingUserGrants = configuration.recordingUserGrants.filter(
      (grant) => grant.userId !== userId,
    );
  }

  public async setRecordingPermissions(
    guildId: string,
    permissions: RecordingPermissions,
  ): Promise<void> {
    const configuration = this.#getOrCreate(guildId);
    configuration.recordingRoleIds = new Set(permissions.roleIds);
    configuration.recordingUserGrants = [...permissions.userGrants];
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
      recordingUserGrants: [],
      settings: { ...DEFAULT_GUILD_SETTINGS },
    };
    this.#guilds.set(guildId, created);
    return created;
  }
}
