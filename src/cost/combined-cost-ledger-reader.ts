import type { CostLedgerStore, CostMeetingRange, CostMeetingWithAttempts } from "./cost-ledger.js";

type CostLedgerReader = Pick<CostLedgerStore, "getMeeting" | "listMeetings">;

export class CombinedCostLedgerReader implements CostLedgerReader {
  readonly #readers: readonly CostLedgerReader[];

  public constructor(readers: readonly CostLedgerReader[]) {
    this.#readers = readers;
  }

  public async getMeeting(
    guildId: string,
    meetingId: string,
  ): Promise<CostMeetingWithAttempts | undefined> {
    for (const reader of this.#readers) {
      const meeting = await reader.getMeeting(guildId, meetingId);
      if (meeting !== undefined) return meeting;
    }
    return undefined;
  }

  public async listMeetings(
    guildId: string,
    range: CostMeetingRange,
  ): Promise<CostMeetingWithAttempts[]> {
    const results = await Promise.all(
      this.#readers.map((reader) => reader.listMeetings(guildId, range)),
    );
    const meetings = new Map<string, CostMeetingWithAttempts>();
    for (const meeting of results.flat()) {
      const existing = meetings.get(meeting.meeting.meetingId);
      if (existing === undefined) {
        meetings.set(meeting.meeting.meetingId, meeting);
      } else {
        const attempts = new Map(
          [...existing.attempts, ...meeting.attempts].map((attempt) => [
            attempt.attemptId,
            attempt,
          ]),
        );
        meetings.set(meeting.meeting.meetingId, { ...existing, attempts: [...attempts.values()] });
      }
    }
    return [...meetings.values()].sort((left, right) =>
      left.meeting.startedAt.localeCompare(right.meeting.startedAt),
    );
  }
}
