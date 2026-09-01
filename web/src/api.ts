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
const promptSchema = z.string().nullable();
const promptDefaultsSchema = z.object({
  refinement: z.string(),
  summaryConsolidation: z.string(),
  summaryExtraction: z.string(),
  transcription: z.null(),
});
const automaticNumberSchema = z.union([z.literal("auto"), z.number()]);
const externalVadSchema = z.object({
  enabled: z.boolean(),
  minSilenceDurationMs: z.number().int(),
  minSpeechDurationMs: z.number().int(),
  negativeSpeechThreshold: automaticNumberSchema,
  speechPadMs: z.number().int(),
  threshold: z.number(),
});
const localVadSchema = z.object({
  enabled: z.boolean(),
  maxSpeechDurationSeconds: automaticNumberSchema,
  minSilenceDurationMs: automaticNumberSchema,
  minSpeechDurationMs: z.number().int(),
  negativeSpeechThreshold: automaticNumberSchema,
  speechPadMs: z.number().int(),
  threshold: z.number(),
});
const profileBaseShape = {
  language: z.enum([
    "auto",
    "ar",
    "cs",
    "da",
    "de",
    "el",
    "en",
    "en-GB",
    "en-US",
    "es",
    "es-ES",
    "es-MX",
    "fi",
    "fr",
    "fr-CA",
    "he",
    "hi",
    "hu",
    "id",
    "it",
    "ja",
    "ko",
    "nl",
    "no",
    "pl",
    "pt",
    "pt-BR",
    "pt-PT",
    "ro",
    "ru",
    "sv",
    "th",
    "tr",
    "uk",
    "vi",
    "zh",
    "zh-CN",
    "zh-TW",
  ]),
  name: z.string(),
  profileId: z.string(),
  userId: z.string(),
};
const refinementBaseShape = {
  generation: generationSchema,
  maxChunkCharacters: z.number().int(),
  model: z.string().nullable(),
  prompt: promptSchema,
};
const summaryBaseShape = {
  consolidationPrompt: promptSchema,
  extractionPrompt: promptSchema,
  generation: generationSchema,
  maxChunkCharacters: z.number().int(),
  model: z.string().nullable(),
};
const transcriptionBaseShape = {
  interSpeechSilenceMs: z.number().int(),
  mergeMaxGapMs: z.number().int(),
  model: z.string().nullable(),
  prompt: promptSchema,
  providerOptions: z.record(z.string(), z.record(z.string(), z.json())).optional(),
  temperature: z.number().optional(),
};
const translationBaseShape = {
  generation: generationSchema,
  model: z.string().nullable(),
  prompt: promptSchema,
};
export const profileSchema = z.discriminatedUnion("profileType", [
  z.object({
    ...profileBaseShape,
    profileType: z.literal("external"),
    refinement: z.object({ ...refinementBaseShape, provider: z.literal("openrouter") }),
    summary: z.object({ ...summaryBaseShape, provider: z.literal("openrouter") }),
    transcription: z.object({
      ...transcriptionBaseShape,
      provider: z.literal("openrouter"),
      vad: externalVadSchema,
    }),
    translation: z
      .object({ ...translationBaseShape, provider: z.literal("openrouter") })
      .nullable(),
  }),
  z.object({
    ...profileBaseShape,
    profileType: z.literal("local"),
    refinement: z.object({ ...refinementBaseShape, provider: z.literal("ollama") }),
    summary: z.object({ ...summaryBaseShape, provider: z.literal("ollama") }),
    transcription: z.object({
      ...transcriptionBaseShape,
      batchSize: z.union([z.literal("auto"), z.number().int()]),
      provider: z.literal("faster-whisper"),
      vad: localVadSchema,
    }),
    translation: z.object({ ...translationBaseShape, provider: z.literal("ollama") }).nullable(),
  }),
]);
const guildConfigurationSchema = z.object({
  activeProfileId: z.string().nullable(),
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
const analyticsParticipantSchema = z.object({
  displayName: z.string(),
  percentage: z.number().int().nullable(),
  talkTimeMs: z.number().int().nullable(),
  userId: z.string(),
});
const meetingHistoryItemSchema = z.object({
  completedAt: z.iso.datetime().nullable(),
  contentRetained: z.boolean(),
  durationMs: z.number().int().nullable(),
  failureCode: z.string().nullable(),
  meetingId: z.string(),
  participants: z.array(analyticsParticipantSchema).nullable(),
  pipelineStatus: z.string(),
  startedAt: z.iso.datetime(),
  voiceChannelName: z.string().nullable(),
});
const dashboardAnalyticsSchema = z.object({
  averageDurationMs: z.number().int(),
  confirmedCost: z.array(z.object({ amount: z.number(), currency: z.string().length(3) })),
  hasUnresolvedCosts: z.boolean(),
  timeZone: z.string(),
  topSpeakers: z.array(
    z.object({ displayName: z.string(), talkTimeMs: z.number().int(), userId: z.string() }),
  ),
  totalCalls: z.number().int(),
  totalDurationMs: z.number().int(),
});
const meetingHistoryPageSchema = z.object({
  items: z.array(meetingHistoryItemSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  timeZone: z.string(),
  total: z.number().int(),
});
const meetingHistorySummaryTaskSchema = z.object({
  deadlineText: z.string().optional(),
  ownerName: z.string().optional(),
  text: z.string(),
});
const meetingHistoryLabelsSchema = z.object({
  assignee: z.string(),
  deadline: z.string(),
  decisions: z.string(),
  discussedTopics: z.string(),
  executiveSummary: z.string(),
  fullTranscript: z.string(),
  meetingId: z.string(),
  observations: z.string(),
  summary: z.string(),
  tasks: z.string(),
  transcript: z.string(),
});
const meetingHistorySummarySchema = z.discriminatedUnion("status", [
  z.object({
    decisions: z.array(z.string()),
    discussedTopics: z.array(z.string()),
    executiveSummary: z.string(),
    language: z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/),
    labels: meetingHistoryLabelsSchema.optional(),
    observations: z.array(z.string()),
    status: z.literal("completed"),
    tasks: z.array(meetingHistorySummaryTaskSchema),
  }),
  z.object({
    language: z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/),
    status: z.literal("failed"),
  }),
]);
const meetingHistoryDetailSchema = meetingHistoryItemSchema.extend({
  rawTranscript: z.string().nullable(),
  summary: meetingHistorySummarySchema.nullable(),
  timeZone: z.string(),
  transcript: z.string().nullable(),
});

export type SetupStatus = z.infer<typeof setupStatusSchema>;
export type User = z.infer<typeof userSchema>;
export type Guild = z.infer<typeof guildSchema>;
export type DiscordConnection = z.infer<typeof discordConnectionSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type ProfileInput =
  | Omit<Extract<Profile, { profileType: "external" }>, "profileId" | "userId">
  | Omit<Extract<Profile, { profileType: "local" }>, "profileId" | "userId">;
export interface ProfileListItem {
  active: boolean;
  profile: Profile;
}
export type PromptDefaults = z.infer<typeof promptDefaultsSchema>;
export type GuildConfiguration = z.infer<typeof guildConfigurationSchema>;
export type GuildResources = z.infer<typeof resourcesSchema>;
export type InstallationSettings = z.infer<typeof installationSettingsSchema>;
export type DashboardAnalytics = z.infer<typeof dashboardAnalyticsSchema>;
export type MeetingHistoryPage = z.infer<typeof meetingHistoryPageSchema>;
export type MeetingHistoryDetail = z.infer<typeof meetingHistoryDetailSchema>;
export type MeetingHistorySummary = z.infer<typeof meetingHistorySummarySchema>;

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
  createProfile: (profile: ProfileInput) =>
    request("/api/profiles", profileSchema, {
      body: json(profile),
      method: "POST",
    }),
  deleteProfile: (profileId: string) =>
    request(`/api/profiles/${profileId}`, emptySchema, { method: "DELETE" }),
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
  getDashboard: (guildId: string) =>
    request(`/api/guilds/${guildId}/dashboard`, dashboardAnalyticsSchema),
  getMeeting: (guildId: string, meetingId: string) =>
    request(`/api/guilds/${guildId}/meetings/${meetingId}`, meetingHistoryDetailSchema),
  getDiscordConnection: () => request("/api/discord/connection", discordConnectionSchema),
  getSetupStatus: () => request("/api/setup/status", setupStatusSchema),
  listGuilds: () => request("/api/guilds", z.array(guildSchema)),
  listMeetings: (
    guildId: string,
    filters: {
      dateFrom?: string;
      dateTo?: string;
      meetingId?: string;
      page: number;
      state?: string;
    },
  ) => {
    const parameters = new URLSearchParams({ page: String(filters.page) });
    if (filters.meetingId !== undefined) parameters.set("meetingId", filters.meetingId);
    if (filters.dateFrom !== undefined) parameters.set("dateFrom", filters.dateFrom);
    if (filters.dateTo !== undefined) parameters.set("dateTo", filters.dateTo);
    if (filters.state !== undefined) parameters.set("state", filters.state);
    return request(`/api/guilds/${guildId}/meetings?${parameters}`, meetingHistoryPageSchema);
  },
  listProfiles: () =>
    request("/api/profiles", z.array(z.object({ active: z.boolean(), profile: profileSchema }))),
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
  updateProfile: (profile: Profile) => {
    const { profileId, userId: _userId, ...body } = profile;
    return request(`/api/profiles/${profileId}`, emptySchema, {
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
