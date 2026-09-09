import { z } from "zod";

import { dashboardLanguageSchema, dashboardThemeSchema } from "../auth/auth-domain.js";
import type { SecretBox } from "../security/secret-box.js";
import type { PostgresExecutor } from "./postgres-database.js";

export const installationSecretNameSchema = z.enum([
  "discord_bot_token",
  "discord_client_secret",
  "openrouter_api_key",
]);
export type InstallationSecretName = z.infer<typeof installationSecretNameSchema>;

export const installationSettingsInputSchema = z.object({
  discordClientId: z.string().min(1).max(128).nullable(),
});

export interface InstallationSecretStatus {
  discordBotToken: boolean;
  discordClientSecret: boolean;
  openRouterApiKey: boolean;
}

export interface InstallationSettings extends z.infer<typeof installationSettingsInputSchema> {
  dashboardLanguage: "en" | "pt-BR";
  dashboardTheme: "system" | "light" | "dark";
  ownerDiscordUserId: string | null;
  secrets: InstallationSecretStatus;
  setupCompleted: boolean;
}

const settingsRowSchema = z.object({
  configured_secrets: z.array(installationSecretNameSchema).default([]),
  dashboard_language: dashboardLanguageSchema,
  dashboard_theme: dashboardThemeSchema,
  discord_client_id: z.string().nullable(),
  owner_discord_user_id: z.string().nullable(),
  setup_completed_at: z.union([z.string(), z.date()]).nullable(),
});

interface StoreOptions {
  database: PostgresExecutor;
  publicBaseUrl?: string;
  secretBox: SecretBox;
}

export class PostgresInstallationSettingsStore {
  readonly #database: PostgresExecutor;
  readonly #publicBaseUrl: string | undefined;
  readonly #secretBox: SecretBox;

  public constructor(options: StoreOptions) {
    this.#database = options.database;
    this.#publicBaseUrl = z.url().optional().parse(options.publicBaseUrl);
    this.#secretBox = options.secretBox;
  }

  public async getSettings(): Promise<InstallationSettings> {
    const result = await this.#database.query(
      `SELECT settings.discord_client_id, settings.dashboard_language, settings.dashboard_theme,
              settings.owner_discord_user_id, settings.setup_completed_at,
              COALESCE(
                (SELECT array_agg(secret_name ORDER BY secret_name) FROM installation_secrets),
                ARRAY[]::text[]
              ) AS configured_secrets
       FROM installation_settings AS settings WHERE singleton = true`,
    );
    const row = settingsRowSchema.parse(result.rows[0]);
    const secretNames = new Set(row.configured_secrets);
    return {
      dashboardLanguage: row.dashboard_language,
      dashboardTheme: row.dashboard_theme,
      discordClientId: row.discord_client_id,
      ownerDiscordUserId: row.owner_discord_user_id,
      secrets: {
        discordBotToken: secretNames.has("discord_bot_token"),
        discordClientSecret: secretNames.has("discord_client_secret"),
        openRouterApiKey: secretNames.has("openrouter_api_key"),
      },
      setupCompleted: row.setup_completed_at !== null,
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
      clientSecret === undefined ||
      this.#publicBaseUrl === undefined
    ) {
      throw new Error("Discord OAuth is not configured");
    }
    return {
      clientId: settings.discordClientId,
      clientSecret,
      publicBaseUrl: this.#publicBaseUrl,
    };
  }

  public async updateSettings(
    input: z.input<typeof installationSettingsInputSchema>,
  ): Promise<void> {
    const settings = installationSettingsInputSchema.parse(input);
    await this.#database.query(
      `UPDATE installation_settings
       SET discord_client_id = $1, updated_at = now()
       WHERE singleton = true`,
      [settings.discordClientId],
    );
  }

  public async updatePreferences(input: {
    dashboardLanguage: "en" | "pt-BR";
    dashboardTheme: "system" | "light" | "dark";
  }): Promise<void> {
    await this.#database.query(
      `UPDATE installation_settings
       SET dashboard_language = $1, dashboard_theme = $2, updated_at = now()
       WHERE singleton = true`,
      [
        dashboardLanguageSchema.parse(input.dashboardLanguage),
        dashboardThemeSchema.parse(input.dashboardTheme),
      ],
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
