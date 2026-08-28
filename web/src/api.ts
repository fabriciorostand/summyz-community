import { z } from "zod";

const setupStatusSchema = z.object({
  registrationEnabled: z.boolean(),
  setupCompleted: z.boolean(),
});
const userSchema = z.object({
  dashboardLanguage: z.enum(["en", "pt-BR"]),
  email: z.email(),
  emailVerified: z.boolean(),
  installationRole: z.enum(["administrator", "member"]),
  userId: z.uuid(),
});
const guildSchema = z.object({
  iconUrl: z.url().nullable(),
  id: z.string(),
  installUrl: z.url(),
  installed: z.boolean(),
  name: z.string(),
});
const discordConnectionSchema = z.discriminatedUnion("connected", [
  z.object({ connected: z.literal(false) }),
  z.object({ connected: z.literal(true), discordUsername: z.string().min(1) }),
]);
const generationSchema = z.object({
  seed: z.number().int().optional(),
  temperature: z.number().optional(),
  think: z.boolean().optional(),
});
const promptSchema = z.string().nullable().optional();
const promptDefaultsSchema = z.object({
  refinement: z.string(),
  summaryConsolidation: z.string(),
  summaryExtraction: z.string(),
  transcription: z.null(),
});
export const profileSchema = z.object({
  guildId: z.string(),
  name: z.string(),
  profileId: z.string(),
  refinement: z.object({
    generation: generationSchema,
    maxChunkCharacters: z.number().int(),
    model: z.string().nullable(),
    prompt: promptSchema,
    provider: z.enum(["ollama", "openrouter"]).nullable(),
  }),
  summary: z.object({
    consolidationPrompt: promptSchema,
    extractionPrompt: promptSchema,
    generation: generationSchema,
    language: z.string(),
    maxChunkCharacters: z.number().int(),
    model: z.string().nullable(),
    provider: z.enum(["ollama", "openrouter"]).nullable(),
  }),
  transcription: z.object({
    batchSize: z.union([z.literal("auto"), z.number().int()]),
    interSpeechSilenceMs: z.number().int(),
    language: z.string(),
    mergeMaxGapMs: z.number().int(),
    model: z.string().nullable(),
    prompt: promptSchema,
    provider: z.enum(["faster-whisper", "openrouter"]).nullable(),
    providerOptions: z.record(z.string(), z.record(z.string(), z.json())).optional(),
    temperature: z.number().optional(),
    timestampMode: z.enum(["batch", "word"]),
  }),
});
const guildConfigurationSchema = z.object({
  activeProfileId: z.string(),
  profiles: z.array(profileSchema),
  recordingRoleIds: z.array(z.string()),
  settings: z.object({
    botLanguage: z.enum(["en", "pt-BR"]),
    persistMeetingAudio: z.boolean(),
    persistMeetingContent: z.boolean(),
  }),
  summaryForum: z.object({ forumId: z.string(), tagId: z.string().optional() }).optional(),
});
const resourcesSchema = z.object({
  forums: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      tags: z.array(z.object({ id: z.string(), name: z.string() })),
    }),
  ),
  roles: z.array(z.object({ id: z.string(), name: z.string() })),
});
const installationSettingsSchema = z.object({
  discordClientId: z.string().nullable(),
  publicBaseUrl: z.url().nullable(),
  registrationEnabled: z.boolean(),
  secrets: z.object({
    discordBotToken: z.boolean(),
    discordClientSecret: z.boolean(),
    openRouterApiKey: z.boolean(),
    smtpPassword: z.boolean(),
  }),
  setupCompleted: z.boolean(),
  smtp: z
    .object({
      fromEmail: z.email(),
      fromName: z.string(),
      host: z.string(),
      port: z.number().int(),
      replyTo: z.email().nullable(),
      secure: z.boolean(),
      user: z.string(),
    })
    .nullable(),
});

export type SetupStatus = z.infer<typeof setupStatusSchema>;
export type User = z.infer<typeof userSchema>;
export type Guild = z.infer<typeof guildSchema>;
export type DiscordConnection = z.infer<typeof discordConnectionSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type PromptDefaults = z.infer<typeof promptDefaultsSchema>;
export type GuildConfiguration = z.infer<typeof guildConfigurationSchema>;
export type GuildResources = z.infer<typeof resourcesSchema>;
export type InstallationSettings = z.infer<typeof installationSettingsSchema>;

export class ApiError extends Error {
  public readonly code: string;
  public readonly status: number;

  public constructor(status: number, code: string) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

let refreshRequest: Promise<boolean> | undefined;

async function refreshSession(): Promise<boolean> {
  refreshRequest ??= fetch("/api/auth/refresh", {
    credentials: "same-origin",
    method: "POST",
  })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      refreshRequest = undefined;
    });
  return refreshRequest;
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined) headers.set("content-type", "application/json");
  let response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers,
  });
  if (response.status === 401 && !path.startsWith("/api/auth/")) {
    if (await refreshSession()) {
      response = await fetch(path, {
        credentials: "same-origin",
        ...init,
        headers,
      });
    }
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => ({}));
    const parsed = z.object({ error: z.string() }).safeParse(body);
    throw new ApiError(response.status, parsed.success ? parsed.data.error : "request_failed");
  }
  if (response.status === 204) return schema.parse(undefined);
  const body: unknown = await response.json();
  return schema.parse(body);
}

const emptySchema = z.undefined();
const json = (value: unknown) => JSON.stringify(value);

export const api = {
  completeDiscord: (code: string, state: string) =>
    request(`/api/discord/callback?${new URLSearchParams({ code, state })}`, emptySchema),
  connectDiscord: () => request("/api/discord/connect", z.object({ authorizationUrl: z.url() })),
  createProfile: (guildId: string, profile: Omit<Profile, "guildId" | "profileId">) =>
    request(`/api/guilds/${guildId}/profiles`, profileSchema, {
      body: json(profile),
      method: "POST",
    }),
  deleteProfile: (guildId: string, profileId: string, replacementProfileId?: string) =>
    request(
      `/api/guilds/${guildId}/profiles/${profileId}${
        replacementProfileId === undefined
          ? ""
          : `?${new URLSearchParams({ replacementProfileId })}`
      }`,
      emptySchema,
      { method: "DELETE" },
    ),
  getPromptDefaults: (summaryLanguage: string) =>
    request(
      `/api/ai/prompts/defaults?${new URLSearchParams({ summaryLanguage })}`,
      promptDefaultsSchema,
    ),
  disconnectDiscord: () => request("/api/discord/connection", emptySchema, { method: "DELETE" }),
  forgotPassword: (email: string) =>
    request("/api/auth/forgot-password", emptySchema, { body: json({ email }), method: "POST" }),
  getGuildConfiguration: (guildId: string) =>
    request(`/api/guilds/${guildId}/configuration`, guildConfigurationSchema),
  getGuildResources: (guildId: string) =>
    request(`/api/guilds/${guildId}/resources`, resourcesSchema),
  getInstallationSettings: () => request("/api/installation/settings", installationSettingsSchema),
  getDiscordConnection: () => request("/api/discord/connection", discordConnectionSchema),
  getSetupStatus: () => request("/api/setup/status", setupStatusSchema),
  listGuilds: () => request("/api/guilds", z.array(guildSchema)),
  login: (email: string, password: string) =>
    request("/api/auth/login", emptySchema, { body: json({ email, password }), method: "POST" }),
  logout: () => request("/api/auth/logout", emptySchema, { method: "POST" }),
  me: () => request("/api/auth/me", userSchema),
  register: (email: string, password: string, dashboardLanguage: "en" | "pt-BR") =>
    request("/api/auth/register", emptySchema, {
      body: json({ dashboardLanguage, email, password }),
      method: "POST",
    }),
  resetPassword: (token: string, password: string) =>
    request("/api/auth/reset-password", emptySchema, {
      body: json({ password, token }),
      method: "POST",
    }),
  setActiveProfile: (guildId: string, profileId: string) =>
    request(`/api/guilds/${guildId}/profiles/${profileId}/active`, emptySchema, { method: "PUT" }),
  setup: (setupToken: string, value: unknown) =>
    request("/api/setup", emptySchema, {
      body: json(value),
      headers: { "x-summyz-setup-token": setupToken },
      method: "POST",
    }),
  updateForum: (guildId: string, forum: { forumId: string; tagId?: string } | null) =>
    request(`/api/guilds/${guildId}/forum`, emptySchema, {
      ...(forum === null ? {} : { body: json(forum) }),
      method: forum === null ? "DELETE" : "PUT",
    }),
  updateGuildSettings: (guildId: string, settings: GuildConfiguration["settings"]) =>
    request(`/api/guilds/${guildId}/settings`, emptySchema, {
      body: json(settings),
      method: "PUT",
    }),
  updateInstallationSettings: (
    settings: Omit<InstallationSettings, "secrets" | "setupCompleted">,
  ) => request("/api/installation/settings", emptySchema, { body: json(settings), method: "PUT" }),
  updateProfile: (guildId: string, profile: Profile) => {
    const { guildId: _guildId, profileId, ...body } = profile;
    return request(`/api/guilds/${guildId}/profiles/${profileId}`, emptySchema, {
      body: json(body),
      method: "PUT",
    });
  },
  updateRoles: (guildId: string, roleIds: string[]) =>
    request(`/api/guilds/${guildId}/roles`, emptySchema, {
      body: json({ roleIds }),
      method: "PUT",
    }),
  updateSecret: (name: string, value: string) =>
    request(`/api/installation/secrets/${name}`, emptySchema, {
      body: json({ value }),
      method: "PUT",
    }),
  verifyEmail: (token: string) =>
    request("/api/auth/verify", emptySchema, { body: json({ token }), method: "POST" }),
};
