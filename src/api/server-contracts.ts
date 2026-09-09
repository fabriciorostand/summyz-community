import type { Logger } from "pino";
import { z } from "zod";

import { externalAiProfileSchema, localAiProfileSchema } from "../ai-profile.js";
import type { AuthenticatedUser } from "../auth/auth-domain.js";
import type { AiProfileStore } from "../database/postgres-ai-profile-store.js";
import type {
  DashboardAnalytics,
  DashboardAnalyticsOptions,
  MeetingHistoryDetail,
  MeetingHistoryFilters,
  MeetingHistoryPage,
} from "../database/postgres-analytics-store.js";
import type { InstallationHealthStatus } from "../database/postgres-installation-health-store.js";
import type {
  InstallationSecretName,
  InstallationSettings,
} from "../database/postgres-installation-settings-store.js";
import { installationSettingsInputSchema } from "../database/postgres-installation-settings-store.js";
import type { LiveMeetingState } from "../database/postgres-live-meeting-store.js";
import type { PostgresParticipantDirectoryStore } from "../database/postgres-participant-directory-store.js";
import type { DashboardTask } from "../database/postgres-task-store.js";
import type {
  DiscordConnectionStatus,
  OwnedDiscordGuild,
} from "../discord/discord-oauth-service.js";
import type { GuildConfigurationStore } from "../guild-config-store.js";

export const setupSchema = z.object({
  installation: installationSettingsInputSchema.extend({
    secrets: z.object({
      discordBotToken: z.string().min(1),
      discordClientSecret: z.string().min(1),
    }),
  }),
});
export const guildSettingsSchema = z.object({
  botLanguage: z.enum(["en", "pt-BR"]),
  persistMeetingAudio: z.boolean(),
  persistMeetingContent: z.boolean(),
});
export const guildParametersSchema = z.object({ guildId: z.string().min(1).max(128) });
export const profileParametersSchema = z.object({ profileId: z.string().min(1).max(256) });
export const profileBodySchema = z.discriminatedUnion("profileType", [
  externalAiProfileSchema.omit({ profileId: true, userId: true }),
  localAiProfileSchema.omit({ profileId: true, userId: true }),
]);

export interface ApiAuthService {
  authenticate(sessionToken: string): Promise<AuthenticatedUser>;
  create(discordUserId: string): Promise<string>;
  logout(sessionToken: string): Promise<void>;
}

export interface ApiSettingsStore {
  getSettings(): Promise<InstallationSettings>;
  removeSecret(name: InstallationSecretName): Promise<void>;
  setSecret(name: InstallationSecretName, value: string): Promise<void>;
  updatePreferences(input: {
    dashboardLanguage: "en" | "pt-BR";
    dashboardTheme: "system" | "light" | "dark";
  }): Promise<void>;
  updateSettings(input: z.input<typeof installationSettingsInputSchema>): Promise<void>;
}

export interface ApiDiscordService {
  completeAuthorization(code: string, state: string): Promise<{ discordUserId: string }>;
  createAuthorizationUrl(input: {
    initiatorDiscordUserId?: string;
    intent: "setup" | "login" | "replace" | "recovery";
  }): Promise<string>;
  getConnectionStatus(userId: string): Promise<DiscordConnectionStatus>;
  listOwnedGuilds(
    userId: string,
    installedGuildIds: ReadonlySet<string>,
  ): Promise<OwnedDiscordGuild[]>;
}

export interface GuildDirectory {
  getMembersByIds(
    guildId: string,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, GuildMemberDirectoryItem>>;
  getForums?(
    guildId: string,
  ): Promise<{ id: string; name: string; tags: { id: string; name: string }[] }[]>;
  getInstalledGuildIds(): Promise<ReadonlySet<string>>;
  getResources(guildId: string): Promise<{
    forums: { id: string; name: string; tags: { id: string; name: string }[] }[];
    memberCounts:
      | { status: "available" }
      | { code: "discord_members_intent_unavailable"; status: "unavailable" };
    roles: { id: string; memberCount: number | null; name: string }[];
  }>;
  getMemberDisplayNames?(
    guildId: string,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
  getMemberProfiles?(
    guildId: string,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, { avatarUrl: string | null; displayName: string }>>;
  listMembers(
    guildId: string,
    options: { page: number; pageSize: number; query?: string; roleId?: string },
  ): Promise<
    | { code: "discord_members_intent_unavailable"; status: "unavailable" }
    | {
        items: GuildMemberDirectoryItem[];
        page: number;
        pageSize: number;
        status: "available";
        total: number;
      }
  >;
}

export interface GuildMemberDirectoryItem {
  avatarUrl: string | null;
  displayName: string;
  joinedAt: string;
  roleIds: string[];
  userId: string;
}

export interface ApiAnalyticsStore {
  getGuildCallCount(guildId: string): Promise<number>;
  getDashboard(guildId: string, options: DashboardAnalyticsOptions): Promise<DashboardAnalytics>;
  getMeeting(guildId: string, meetingId: string): Promise<MeetingHistoryDetail | undefined>;
  listMeetings(guildId: string, filters: MeetingHistoryFilters): Promise<MeetingHistoryPage>;
  updateDisplayNames(guildId: string, names: ReadonlyMap<string, string>): Promise<void>;
  updateParticipantProfiles(
    guildId: string,
    profiles: ReadonlyMap<string, { avatarUrl: string | null; displayName: string }>,
  ): Promise<void>;
}

export interface ApiServerDependencies {
  analytics?: ApiAnalyticsStore;
  aiProfiles: AiProfileStore;
  auth: ApiAuthService;
  discord: ApiDiscordService;
  guildConfig: GuildConfigurationStore;
  guildDirectory: GuildDirectory;
  health: { getStatus(): Promise<InstallationHealthStatus> };
  logger: Logger;
  liveMeetings: { getForGuild(guildId: string): Promise<LiveMeetingState | null> };
  participants: Pick<PostgresParticipantDirectoryStore, "list">;
  secureCookies: boolean;
  settings: ApiSettingsStore;
  setupToken: string;
  timeZone?: string;
  tasks: {
    list(
      guildId: string,
      filters?: { completed?: boolean; meetingId?: string },
    ): Promise<DashboardTask[]>;
    setCompleted(
      guildId: string,
      taskId: string,
      completedByUserId: string,
      completed: boolean,
    ): Promise<void>;
  };
}
