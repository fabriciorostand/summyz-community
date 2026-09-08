import { z } from "zod";

import {
  dashboardAnalyticsSchema,
  dashboardTaskSchema,
  discordConnectionSchema,
  type GuildConfiguration,
  guildConfigurationSchema,
  guildMemberPageSchema,
  guildSchema,
  historicalParticipantPageSchema,
  type InstallationSettings,
  installationHealthSchema,
  installationSettingsSchema,
  meetingHistoryDetailSchema,
  meetingHistoryPageSchema,
  type Profile,
  type ProfileInput,
  profileSchema,
  promptDefaultsSchema,
  resourcesSchema,
  setupStatusSchema,
  userSchema,
} from "./api-contracts";

export type {
  DashboardAnalytics,
  DashboardTask,
  DiscordConnection,
  Guild,
  GuildConfiguration,
  GuildMemberPage,
  GuildResources,
  HistoricalParticipantPage,
  InstallationHealth,
  InstallationSettings,
  MeetingHistoryDetail,
  MeetingHistoryPage,
  MeetingHistorySummary,
  Profile,
  ProfileInput,
  ProfileListItem,
  PromptDefaults,
  SetupStatus,
  User,
} from "./api-contracts";
export { profileSchema } from "./api-contracts";

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
  const response = await authenticatedFetch(path, init);
  await throwIfFailed(response);
  if (response.status === 204) return schema.parse(undefined);
  const body: unknown = await response.json();
  return schema.parse(body);
}

async function requestText(path: string, init?: RequestInit): Promise<string> {
  const response = await authenticatedFetch(path, init);
  await throwIfFailed(response);
  return response.text();
}

async function authenticatedFetch(path: string, init?: RequestInit): Promise<Response> {
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
  return response;
}

async function throwIfFailed(response: Response): Promise<void> {
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => ({}));
    const parsed = z.object({ error: z.string() }).safeParse(body);
    throw new ApiError(response.status, parsed.success ? parsed.data.error : "request_failed");
  }
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
  getInstallationHealth: () => request("/api/installation/health", installationHealthSchema),
  getDashboard: (guildId: string, period: "30d" | "90d" | "all" = "30d") =>
    request(
      `/api/guilds/${guildId}/dashboard${
        period === "30d" ? "" : `?${new URLSearchParams({ period })}`
      }`,
      dashboardAnalyticsSchema,
    ),
  getMeeting: (guildId: string, meetingId: string) =>
    request(`/api/guilds/${guildId}/meetings/${meetingId}`, meetingHistoryDetailSchema),
  getMeetingExport: (guildId: string, meetingId: string) =>
    requestText(`/api/guilds/${guildId}/meetings/${meetingId}/export`),
  getDiscordConnection: () => request("/api/discord/connection", discordConnectionSchema),
  getSetupStatus: () => request("/api/setup/status", setupStatusSchema),
  listGuilds: () => request("/api/guilds", z.array(guildSchema)),
  listGuildMembers: (
    guildId: string,
    filters: { page: number; query?: string; roleId?: string },
  ) => {
    const parameters = new URLSearchParams({ page: String(filters.page) });
    if (filters.query !== undefined) parameters.set("query", filters.query);
    if (filters.roleId !== undefined) parameters.set("roleId", filters.roleId);
    return request(`/api/guilds/${guildId}/members?${parameters}`, guildMemberPageSchema);
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
  ) => {
    const parameters = new URLSearchParams({ page: String(filters.page) });
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
  listProfiles: () =>
    request(
      "/api/profiles",
      z.array(
        z.object({
          active: z.boolean(),
          activeServerCount: z.number().int().optional(),
          profile: profileSchema,
        }),
      ),
    ),
  listHistoricalParticipants: (guildId: string, page: number, query?: string) => {
    const parameters = new URLSearchParams({ page: String(page) });
    if (query !== undefined) parameters.set("query", query);
    return request(
      `/api/guilds/${guildId}/participants?${parameters}`,
      historicalParticipantPageSchema,
    );
  },
  login: (email: string, password: string) =>
    request("/api/auth/login", emptySchema, { body: json({ email, password }), method: "POST" }),
  logout: () => request("/api/auth/logout", emptySchema, { method: "POST" }),
  me: () => request("/api/auth/me", userSchema),
  register: (email: string, password: string, dashboardLanguage: "en" | "pt-BR") =>
    request("/api/auth/register", emptySchema, {
      body: json({ dashboardLanguage, email, password }),
      method: "POST",
    }),
  listTasks: (guildId: string, filters: { completed?: boolean; meetingId?: string } = {}) => {
    const parameters = new URLSearchParams();
    if (filters.completed !== undefined) parameters.set("completed", String(filters.completed));
    if (filters.meetingId !== undefined) parameters.set("meetingId", filters.meetingId);
    return request(`/api/guilds/${guildId}/tasks?${parameters}`, z.array(dashboardTaskSchema));
  },
  setTaskCompleted: (guildId: string, taskId: string, completed: boolean) =>
    request(`/api/guilds/${guildId}/tasks/${taskId}/completion`, emptySchema, {
      body: json({ completed }),
      method: "PATCH",
    }),
  resetPassword: (token: string, password: string) =>
    request("/api/auth/reset-password", emptySchema, {
      body: json({ password, token }),
      method: "POST",
    }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request("/api/auth/change-password", emptySchema, {
      body: json({ currentPassword, newPassword }),
      method: "POST",
    }),
  updatePreferences: (
    dashboardLanguage: "en" | "pt-BR",
    dashboardTheme: "system" | "light" | "dark",
  ) =>
    request("/api/account/preferences", emptySchema, {
      body: json({ dashboardLanguage, dashboardTheme }),
      method: "PUT",
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
  updateRecordingPermissions: (
    guildId: string,
    permissions: { roleIds: string[]; userIds: string[] },
  ) =>
    request(`/api/guilds/${guildId}/recording-permissions`, emptySchema, {
      body: json(permissions),
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
