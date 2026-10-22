import { z } from "zod";

import { createMeetingHistorySummary } from "../analytics/meeting-history-summary.js";
import type {
  CostAnalytics,
  MeetingHistoryDetail,
  MeetingHistoryItem,
} from "./postgres-analytics-store.js";

const meetingDetailRowSchema = z.object({
  ai_profile_id: z.string().nullable(),
  ai_profile_name: z.string().nullable(),
  audio_retained: z.boolean(),
  publication_root_message_id: z.string().nullable(),
  publication_thread_id: z.string().nullable(),
});

type MeetingDetailRow = z.infer<typeof meetingDetailRowSchema>;

interface MeetingHistoryDetailInput {
  cost: CostAnalytics;
  guildId: string;
  meeting: MeetingHistoryItem;
  row: Record<string, unknown>;
}

export function createMeetingHistoryDetail(input: MeetingHistoryDetailInput): MeetingHistoryDetail {
  const technical = meetingDetailRowSchema.parse(input.row);
  return {
    ...input.meeting,
    aiProfile: toAiProfile(technical),
    audioRetained: technical.audio_retained,
    cost: input.cost,
    discordUrl: toDiscordUrl(input.guildId, technical),
    rawTranscript: parseNullableString(input.row.raw_transcript),
    summary: toSummary(input.row),
    transcript: parseNullableString(input.row.transcript),
  };
}

function toAiProfile(technical: MeetingDetailRow): MeetingHistoryDetail["aiProfile"] {
  if (technical.ai_profile_id === null || technical.ai_profile_name === null) return null;
  return { name: technical.ai_profile_name, profileId: technical.ai_profile_id };
}

function toDiscordUrl(guildId: string, technical: MeetingDetailRow): string | null {
  if (technical.publication_thread_id === null) return null;
  const threadUrl = `https://discord.com/channels/${guildId}/${technical.publication_thread_id}`;
  return appendMessageId(threadUrl, technical.publication_root_message_id);
}

function appendMessageId(threadUrl: string, messageId: string | null): string {
  return messageId === null ? threadUrl : `${threadUrl}/${messageId}`;
}

function parseNullableString(value: unknown): string | null {
  return z
    .string()
    .nullable()
    .parse(value ?? null);
}

function toSummary(row: Record<string, unknown>): MeetingHistoryDetail["summary"] {
  if (row.summary === null || row.summary === undefined) return null;
  return createMeetingHistorySummary(row.summary, row.meeting_manifest);
}
