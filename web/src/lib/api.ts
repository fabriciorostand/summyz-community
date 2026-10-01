import { z } from "zod";

import type { DateFormat, Language, TimeFormat } from "../i18n/preferences";

import {
  accessStatusSchema,
  botInstallationSchema,
  commandReferenceSchema,
  dashboardAnalyticsSchema,
  dashboardSettingsSchema,
  dashboardTaskSchema,
  discordAuthorizationSchema,
  discordConnectionSchema,
  type GuildConfiguration,
  guildConfigurationSchema,
  guildMemberPageSchema,
  guildSchema,
  historicalParticipantPageSchema,
  installationHealthSchema,
  meetingHistoryDetailSchema,
  meetingHistoryPageSchema,
  modelCatalogSchema,
  modelDownloadSchema,
  type Profile,
  type ProfileInput,
  profileListItemSchema,
  profileSchema,
  promptDefaultsSchema,
  resourcesSchema,
  setupStatusSchema,
} from "./api-contracts";

export type {
  AccessMode,
  AccessStatus,
  BotInstallation,
  CommandReference,
  DashboardAnalytics,
  DashboardSettings,
  DashboardTask,
  DiscordConnection,
  Guild,
  GuildConfiguration,
  GuildMemberPage,
  GuildResources,
  HistoricalParticipantPage,
  InstallationHealth,
  MeetingHistoryDetail,
  MeetingHistoryPage,
  MeetingHistorySummary,
  ModelCatalog,
  ModelCatalogItem,
  ModelDownload,
  Profile,
  ProfileAvailability,
  ProfileInput,
  ProfileListItem,
  ProfileType,
  PromptDefaults,
  SetupStatus,
} from "./api-contracts";
export { profileSchema } from "./api-contracts";

export class ApiError extends Error {
  public readonly code: string;
  public readonly retryAfterSeconds: number | undefined;
  public readonly status: number;

  public constructor(status: number, code: string, retryAfterSeconds?: number) {
    super(code);
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    this.status = status;
  }
}

type SessionExpiryListener = () => void;
const sessionExpiryListeners = new Set<SessionExpiryListener>();

/**
 * In public mode any request can discover that the session is gone. Screens subscribe here so
 * the shell can swap to the "session expired" state instead of every page handling a 401.
 */
export function subscribeToSessionExpiry(listener: SessionExpiryListener): () => void {
  sessionExpiryListeners.add(listener);
  return () => {
    sessionExpiryListeners.delete(listener);
  };
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await send(path, init);
  await throwIfFailed(response);
  if (response.status === 204) return schema.parse(undefined);
  const body: unknown = await response.json();
  return schema.parse(body);
}

async function requestText(path: string, init?: RequestInit): Promise<string> {
  const response = await send(path, init);
  await throwIfFailed(response);
  return response.text();
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined) headers.set("content-type", "application/json");
  return fetch(path, { credentials: "same-origin", ...init, headers });
}

async function throwIfFailed(response: Response): Promise<void> {
  if (response.ok) return;
  const body: unknown = await response.json().catch(() => ({}));
  const parsed = z.object({ error: z.string() }).safeParse(body);
  const code = parsed.success ? parsed.data.error : "request_failed";
  const retryAfter = Number(response.headers.get("retry-after"));
  if (response.status === 401 && code === "session_expired") {
    for (const listener of sessionExpiryListeners) listener();
  }
  throw new ApiError(
    response.status,
    code,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  );
}

const emptySchema = z.undefined();
type ModelPhase = "transcription" | "refinement" | "summary";
type LocalModelProvider = "ollama" | "faster-whisper";
export type InstallationSecret = "discord_client_secret" | "openrouter_api_key";
const json = (value: unknown) => JSON.stringify(value);

export const api = {
  /** Confirms a server's configuration after an owner change, which resumes recording. */
  activateGuild: (guildId: string) =>
    request(`/api/guilds/${guildId}/activation`, emptySchema, { method: "POST" }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request("/api/access/password", emptySchema, {
      body: json({ currentPassword, newPassword }),
      method: "PUT",
    }),
  cancelModelDownload: (downloadId: string) =>
    request(`/api/models/downloads/${downloadId}/cancel`, z.object({ status: z.string() }), {
      method: "POST",
    }),
  createProfile: (profile: ProfileInput) =>
    request("/api/profiles", profileSchema, {
      body: json(profile),
      method: "POST",
    }),
  deleteProfile: (profileId: string) =>
    request(`/api/profiles/${profileId}`, emptySchema, { method: "DELETE" }),
  getAccessStatus: () => request("/api/access/status", accessStatusSchema),
  getBotInstallation: () => request("/api/installation/bot", botInstallationSchema),
  getDiscordConnection: () => request("/api/discord/connection", discordConnectionSchema),
  getDashboard: (guildId: string, period: "30d" | "90d" | "all", timeZone: string) =>
    request(
      `/api/guilds/${guildId}/dashboard?${new URLSearchParams(
        period === "30d" ? { timeZone } : { period, timeZone },
      )}`,
      dashboardAnalyticsSchema,
    ),
  getGuildConfiguration: (guildId: string) =>
    request(`/api/guilds/${guildId}/configuration`, guildConfigurationSchema),
  getGuildResources: (guildId: string) =>
    request(`/api/guilds/${guildId}/resources`, resourcesSchema),
  getInstallationHealth: () => request("/api/installation/health", installationHealthSchema),
  getMeeting: (guildId: string, meetingId: string, timeZone: string) =>
    request(
      `/api/guilds/${guildId}/meetings/${meetingId}?${new URLSearchParams({ timeZone })}`,
      meetingHistoryDetailSchema,
    ),
  getMeetingExport: (
    guildId: string,
    meetingId: string,
    presentation: { dateFormat: DateFormat; timeFormat: TimeFormat; timeZone: string },
  ) =>
    requestText(
      `/api/guilds/${guildId}/meetings/${meetingId}/export?${new URLSearchParams(presentation)}`,
    ),
  getPromptDefaults: (summaryLanguage: string) =>
    request(
      `/api/ai/prompts/defaults?${new URLSearchParams({ summaryLanguage })}`,
      promptDefaultsSchema,
    ),
  getSettings: () => request("/api/settings", dashboardSettingsSchema),
  getSetupStatus: () => request("/api/setup/status", setupStatusSchema),
  listGuildMembers: (
    guildId: string,
    filters: { page: number; query?: string; roleId?: string },
  ) => {
    const parameters = new URLSearchParams({ page: String(filters.page) });
    if (filters.query !== undefined) parameters.set("query", filters.query);
    if (filters.roleId !== undefined) parameters.set("roleId", filters.roleId);
    return request(`/api/guilds/${guildId}/members?${parameters}`, guildMemberPageSchema);
  },
  listCommands: () => request("/api/commands", commandReferenceSchema),
  listGuilds: () => request("/api/guilds", z.array(guildSchema)),
  listHistoricalParticipants: (guildId: string, page: number, query?: string) => {
    const parameters = new URLSearchParams({ page: String(page) });
    if (query !== undefined) parameters.set("query", query);
    return request(
      `/api/guilds/${guildId}/participants?${parameters}`,
      historicalParticipantPageSchema,
    );
  },
  listMeetings: (
    guildId: string,
    filters: {
      dateFrom?: string;
      dateTo?: string;
      channelName?: string;
      contentRetained?: boolean;
      meetingId?: string;
      page: number;
      participantUserId?: string;
      state?: string;
    },
    timeZone: string,
  ) => {
    const parameters = new URLSearchParams({ page: String(filters.page), timeZone });
    if (filters.meetingId !== undefined) parameters.set("meetingId", filters.meetingId);
    if (filters.dateFrom !== undefined) parameters.set("dateFrom", filters.dateFrom);
    if (filters.dateTo !== undefined) parameters.set("dateTo", filters.dateTo);
    if (filters.channelName !== undefined) parameters.set("channelName", filters.channelName);
    if (filters.contentRetained !== undefined)
      parameters.set("contentRetained", String(filters.contentRetained));
    if (filters.participantUserId !== undefined)
      parameters.set("participantUserId", filters.participantUserId);
    if (filters.state !== undefined) parameters.set("state", filters.state);
    return request(`/api/guilds/${guildId}/meetings?${parameters}`, meetingHistoryPageSchema);
  },
  listModelDownloads: () => request("/api/models/downloads", z.array(modelDownloadSchema)),
  listModels: (phase: ModelPhase, provider: LocalModelProvider | "openrouter", family?: string) => {
    const parameters = new URLSearchParams({ phase, provider });
    if (family !== undefined) parameters.set("family", family);
    return request(`/api/models?${parameters}`, modelCatalogSchema);
  },
  listProfiles: () => request("/api/profiles", z.array(profileListItemSchema)),
  listTasks: (guildId: string, filters: { completed?: boolean; meetingId?: string } = {}) => {
    const parameters = new URLSearchParams();
    if (filters.completed !== undefined) parameters.set("completed", String(filters.completed));
    if (filters.meetingId !== undefined) parameters.set("meetingId", filters.meetingId);
    return request(`/api/guilds/${guildId}/tasks?${parameters}`, z.array(dashboardTaskSchema));
  },
  login: (password: string) =>
    request("/api/access/login", emptySchema, { body: json({ password }), method: "POST" }),
  logout: () => request("/api/access/logout", emptySchema, { method: "POST" }),
  removeSecret: (name: InstallationSecret) =>
    request(`/api/installation/secrets/${name}`, emptySchema, { method: "DELETE" }),
  replaceBotToken: (discordBotToken: string) =>
    request("/api/installation/bot", emptySchema, {
      body: json({ discordBotToken }),
      method: "PUT",
    }),
  setActiveProfile: (guildId: string, profileId: string) =>
    request(`/api/guilds/${guildId}/profiles/${profileId}/active`, emptySchema, { method: "PUT" }),
  /** Returns the Discord authorization page; the backend redirects back to /servers. */
  startDiscordConnection: () =>
    request("/api/discord/connect", discordAuthorizationSchema).then(
      ({ authorizationUrl }) => authorizationUrl,
    ),
  startModelDownload: (phase: ModelPhase, provider: LocalModelProvider, model: string) =>
    request("/api/models/downloads", modelDownloadSchema, {
      body: json({ model, phase, provider }),
      method: "POST",
    }),
  setTaskCompleted: (guildId: string, taskId: string, completed: boolean) =>
    request(`/api/guilds/${guildId}/tasks/${taskId}/completion`, emptySchema, {
      body: json({ completed }),
      method: "PATCH",
    }),
  /** The claim token only exists in public mode; local installations skip it entirely. */
  setup: (
    claimToken: string | undefined,
    value: {
      discordBotToken: string;
      discordClientSecret?: string;
      installationPassword?: string;
      setupLanguage: Language;
    },
  ) =>
    request("/api/setup", emptySchema, {
      body: json(value),
      headers: claimToken === undefined ? {} : { "x-summyz-setup-token": claimToken },
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
  uninstallModel: (provider: LocalModelProvider, model: string) =>
    request("/api/models", emptySchema, { body: json({ model, provider }), method: "DELETE" }),
  updateProfile: (profile: Profile) => {
    const { profileId, profileType: _profileType, ...body } = profile;
    return request(`/api/profiles/${profileId}`, emptySchema, {
      body: json(body),
      method: "PUT",
    });
  },
  updateRecordingPermissions: (
    guildId: string,
    permissions: { roleIds: string[]; userIds: string[] },
  ) =>
    request(`/api/guilds/${guildId}/recording-permissions`, emptySchema, {
      body: json(permissions),
      method: "PUT",
    }),
  updateSecret: (name: InstallationSecret, value: string) =>
    request(`/api/installation/secrets/${name}`, emptySchema, {
      body: json({ value }),
      method: "PUT",
    }),
};
