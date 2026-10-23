import { z } from "zod";

const guildConfigurationSchema = z.object({
  botLanguage: z.enum(["en", "pt-BR"]).default("en"),
  persistMeetingAudio: z.boolean().default(false),
  persistMeetingContent: z.boolean().default(true),
  summaryForum: z
    .object({
      forumId: z.string().min(1),
      tagId: z.string().min(1).optional(),
    })
    .optional(),
});

export type SummaryForumConfiguration = NonNullable<
  z.infer<typeof guildConfigurationSchema>["summaryForum"]
>;
export type GuildSettings = Pick<
  z.infer<typeof guildConfigurationSchema>,
  "botLanguage" | "persistMeetingAudio" | "persistMeetingContent"
>;

export const DEFAULT_GUILD_SETTINGS: GuildSettings = {
  botLanguage: "en",
  persistMeetingAudio: false,
  persistMeetingContent: true,
};

export interface RecordingUserGrant {
  memberJoinedAt: string;
  userId: string;
}

export interface RecordingPermissions {
  roleIds: string[];
  userGrants: RecordingUserGrant[];
}

export interface GuildConfigurationStore {
  clearSummaryForum(guildId: string): Promise<void>;
  getRecordingPermissions(guildId: string): Promise<RecordingPermissions>;
  getSummaryForum(guildId: string): Promise<SummaryForumConfiguration | undefined>;
  getGuildSettings(guildId: string): Promise<GuildSettings>;
  removeRecordingUser(guildId: string, userId: string): Promise<void>;
  setRecordingPermissions(guildId: string, permissions: RecordingPermissions): Promise<void>;
  setSummaryForum(guildId: string, summaryForum: SummaryForumConfiguration): Promise<void>;
  setGuildSettings(guildId: string, settings: GuildSettings): Promise<void>;
}
