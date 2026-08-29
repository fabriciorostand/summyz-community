import { z } from "zod";

const guildConfigurationSchema = z.object({
  botLanguage: z.enum(["en", "pt-BR"]).default("en"),
  persistMeetingAudio: z.boolean().default(false),
  persistMeetingContent: z.boolean().default(true),
  recordingRoleIds: z.array(z.string()).default([]),
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

export interface GuildConfigurationStore {
  addRecordingRole(guildId: string, roleId: string): Promise<void>;
  clearSummaryForum(guildId: string): Promise<void>;
  getSummaryForum(guildId: string): Promise<SummaryForumConfiguration | undefined>;
  getGuildSettings(guildId: string): Promise<GuildSettings>;
  listRecordingRoles(guildId: string): Promise<string[]>;
  removeRecordingRole(guildId: string, roleId: string): Promise<void>;
  setSummaryForum(guildId: string, summaryForum: SummaryForumConfiguration): Promise<void>;
  setGuildSettings(guildId: string, settings: GuildSettings): Promise<void>;
}
