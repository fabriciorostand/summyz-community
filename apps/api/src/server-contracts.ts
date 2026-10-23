import type { Logger } from "pino";
import { aiProfileInputSchema, calculateProfileType } from "summyz-community-shared/ai-profile";
import type { AiProfileStore } from "summyz-community-shared/database/postgres-ai-profile-store";
import type {
  CostDetail,
  CostDetailOptions,
  DashboardAnalytics,
  DashboardAnalyticsOptions,
  MeetingHistoryDetail,
  MeetingHistoryFilters,
  MeetingHistoryPage,
} from "summyz-community-shared/database/postgres-analytics-store";
import type { PostgresGuildConfigStore } from "summyz-community-shared/database/postgres-guild-config-store";
import type { PostgresGuildHistoryStore } from "summyz-community-shared/database/postgres-guild-history-store";
import type { GuildOwnerApprovalStore } from "summyz-community-shared/database/postgres-guild-owner-approval-store";
import type { InstallationHealthStatus } from "summyz-community-shared/database/postgres-installation-health-store";
import type {
  InstallationSecretName,
  InstallationSettings,
} from "summyz-community-shared/database/postgres-installation-settings-store";
import type { LiveMeetingState } from "summyz-community-shared/database/postgres-live-meeting-store";
import type { PostgresParticipantDirectoryStore } from "summyz-community-shared/database/postgres-participant-directory-store";
import type { DashboardTask } from "summyz-community-shared/database/postgres-task-store";
import type { InstallationDiscordConnection } from "summyz-community-shared/discord/installation-discord-connection";
import type { GuildConfigurationStore } from "summyz-community-shared/guild-config-store";
import type { LocalHardwareProfile } from "summyz-community-shared/local-ai/hardware-profile";
import type { LocalModelInventory } from "summyz-community-shared/models/local-model-inventory";
import type { ModelDownloadManager } from "summyz-community-shared/models/model-download-manager";
import { z } from "zod";
import { installationPasswordSchema } from "./auth/installation-password.js";
import type { ModelCatalogService } from "./models/model-catalog-service.js";
import type { ModelManagement } from "./models/model-management.js";

export const setupSchema = z.object({
  setupLanguage: z.enum(["en", "pt-BR"]),
  discordBotToken: z.string().min(1),
  discordClientSecret: z.string().min(1).optional(),
  installationPassword: installationPasswordSchema.optional(),
});
export const guildSettingsSchema = z.object({
  botLanguage: z.enum(["en", "pt-BR"]),
  persistMeetingAudio: z.boolean(),
  persistMeetingContent: z.boolean(),
});
export const guildParametersSchema = z.object({ guildId: z.string().min(1).max(128) });
export const profileParametersSchema = z.object({ profileId: z.string().min(1).max(256) });
export const profileBodySchema = aiProfileInputSchema
  .omit({ profileId: true })
  .superRefine((profile, context) => {
    for (const phase of ["transcription", "refinement", "summary"] as const) {
      for (const field of ["provider", "model"] as const) {
        if (profile[phase][field] === null)
          context.addIssue({
            code: "custom",
            path: [phase, field],
            message: "A selection is required",
          });
      }
    }
  })
  .transform((profile) => ({ ...profile, profileType: calculateProfileType(profile) }));

export interface ApiAuthService {
  authenticate(sessionToken: string): Promise<void>;
  create(): Promise<string>;
  logout(sessionToken: string): Promise<void>;
}

export interface ApiPasswordService {
  authenticate(password: string): Promise<void>;
  change(currentPassword: string, newPassword: string): Promise<void>;
  initialize(password: string): Promise<void>;
  isConfigured(): Promise<boolean>;
}

export interface ApiRecoveryService {
  recover(token: string, password: string): Promise<void>;
}

export interface ApiSettingsStore {
  completeSetup(): Promise<void>;
  configureDiscordBot(applicationId: string, token: string): Promise<void>;
  rotateDiscordBot(
    applicationId: string,
    token: string,
  ): Promise<"unchanged" | "rotated" | "replaced">;
  getSettings(): Promise<InstallationSettings>;
  removeSecret(name: InstallationSecretName): Promise<void>;
  setSecret(name: InstallationSecretName, value: string): Promise<void>;
}

export interface InstalledDiscordGuild {
  iconUrl: string | null;
  id: string;
  name: string;
}

export interface OwnedDiscordGuild extends InstalledDiscordGuild {
  installed: boolean;
}

export interface DiscordApplication {
  iconUrl: string | null;
  id: string;
  name: string;
}

export interface GuildDirectory {
  getForumsForGuilds?(
    guildIds: readonly string[],
  ): Promise<
    ReadonlyMap<string, { id: string; name: string; tags: { id: string; name: string }[] }[]>
  >;
  inspectBotToken(token: string): Promise<DiscordApplication>;
  listInstalledGuilds(): Promise<InstalledDiscordGuild[]>;
  getMembersByIds(
    guildId: string,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, GuildMemberDirectoryItem>>;
  getForums?(
    guildId: string,
  ): Promise<{ id: string; name: string; tags: { id: string; name: string }[] }[]>;
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
  getCostDetail(guildId: string, options: CostDetailOptions): Promise<CostDetail>;
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
  hardware?: {
    readHardware(): Promise<LocalHardwareProfile>;
  };
  models?: {
    catalog: Pick<ModelCatalogService, "list" | "validateProfile">;
    inventory: Pick<LocalModelInventory, "assess">;
    management: Pick<ModelManagement, "download" | "remove"> & {
      downloads: Pick<ModelDownloadManager, "cancel" | "store">;
    };
  };
  accessMode: "local" | "public";
  analytics?: ApiAnalyticsStore;
  aiProfiles: AiProfileStore;
  costReconciliation?: { reconcile(guildId: string): Promise<void> };
  auth: ApiAuthService;
  discordConnection: Pick<
    InstallationDiscordConnection,
    | "cancelAuthorization"
    | "completeAuthorization"
    | "createAuthorizationUrl"
    | "getConnectedUserId"
    | "getConnectionProfile"
    | "getConnectionStatus"
    | "listOwnedGuilds"
  >;
  guildConfig: GuildConfigurationStore & Pick<PostgresGuildConfigStore, "getGuildSummaries">;
  guildDirectory: GuildDirectory;
  guildHistory: Pick<PostgresGuildHistoryStore, "hasMeetings" | "list">;
  guildOwnerApprovals: GuildOwnerApprovalStore;
  health: { getStatus(): Promise<InstallationHealthStatus> };
  logger: Logger;
  liveMeetings: { getForGuild(guildId: string): Promise<LiveMeetingState | null> };
  participants: Pick<PostgresParticipantDirectoryStore, "list">;
  passwords: ApiPasswordService;
  publicBaseUrl: string;
  recovery: ApiRecoveryService;
  settings: ApiSettingsStore;
  setupToken: string;
  tasks: {
    list(
      guildId: string,
      filters?: { completed?: boolean; meetingId?: string },
    ): Promise<DashboardTask[]>;
    setCompleted(
      guildId: string,
      taskId: string,
      completedByUserId: string | null,
      completed: boolean,
    ): Promise<void>;
  };
}
