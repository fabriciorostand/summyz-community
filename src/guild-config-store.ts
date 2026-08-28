import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

const guildConfigurationSchema = z.object({
  botLanguage: z.enum(["en", "pt-BR"]).default("en"),
  persistMeetingAudio: z.boolean().default(false),
  persistMeetingContent: z.boolean().default(true),
  recordingRoleIds: z.array(z.string()).default([]),
  summaryForum: z
    .object({
      forumId: z.string().min(1),
      tagId: z.string().min(1).optional(),
    })
    .optional(),
});

const persistedConfigurationSchema = z.object({
  guilds: z.record(z.string(), guildConfigurationSchema).default({}),
  schemaVersion: z.literal(1),
});

type PersistedConfiguration = z.infer<typeof persistedConfigurationSchema>;
export type SummaryForumConfiguration = NonNullable<
  z.infer<typeof guildConfigurationSchema>["summaryForum"]
>;
export type GuildSettings = Pick<
  z.infer<typeof guildConfigurationSchema>,
  "botLanguage" | "persistMeetingAudio" | "persistMeetingContent"
>;

export const DEFAULT_GUILD_SETTINGS: GuildSettings = {
  botLanguage: "en",
  persistMeetingAudio: false,
  persistMeetingContent: true,
};

export interface GuildConfigurationStore {
  addRecordingRole(guildId: string, roleId: string): Promise<void>;
  clearSummaryForum(guildId: string): Promise<void>;
  getSummaryForum(guildId: string): Promise<SummaryForumConfiguration | undefined>;
  getGuildSettings(guildId: string): Promise<GuildSettings>;
  listRecordingRoles(guildId: string): Promise<string[]>;
  removeRecordingRole(guildId: string, roleId: string): Promise<void>;
  setSummaryForum(guildId: string, summaryForum: SummaryForumConfiguration): Promise<void>;
  setGuildSettings(guildId: string, settings: GuildSettings): Promise<void>;
}

const EMPTY_CONFIGURATION: PersistedConfiguration = {
  guilds: {},
  schemaVersion: 1,
};

export class GuildConfigStore implements GuildConfigurationStore {
  readonly #filePath: string;
  #writeQueue: Promise<void> = Promise.resolve();

  public constructor(filePath: string) {
    this.#filePath = filePath;
  }

  public async listRecordingRoles(guildId: string): Promise<string[]> {
    await this.#writeQueue;
    const configuration = await this.#read();
    return [...(configuration.guilds[guildId]?.recordingRoleIds ?? [])];
  }

  public async getSummaryForum(guildId: string): Promise<SummaryForumConfiguration | undefined> {
    await this.#writeQueue;
    const configuration = await this.#read();
    const summaryForum = configuration.guilds[guildId]?.summaryForum;
    return summaryForum === undefined ? undefined : { ...summaryForum };
  }

  public async getGuildSettings(guildId: string): Promise<GuildSettings> {
    await this.#writeQueue;
    const configuration = await this.#read();
    const guild = configuration.guilds[guildId];
    return guild === undefined
      ? { ...DEFAULT_GUILD_SETTINGS }
      : {
          botLanguage: guild.botLanguage,
          persistMeetingAudio: guild.persistMeetingAudio,
          persistMeetingContent: guild.persistMeetingContent,
        };
  }

  public async setGuildSettings(guildId: string, settings: GuildSettings): Promise<void> {
    const validated = guildConfigurationSchema
      .pick({ botLanguage: true, persistMeetingAudio: true, persistMeetingContent: true })
      .parse(settings);
    await this.#enqueueUpdate((configuration) => ({
      ...configuration,
      guilds: {
        ...configuration.guilds,
        [guildId]: {
          ...DEFAULT_GUILD_SETTINGS,
          ...configuration.guilds[guildId],
          ...validated,
          recordingRoleIds: configuration.guilds[guildId]?.recordingRoleIds ?? [],
        },
      },
    }));
  }

  public async addRecordingRole(guildId: string, roleId: string): Promise<void> {
    await this.#enqueueUpdate((configuration) => {
      const currentRoles = configuration.guilds[guildId]?.recordingRoleIds ?? [];
      const recordingRoleIds = currentRoles.includes(roleId)
        ? currentRoles
        : [...currentRoles, roleId];

      return {
        ...configuration,
        guilds: {
          ...configuration.guilds,
          [guildId]: {
            ...DEFAULT_GUILD_SETTINGS,
            ...configuration.guilds[guildId],
            recordingRoleIds,
          },
        },
      };
    });
  }

  public async removeRecordingRole(guildId: string, roleId: string): Promise<void> {
    await this.#enqueueUpdate((configuration) => ({
      ...configuration,
      guilds: {
        ...configuration.guilds,
        [guildId]: {
          ...DEFAULT_GUILD_SETTINGS,
          ...configuration.guilds[guildId],
          recordingRoleIds: (configuration.guilds[guildId]?.recordingRoleIds ?? []).filter(
            (currentRoleId) => currentRoleId !== roleId,
          ),
        },
      },
    }));
  }

  public async setSummaryForum(
    guildId: string,
    summaryForum: SummaryForumConfiguration,
  ): Promise<void> {
    const validated = guildConfigurationSchema.shape.summaryForum.unwrap().parse(summaryForum);
    await this.#enqueueUpdate((configuration) => ({
      ...configuration,
      guilds: {
        ...configuration.guilds,
        [guildId]: {
          ...DEFAULT_GUILD_SETTINGS,
          ...configuration.guilds[guildId],
          recordingRoleIds: configuration.guilds[guildId]?.recordingRoleIds ?? [],
          summaryForum: validated,
        },
      },
    }));
  }

  public async clearSummaryForum(guildId: string): Promise<void> {
    await this.#enqueueUpdate((configuration) => {
      const current = configuration.guilds[guildId];
      if (current === undefined) {
        return configuration;
      }
      const { summaryForum: _summaryForum, ...remaining } = current;
      return {
        ...configuration,
        guilds: {
          ...configuration.guilds,
          [guildId]: remaining,
        },
      };
    });
  }

  async #enqueueUpdate(
    update: (configuration: PersistedConfiguration) => PersistedConfiguration,
  ): Promise<void> {
    const operation = this.#writeQueue.then(async () => {
      const configuration = await this.#read();
      await this.#write(update(configuration));
    });

    this.#writeQueue = operation.catch(() => undefined);
    await operation;
  }

  async #read(): Promise<PersistedConfiguration> {
    try {
      const content = await readFile(this.#filePath, "utf8");
      return persistedConfigurationSchema.parse(JSON.parse(content));
    } catch (error) {
      if (isFileNotFound(error)) {
        return structuredClone(EMPTY_CONFIGURATION);
      }
      throw error;
    }
  }

  async #write(configuration: PersistedConfiguration): Promise<void> {
    const validated = persistedConfigurationSchema.parse(configuration);
    const directory = dirname(this.#filePath);
    const temporaryPath = `${this.#filePath}.${process.pid}.${Date.now()}.tmp`;

    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, this.#filePath);
  }
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
