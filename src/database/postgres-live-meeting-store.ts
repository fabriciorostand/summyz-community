import { z } from "zod";

import type { PostgresExecutor } from "./postgres-database.js";

const identifierSchema = z.string().min(1).max(128);
export const liveMeetingParticipantSchema = z.object({
  avatarUrl: z.url().max(2_048).nullable(),
  displayName: z.string().trim().min(1).max(100),
  userId: identifierSchema,
});
export type LiveMeetingParticipant = z.infer<typeof liveMeetingParticipantSchema>;

const liveMeetingStateSchema = z.object({
  aiProfile: z.object({ name: z.string(), profileId: identifierSchema }).nullable(),
  guildId: identifierSchema,
  meetingId: identifierSchema,
  participants: z.array(liveMeetingParticipantSchema),
  speakingUserIds: z.array(identifierSchema),
  startedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  voiceChannelId: identifierSchema,
  voiceChannelName: z.string().nullable(),
});
export type LiveMeetingState = z.infer<typeof liveMeetingStateSchema>;

const liveMeetingRowSchema = z.object({
  ai_profile_id: z.string().nullable(),
  ai_profile_name: z.string().nullable(),
  guild_id: identifierSchema,
  meeting_id: identifierSchema,
  participants: z.array(liveMeetingParticipantSchema),
  speaking_user_ids: z.array(identifierSchema),
  started_at: z.coerce.date(),
  updated_at: z.coerce.date(),
  voice_channel_id: identifierSchema,
  voice_channel_name: z.string().nullable(),
});

export interface LiveMeetingStateInput {
  guildId: string;
  meetingId: string;
  participants: readonly LiveMeetingParticipant[];
  speakingUserIds: readonly string[];
  voiceChannelId: string;
}

export interface LiveMeetingStateWriter {
  clear(meetingId: string): Promise<void>;
  save(state: LiveMeetingStateInput): Promise<void>;
}

export class PostgresLiveMeetingStore implements LiveMeetingStateWriter {
  readonly #database: PostgresExecutor;
  readonly #now: () => Date;

  public constructor(database: PostgresExecutor, now: () => Date = () => new Date()) {
    this.#database = database;
    this.#now = now;
  }

  public async save(input: LiveMeetingStateInput): Promise<void> {
    const participants = z.array(liveMeetingParticipantSchema).parse(input.participants);
    const participantIds = new Set(participants.map((participant) => participant.userId));
    const speakingUserIds = z
      .array(identifierSchema)
      .parse([...new Set(input.speakingUserIds)])
      .filter((userId) => participantIds.has(userId));
    await this.#database.query(
      `INSERT INTO live_meeting_states (
         meeting_id, guild_id, voice_channel_id, participants, speaking_user_ids, expires_at
       ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
       ON CONFLICT (meeting_id) DO UPDATE SET
         participants = EXCLUDED.participants,
         speaking_user_ids = EXCLUDED.speaking_user_ids,
         expires_at = EXCLUDED.expires_at,
         updated_at = now()`,
      [
        identifierSchema.parse(input.meetingId),
        identifierSchema.parse(input.guildId),
        identifierSchema.parse(input.voiceChannelId),
        JSON.stringify(participants),
        JSON.stringify(speakingUserIds),
        new Date(this.#now().getTime() + 45_000).toISOString(),
      ],
    );
  }

  public async getForGuild(guildId: string): Promise<LiveMeetingState | null> {
    const result = await this.#database.query(
      `SELECT state.meeting_id, state.guild_id, state.voice_channel_id, state.participants,
              state.speaking_user_ids, state.updated_at, meeting.started_at,
              meeting.voice_channel_name, meeting.ai_profile_id, meeting.ai_profile_name
       FROM live_meeting_states state
       JOIN meetings meeting
         ON meeting.meeting_id = state.meeting_id AND meeting.guild_id = state.guild_id
       WHERE state.guild_id = $1 AND state.expires_at > now()
       ORDER BY state.updated_at DESC LIMIT 1`,
      [identifierSchema.parse(guildId)],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    const parsed = liveMeetingRowSchema.parse(row);
    return liveMeetingStateSchema.parse({
      aiProfile:
        parsed.ai_profile_id === null || parsed.ai_profile_name === null
          ? null
          : { name: parsed.ai_profile_name, profileId: parsed.ai_profile_id },
      guildId: parsed.guild_id,
      meetingId: parsed.meeting_id,
      participants: parsed.participants,
      speakingUserIds: parsed.speaking_user_ids,
      startedAt: parsed.started_at.toISOString(),
      updatedAt: parsed.updated_at.toISOString(),
      voiceChannelId: parsed.voice_channel_id,
      voiceChannelName: parsed.voice_channel_name,
    });
  }

  public async clear(meetingId: string): Promise<void> {
    await this.#database.query("DELETE FROM live_meeting_states WHERE meeting_id = $1", [
      identifierSchema.parse(meetingId),
    ]);
  }
}
