import { z } from "zod";

import type { SecretBox } from "../security/secret-box.js";
import type { PostgresExecutor } from "./postgres-database.js";

export const installationSecretNameSchema = z.enum([
  "discord_bot_token",
  "discord_client_secret",
  "openrouter_api_key",
]);
export const discordBotConfigurationLockSql =
  "SELECT pg_advisory_xact_lock(hashtext('summyz_discord_bot_configuration'))";
export type InstallationSecretName = z.infer<typeof installationSecretNameSchema>;

export interface InstallationSecretStatus {
  discordBotToken: boolean;
  openRouterApiKey: boolean;
}

export interface InstallationSettings {
  discordApplicationId: string | null;
  secrets: InstallationSecretStatus;
  setupCompleted: boolean;
}

const settingsRowSchema = z.object({
  configured_secrets: z.array(installationSecretNameSchema).default([]),
  discord_application_id: z.string().nullable(),
  setup_completed_at: z.union([z.string(), z.date()]).nullable(),
});

export class DiscordBotRotationError extends Error {
  public readonly statusCode = 409;

  public constructor(reason: "active_recording" | "pending_meetings") {
    super(reason);
    this.name = "DiscordBotRotationError";
  }
}

export class PostgresInstallationSettingsStore {
  readonly #database: PostgresExecutor;
  readonly #secretBox: SecretBox;

  public constructor(options: { database: PostgresExecutor; secretBox: SecretBox }) {
    this.#database = options.database;
    this.#secretBox = options.secretBox;
  }

  public async getSettings(): Promise<InstallationSettings> {
    const result = await this.#database.query(
      `SELECT settings.discord_application_id, settings.setup_completed_at,
              COALESCE(
                (SELECT array_agg(secret_name ORDER BY secret_name) FROM installation_secrets),
                ARRAY[]::text[]
              ) AS configured_secrets
       FROM installation_settings AS settings WHERE singleton = true`,
    );
    const row = settingsRowSchema.parse(result.rows[0]);
    const secretNames = new Set(row.configured_secrets);
    return {
      discordApplicationId: row.discord_application_id,
      secrets: {
        discordBotToken: secretNames.has("discord_bot_token"),
        openRouterApiKey: secretNames.has("openrouter_api_key"),
      },
      setupCompleted: row.setup_completed_at !== null,
    };
  }

  public async getBotConfigurationSnapshot(): Promise<{
    discordApplicationId: string | null;
    discordToken: string | undefined;
    setupCompleted: boolean;
    version: string;
  }> {
    const result = await this.#database.query(
      `SELECT settings.discord_application_id, settings.setup_completed_at,
              settings.updated_at::text AS version, secret.encrypted_value
       FROM installation_settings AS settings
       LEFT JOIN installation_secrets AS secret ON secret.secret_name = 'discord_bot_token'
       WHERE settings.singleton = true`,
    );
    const row = z
      .object({
        discord_application_id: z.string().nullable(),
        encrypted_value: z.string().nullable(),
        setup_completed_at: z.union([z.string(), z.date()]).nullable(),
        version: z.string().min(1),
      })
      .parse(result.rows[0]);
    return {
      discordApplicationId: row.discord_application_id,
      discordToken:
        row.encrypted_value === null ? undefined : this.#secretBox.decrypt(row.encrypted_value),
      setupCompleted: row.setup_completed_at !== null,
      version: row.version,
    };
  }

  public async configureDiscordBot(applicationId: string, token: string): Promise<void> {
    const validatedApplicationId = z.string().min(1).max(128).parse(applicationId);
    const encryptedToken = this.#secretBox.encrypt(z.string().min(1).parse(token));
    await this.#database.query(
      `WITH saved_secret AS (
         INSERT INTO installation_secrets (secret_name, encrypted_value)
         VALUES ('discord_bot_token', $2)
         ON CONFLICT (secret_name) DO UPDATE SET
           encrypted_value = EXCLUDED.encrypted_value,
           updated_at = now()
       )
       UPDATE installation_settings
       SET discord_application_id = $1, updated_at = now()
       WHERE singleton = true`,
      [validatedApplicationId, encryptedToken],
    );
  }

  public async rotateDiscordBot(
    applicationId: string,
    token: string,
  ): Promise<"unchanged" | "rotated" | "replaced"> {
    if (this.#database.transaction === undefined) {
      throw new Error("A database transaction is required to rotate the Discord bot");
    }
    const validatedApplicationId = z.string().min(1).max(128).parse(applicationId);
    const validatedToken = z.string().min(1).parse(token);
    return this.#database.transaction(async (database) => {
      await database.query(discordBotConfigurationLockSql);
      const { previousApplicationId, previousToken } = await this.#readPreviousBot(database);
      if (previousApplicationId === validatedApplicationId && previousToken === validatedToken) {
        return "unchanged";
      }
      const applicationChanged =
        previousApplicationId !== null && previousApplicationId !== validatedApplicationId;
      const blocked = await database.query(
        applicationChanged
          ? `SELECT EXISTS (
               SELECT 1 FROM meetings WHERE pipeline_status NOT IN ('completed', 'failed')
             ) AS blocked`
          : `SELECT EXISTS (
               SELECT 1 FROM meetings WHERE pipeline_status = 'recording'
             ) AS blocked`,
      );
      if (z.boolean().parse(blocked.rows[0]?.blocked)) {
        throw new DiscordBotRotationError(
          applicationChanged ? "pending_meetings" : "active_recording",
        );
      }
      await database.query(
        `INSERT INTO installation_secrets (secret_name, encrypted_value)
         VALUES ('discord_bot_token', $1)
         ON CONFLICT (secret_name) DO UPDATE SET
           encrypted_value = EXCLUDED.encrypted_value, updated_at = now()`,
        [this.#secretBox.encrypt(validatedToken)],
      );
      await database.query(
        `UPDATE installation_settings
         SET discord_application_id = $1,
             updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 microsecond')
         WHERE singleton = true`,
        [validatedApplicationId],
      );
      if (applicationChanged) {
        await database.query("DELETE FROM installation_discord_connection");
        await database.query("DELETE FROM installation_oauth_states");
        await database.query(
          "DELETE FROM installation_secrets WHERE secret_name = 'discord_client_secret'",
        );
        await database.query(
          "UPDATE dashboard_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE revoked_at IS NULL",
        );
      }
      return applicationChanged ? "replaced" : "rotated";
    });
  }

  async #readPreviousBot(database: PostgresExecutor): Promise<{
    previousApplicationId: string | null;
    previousToken: string | undefined;
  }> {
    const settings = await database.query(
      "SELECT discord_application_id FROM installation_settings WHERE singleton = true FOR UPDATE",
    );
    const previousApplicationId = z
      .string()
      .nullable()
      .parse(settings.rows[0]?.discord_application_id);
    const secret = await database.query(
      "SELECT encrypted_value FROM installation_secrets WHERE secret_name = 'discord_bot_token'",
    );
    const encryptedPreviousToken = secret.rows[0]?.encrypted_value;
    const previousToken =
      encryptedPreviousToken === undefined
        ? undefined
        : this.#secretBox.decrypt(z.string().min(1).parse(encryptedPreviousToken));
    return { previousApplicationId, previousToken };
  }

  public async getBotConfigurationVersion(): Promise<string> {
    const result = await this.#database.query(
      "SELECT updated_at::text AS version FROM installation_settings WHERE singleton = true",
    );
    return z.string().min(1).parse(result.rows[0]?.version);
  }

  public async completeSetup(): Promise<void> {
    await this.#database.query(
      `UPDATE installation_settings
       SET setup_completed_at = COALESCE(setup_completed_at, now()), updated_at = now()
       WHERE singleton = true`,
    );
  }

  public async setSecret(name: InstallationSecretName, value: string): Promise<void> {
    const validatedValue = z.string().min(1).parse(value);
    await this.#database.query(
      `INSERT INTO installation_secrets (secret_name, encrypted_value)
       VALUES ($1, $2)
       ON CONFLICT (secret_name) DO UPDATE SET
         encrypted_value = EXCLUDED.encrypted_value,
         updated_at = now()`,
      [installationSecretNameSchema.parse(name), this.#secretBox.encrypt(validatedValue)],
    );
  }

  public async removeSecret(name: InstallationSecretName): Promise<void> {
    await this.#database.query("DELETE FROM installation_secrets WHERE secret_name = $1", [
      installationSecretNameSchema.parse(name),
    ]);
  }

  public async getSecret(name: InstallationSecretName): Promise<string | undefined> {
    const result = await this.#database.query(
      "SELECT encrypted_value FROM installation_secrets WHERE secret_name = $1",
      [installationSecretNameSchema.parse(name)],
    );
    const value = result.rows[0]?.encrypted_value;
    return value === undefined
      ? undefined
      : this.#secretBox.decrypt(z.string().min(1).parse(value));
  }
}
