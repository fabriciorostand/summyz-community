import { z } from "zod";

import type { SecretBox } from "../security/secret-box.js";
import type { PostgresExecutor } from "./postgres-database.js";

export const installationSecretNameSchema = z.enum([
  "discord_bot_token",
  "discord_client_secret",
  "openrouter_api_key",
  "smtp_password",
]);
export type InstallationSecretName = z.infer<typeof installationSecretNameSchema>;

export const installationSettingsInputSchema = z.object({
  discordClientId: z.string().min(1).max(128).nullable(),
  publicBaseUrl: z.url().nullable(),
  registrationEnabled: z.boolean(),
  smtp: z
    .object({
      fromEmail: z.email(),
      fromName: z.string().trim().min(1).max(100),
      host: z.string().trim().min(1).max(253),
      port: z.number().int().min(1).max(65_535),
      replyTo: z.email().nullable(),
      secure: z.boolean(),
      user: z.string().min(1).max(320),
    })
    .nullable(),
});

export interface InstallationSecretStatus {
  discordBotToken: boolean;
  discordClientSecret: boolean;
  openRouterApiKey: boolean;
  smtpPassword: boolean;
}

export interface InstallationSettings extends z.infer<typeof installationSettingsInputSchema> {
  secrets: InstallationSecretStatus;
  setupCompleted: boolean;
}

const settingsRowSchema = z.object({
  configured_secrets: z.array(installationSecretNameSchema).default([]),
  discord_client_id: z.string().nullable(),
  public_base_url: z.string().nullable(),
  registration_enabled: z.boolean(),
  setup_completed_at: z.union([z.string(), z.date()]).nullable(),
  smtp_from_email: z.string().nullable(),
  smtp_from_name: z.string(),
  smtp_host: z.string().nullable(),
  smtp_port: z.number().int().nullable(),
  smtp_reply_to: z.string().nullable(),
  smtp_secure: z.boolean(),
  smtp_user: z.string().nullable(),
});

interface StoreOptions {
  database: PostgresExecutor;
  secretBox: SecretBox;
}

export class PostgresInstallationSettingsStore {
  readonly #database: PostgresExecutor;
  readonly #secretBox: SecretBox;

  public constructor(options: StoreOptions) {
    this.#database = options.database;
    this.#secretBox = options.secretBox;
  }

  public async getSettings(): Promise<InstallationSettings> {
    const result = await this.#database.query(
      `SELECT settings.discord_client_id, settings.smtp_host, settings.smtp_port,
              settings.smtp_secure, settings.smtp_user, settings.smtp_from_email,
              settings.smtp_from_name, settings.smtp_reply_to,
              settings.registration_enabled, settings.public_base_url,
              settings.setup_completed_at,
              COALESCE(
                (SELECT array_agg(secret_name ORDER BY secret_name) FROM installation_secrets),
                ARRAY[]::text[]
              ) AS configured_secrets
       FROM installation_settings AS settings WHERE singleton = true`,
    );
    const row = settingsRowSchema.parse(result.rows[0]);
    const secretNames = new Set(row.configured_secrets);
    const smtp =
      row.smtp_host === null ||
      row.smtp_port === null ||
      row.smtp_user === null ||
      row.smtp_from_email === null
        ? null
        : {
            fromEmail: row.smtp_from_email,
            fromName: row.smtp_from_name,
            host: row.smtp_host,
            port: row.smtp_port,
            replyTo: row.smtp_reply_to,
            secure: row.smtp_secure,
            user: row.smtp_user,
          };
    return {
      discordClientId: row.discord_client_id,
      publicBaseUrl: row.public_base_url,
      registrationEnabled: row.registration_enabled,
      secrets: {
        discordBotToken: secretNames.has("discord_bot_token"),
        discordClientSecret: secretNames.has("discord_client_secret"),
        openRouterApiKey: secretNames.has("openrouter_api_key"),
        smtpPassword: secretNames.has("smtp_password"),
      },
      setupCompleted: row.setup_completed_at !== null,
      smtp,
    };
  }

  public async getDiscordOAuthConfiguration(): Promise<{
    clientId: string;
    clientSecret: string;
    publicBaseUrl: string;
  }> {
    const settings = await this.getSettings();
    const clientSecret = await this.getSecret("discord_client_secret");
    if (
      settings.discordClientId === null ||
      settings.publicBaseUrl === null ||
      clientSecret === undefined
    ) {
      throw new Error("Discord OAuth is not configured");
    }
    return {
      clientId: settings.discordClientId,
      clientSecret,
      publicBaseUrl: settings.publicBaseUrl,
    };
  }

  public async updateSettings(
    input: z.input<typeof installationSettingsInputSchema>,
  ): Promise<void> {
    const settings = installationSettingsInputSchema.parse(input);
    await this.#database.query(
      `UPDATE installation_settings SET
         discord_client_id = $1,
         smtp_host = $2,
         smtp_port = $3,
         smtp_secure = $4,
         smtp_user = $5,
         smtp_from_email = $6,
         smtp_from_name = $7,
         smtp_reply_to = $8,
         registration_enabled = $9,
         public_base_url = $10,
         updated_at = now()
       WHERE singleton = true`,
      [
        settings.discordClientId,
        settings.smtp?.host ?? null,
        settings.smtp?.port ?? null,
        settings.smtp?.secure ?? false,
        settings.smtp?.user ?? null,
        settings.smtp?.fromEmail ?? null,
        settings.smtp?.fromName ?? "Summyz Community",
        settings.smtp?.replyTo ?? null,
        settings.registrationEnabled,
        settings.publicBaseUrl,
      ],
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
    await this.#database.query(`DELETE FROM installation_secrets WHERE secret_name = $1`, [
      installationSecretNameSchema.parse(name),
    ]);
  }

  public async getSecret(name: InstallationSecretName): Promise<string | undefined> {
    const result = await this.#database.query(
      `SELECT encrypted_value FROM installation_secrets WHERE secret_name = $1`,
      [installationSecretNameSchema.parse(name)],
    );
    const value = result.rows[0]?.encrypted_value;
    return value === undefined
      ? undefined
      : this.#secretBox.decrypt(z.string().min(1).parse(value));
  }
}
