import { z } from "zod";

const accessModeSchema = z.enum(["local", "public"]);
const dashboardLanguageSchema = z.enum(["en", "pt-BR"]);
const dashboardThemeSchema = z.enum(["system", "light", "dark"]);

export const accessStatusSchema = z.object({
  accessMode: accessModeSchema,
  authenticated: z.boolean(),
  passwordConfigured: z.boolean(),
  setupCompleted: z.boolean(),
});
export const setupStatusSchema = z.object({
  accessMode: accessModeSchema,
  passwordConfigured: z.boolean(),
  setupCompleted: z.boolean(),
  technicalSetupCompleted: z.boolean(),
});
export const dashboardSettingsSchema = z.object({
  accessMode: accessModeSchema,
  dashboardLanguage: dashboardLanguageSchema,
  dashboardTheme: dashboardThemeSchema,
  discordApplicationId: z.string().nullable(),
  secrets: z.object({
    discordBotToken: z.boolean(),
    openRouterApiKey: z.boolean(),
  }),
});
export const botInstallationSchema = z.discriminatedUnion("configured", [
  z.object({ configured: z.literal(false) }),
  z.object({
    applicationId: z.string(),
    configured: z.literal(true),
    installUrl: z.url(),
  }),
]);
export const guildSchema = z.object({
  activeProfile: z
    .object({
      name: z.string(),
      profileId: z.string(),
      profileType: z.enum(["external", "local"]),
    })
    .nullable()
    .optional(),
  callCount: z.number().int().nullable().optional(),
  iconUrl: z.url().nullable(),
  id: z.string(),
  name: z.string(),
  summaryForum: z
    .object({
      forumId: z.string(),
      name: z.string(),
      tagId: z.string().optional(),
      tagName: z.string().optional(),
    })
    .nullable()
    .optional(),
});
const generationSchema = z.object({
  seed: z.number().int().optional(),
  temperature: z.number().optional(),
  think: z.boolean().optional(),
});
const promptSchema = z.string().nullable();
export const promptDefaultsSchema = z.object({
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
const profileLanguages = [
  ...(["auto", "ar", "cs", "da", "de", "el", "en", "en-GB", "en-US", "es"] as const),
  ...(["es-ES", "es-MX", "fi", "fr", "fr-CA", "he", "hi", "hu", "id", "it"] as const),
  ...(["ja", "ko", "nl", "no", "pl", "pt", "pt-BR", "pt-PT", "ro", "ru"] as const),
  ...(["sv", "th", "tr", "uk", "vi", "zh", "zh-CN", "zh-TW"] as const),
] as const;
const profileBaseShape = {
  language: z.enum(profileLanguages),
  name: z.string(),
  profileId: z.string(),
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
  language: z.enum(profileLanguages),
  mergeMaxGapMs: z.number().int(),
  model: z.string().nullable(),
  prompt: promptSchema,
  providerOptions: z.record(z.string(), z.record(z.string(), z.json())).optional(),
  temperature: z.number().optional(),
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
  }),
]);
export const guildConfigurationSchema = z.object({
  activeProfileId: z.string().nullable(),
  profiles: z.array(profileSchema),
  recordingRoleIds: z.array(z.string()),
  recordingUserIds: z.array(z.string()),
  settings: z.object({
    botLanguage: z.enum(["en", "pt-BR"]),
    persistMeetingAudio: z.boolean(),
    persistMeetingContent: z.boolean(),
  }),
  summaryForum: z.object({ forumId: z.string(), tagId: z.string().optional() }).optional(),
});
export const resourcesSchema = z.object({
  forums: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      tags: z.array(z.object({ id: z.string(), name: z.string() })),
    }),
  ),
  memberCounts: z
    .discriminatedUnion("status", [
      z.object({ status: z.literal("available") }),
      z.object({
        code: z.literal("discord_members_intent_unavailable"),
        status: z.literal("unavailable"),
      }),
    ])
    .optional(),
  roles: z.array(
    z.object({
      id: z.string(),
      memberCount: z.number().int().nullable().optional(),
      name: z.string(),
    }),
  ),
});
const guildMemberSchema = z.object({
  avatarUrl: z.url().nullable(),
  displayName: z.string(),
  joinedAt: z.iso.datetime(),
  roleIds: z.array(z.string()),
  userId: z.string(),
});
export const guildMemberPageSchema = z.discriminatedUnion("status", [
  z.object({
    code: z.literal("discord_members_intent_unavailable"),
    status: z.literal("unavailable"),
  }),
  z.object({
    items: z.array(guildMemberSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    status: z.literal("available"),
    total: z.number().int(),
  }),
]);
export const historicalParticipantPageSchema = z.object({
  items: z.array(
    z.object({
      avatarUrl: z.url().nullable(),
      displayName: z.string(),
      userId: z.string(),
    }),
  ),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export const installationHealthSchema = z.object({
  checkedAt: z.iso.datetime(),
  components: z.array(
    z.object({
      componentId: z.string(),
      componentType: z.enum([
        "bot",
        "database",
        "ffmpeg",
        "worker",
        "queue",
        "ollama",
        "faster_whisper",
        "openrouter",
      ]),
      details: z.record(z.string(), z.json()),
      heartbeatAt: z.iso.datetime().nullable(),
      stale: z.boolean(),
      status: z.enum(["ready", "degraded", "unavailable", "not_configured"]),
    }),
  ),
  database: z.object({
    status: z.literal("ready"),
  }),
  externalConfiguration: z.object({
    openRouterConfigured: z.boolean(),
  }),
  localAiRequired: z.boolean(),
  queue: z.object({
    active: z.number().int(),
    failed: z.number().int(),
    oldestPendingAt: z.iso.datetime().nullable(),
    scheduled: z.number().int(),
  }),
});
const analyticsParticipantSchema = z.object({
  avatarUrl: z.url().nullable().default(null),
  displayName: z.string(),
  percentage: z.number().int().nullable(),
  talkTimeMs: z.number().int().nullable(),
  userId: z.string(),
});
const meetingHistoryItemSchema = z.object({
  aiProfile: z.object({ name: z.string(), profileId: z.string() }).nullable(),
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
const costAttemptCountsSchema = z.object({
  confirmed: z.number().int(),
  notApplicable: z.number().int(),
  pending: z.number().int(),
  unattributed: z.number().int(),
});
const costAnalyticsSchema = z.object({
  attemptCounts: costAttemptCountsSchema,
  breakdown: z.array(
    z.object({
      attemptCounts: costAttemptCountsSchema,
      confirmed: z.array(z.object({ amount: z.string(), currency: z.string().length(3) })),
      execution: z.enum(["api", "local"]),
      phase: z.enum(["transcription", "refinement", "summary"]),
      provider: z.string(),
    }),
  ),
  confirmed: z.array(z.object({ amount: z.string(), currency: z.string().length(3) })),
});
export const dashboardAnalyticsSchema = z.object({
  averageDurationMs: z.number().int(),
  liveMeeting: z
    .object({
      guildId: z.string(),
      aiProfile: z.object({ name: z.string(), profileId: z.string() }).nullable(),
      meetingId: z.string(),
      participants: z.array(
        z.object({ avatarUrl: z.url().nullable(), displayName: z.string(), userId: z.string() }),
      ),
      speakingUserIds: z.array(z.string()),
      startedAt: z.iso.datetime(),
      updatedAt: z.iso.datetime(),
      voiceChannelId: z.string(),
      voiceChannelName: z.string().nullable(),
    })
    .nullable()
    .optional(),
  calls: z
    .object({
      current: z.number().int(),
      deltaPercentage: z.number().int().nullable(),
      previous: z.number().int().nullable(),
    })
    .default({ current: 0, deltaPercentage: null, previous: null }),
  cost: costAnalyticsSchema.default({
    attemptCounts: { confirmed: 0, notApplicable: 0, pending: 0, unattributed: 0 },
    breakdown: [],
    confirmed: [],
  }),
  openTaskCount: z.number().int().default(0),
  period: z.enum(["30d", "90d", "all"]).default("30d"),
  statusSeries: z
    .array(
      z.object({
        bucketStart: z.iso.date(),
        completed: z.number().int(),
        failed: z.number().int(),
      }),
    )
    .default([]),
  timeZone: z.string(),
  topSpeakers: z.array(
    z.object({
      avatarUrl: z.url().nullable().default(null),
      displayName: z.string(),
      talkTimeMs: z.number().int(),
      userId: z.string(),
    }),
  ),
  totalCalls: z.number().int(),
  totalDurationMs: z.number().int(),
});
export const meetingHistoryPageSchema = z.object({
  items: z.array(meetingHistoryItemSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  timeZone: z.string(),
  total: z.number().int(),
});
const meetingHistorySummaryTaskSchema = z.object({
  deadlineDate: z.iso.date().optional(),
  deadlinePrecision: z.enum(["date", "minute"]).optional(),
  deadlineText: z.string().optional(),
  deadlineTime: z.string().optional(),
  deadlineTimeZone: z.string().optional(),
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
    // Present only when no generation attempt confirmed the requested language.
    languageWarning: z
      .object({
        detectedLanguage: z.string().min(1).optional(),
        requestedLanguage: z.string().min(1),
      })
      .optional(),
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
export const meetingHistoryDetailSchema = meetingHistoryItemSchema.extend({
  audioRetained: z.boolean().default(false),
  cost: costAnalyticsSchema.default({
    attemptCounts: { confirmed: 0, notApplicable: 0, pending: 0, unattributed: 0 },
    breakdown: [],
    confirmed: [],
  }),
  discordUrl: z.url().nullable().default(null),
  rawTranscript: z.string().nullable(),
  summary: meetingHistorySummarySchema.nullable(),
  timeZone: z.string(),
  transcript: z.string().nullable(),
});
export const dashboardTaskSchema = z.object({
  completedAt: z.iso.datetime().nullable(),
  completedByUserId: z.string().nullable(),
  deadlineDate: z.iso.date().nullable(),
  deadlinePrecision: z.enum(["date", "minute"]).nullable(),
  deadlineText: z.string().nullable(),
  deadlineTime: z.string().nullable(),
  deadlineTimeZone: z.string().nullable(),
  meetingId: z.string(),
  ownerAvatarUrl: z.url().nullable(),
  ownerDisplayName: z.string().nullable(),
  overdue: z.boolean(),
  ownerName: z.string().nullable(),
  ownerUserId: z.string().nullable(),
  taskId: z.uuid(),
  text: z.string(),
  voiceChannelName: z.string().nullable(),
});

/** Slash-command reference the bot registers, grouped and localized by the backend. */
export const commandReferenceSchema = z
  .array(
    z.object({
      commands: z.array(z.object({ description: z.string(), name: z.string() })).min(1),
      label: z.string(),
    }),
  )
  .min(1);

export type AccessMode = z.infer<typeof accessModeSchema>;
export type AccessStatus = z.infer<typeof accessStatusSchema>;
export type SetupStatus = z.infer<typeof setupStatusSchema>;
export type DashboardSettings = z.infer<typeof dashboardSettingsSchema>;
export type BotInstallation = z.infer<typeof botInstallationSchema>;
export type Guild = z.infer<typeof guildSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type ProfileInput =
  | Omit<Extract<Profile, { profileType: "external" }>, "profileId">
  | Omit<Extract<Profile, { profileType: "local" }>, "profileId">;
export interface ProfileListItem {
  active: boolean;
  activeServerCount?: number | undefined;
  profile: Profile;
}
export type PromptDefaults = z.infer<typeof promptDefaultsSchema>;
export type GuildConfiguration = z.infer<typeof guildConfigurationSchema>;
export type GuildResources = z.infer<typeof resourcesSchema>;
export type GuildMemberPage = z.infer<typeof guildMemberPageSchema>;
export type HistoricalParticipantPage = z.infer<typeof historicalParticipantPageSchema>;
export type InstallationHealth = z.infer<typeof installationHealthSchema>;
export type DashboardAnalytics = z.infer<typeof dashboardAnalyticsSchema>;
export type MeetingHistoryPage = z.infer<typeof meetingHistoryPageSchema>;
export type MeetingHistoryDetail = z.infer<typeof meetingHistoryDetailSchema>;
export type MeetingHistorySummary = z.infer<typeof meetingHistorySummarySchema>;
export type DashboardTask = z.infer<typeof dashboardTaskSchema>;
export type CommandReference = z.infer<typeof commandReferenceSchema>;
