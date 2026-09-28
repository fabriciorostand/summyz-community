import { z } from "zod";

import type { SecretBox } from "../security/secret-box.js";
import type { PostgresExecutor } from "./postgres-database.js";

export const installationSecretNameSchema = z.enum(["discord_bot_token", "openrouter_api_key"]);
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
