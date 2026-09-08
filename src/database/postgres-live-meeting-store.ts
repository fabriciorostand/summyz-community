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
  guildId: identifierSchema,
  meetingId: identifierSchema,
  participants: z.array(liveMeetingParticipantSchema),
  speakingUserIds: z.array(identifierSchema),
  updatedAt: z.iso.datetime(),
  voiceChannelId: identifierSchema,
});
export type LiveMeetingState = z.infer<typeof liveMeetingStateSchema>;

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
      `SELECT meeting_id, guild_id, voice_channel_id, participants, speaking_user_ids, updated_at
       FROM live_meeting_states
       WHERE guild_id = $1 AND expires_at > now()
       ORDER BY updated_at DESC LIMIT 1`,
      [identifierSchema.parse(guildId)],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return liveMeetingStateSchema.parse({
      guildId: row.guild_id,
      meetingId: row.meeting_id,
      participants: row.participants,
      speakingUserIds: row.speaking_user_ids,
      updatedAt: new Date(z.union([z.string(), z.date()]).parse(row.updated_at)).toISOString(),
      voiceChannelId: row.voice_channel_id,
    });
  }

  public async clear(meetingId: string): Promise<void> {
    await this.#database.query("DELETE FROM live_meeting_states WHERE meeting_id = $1", [
      identifierSchema.parse(meetingId),
    ]);
  }
}
