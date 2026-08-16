import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

const guildConfigurationSchema = z.object({
  recordingRoleIds: z.array(z.string()).default([]),
});

const persistedConfigurationSchema = z.object({
  guilds: z.record(z.string(), guildConfigurationSchema).default({}),
  schemaVersion: z.literal(1),
});

type PersistedConfiguration = z.infer<typeof persistedConfigurationSchema>;

const EMPTY_CONFIGURATION: PersistedConfiguration = {
  guilds: {},
  schemaVersion: 1,
};

export class GuildConfigStore {
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
          [guildId]: { recordingRoleIds },
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
          recordingRoleIds: (configuration.guilds[guildId]?.recordingRoleIds ?? []).filter(
            (currentRoleId) => currentRoleId !== roleId,
          ),
        },
      },
    }));
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
