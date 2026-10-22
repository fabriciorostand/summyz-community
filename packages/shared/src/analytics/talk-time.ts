export interface MeetingAttendee {
  displayName: string;
  userId: string;
}

export interface SpokenInterval {
  endedAtMs: number;
  startedAtMs: number;
  userId: string;
}

export interface ParticipantTalkTime extends MeetingAttendee {
  percentage: number;
  talkTimeMs: number;
}

export function calculateTalkTime(
  attendees: readonly MeetingAttendee[],
  intervals: readonly SpokenInterval[],
): ParticipantTalkTime[] {
  const intervalsByUser = groupValidIntervals(intervals);
  const durations = participantDurations(attendees, intervalsByUser);
  const totalTalkTimeMs = durations.reduce(
    (total, participant) => total + participant.talkTimeMs,
    0,
  );
  if (totalTalkTimeMs === 0) return zeroPercentages(durations);
  return distributePercentages(durations, totalTalkTimeMs);
}

function groupValidIntervals(intervals: readonly SpokenInterval[]): Map<string, SpokenInterval[]> {
  const intervalsByUser = new Map<string, SpokenInterval[]>();
  for (const interval of intervals) {
    requireValidInterval(interval);
    const current = intervalsByUser.get(interval.userId) ?? [];
    current.push(interval);
    intervalsByUser.set(interval.userId, current);
  }
  return intervalsByUser;
}

function requireValidInterval(interval: SpokenInterval): void {
  if (
    !Number.isFinite(interval.startedAtMs) ||
    !Number.isFinite(interval.endedAtMs) ||
    interval.startedAtMs < 0 ||
    interval.endedAtMs <= interval.startedAtMs
  ) {
    throw new Error("The spoken interval is invalid");
  }
}

function participantDurations(
  attendees: readonly MeetingAttendee[],
  intervalsByUser: ReadonlyMap<string, readonly SpokenInterval[]>,
) {
  return attendees.map((attendee, index) => ({
    ...attendee,
    index,
    talkTimeMs: unionDuration(intervalsByUser.get(attendee.userId) ?? []),
  }));
}

function zeroPercentages(
  durations: ReturnType<typeof participantDurations>,
): ParticipantTalkTime[] {
  return durations.map(({ index: _index, ...participant }) => ({
    ...participant,
    percentage: 0,
  }));
}

function distributePercentages(
  durations: ReturnType<typeof participantDurations>,
  totalTalkTimeMs: number,
): ParticipantTalkTime[] {
  const rounded = durations.map((participant) => {
    const exact = (participant.talkTimeMs / totalTalkTimeMs) * 100;
    return { ...participant, percentage: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let remaining = 100 - rounded.reduce((total, participant) => total + participant.percentage, 0);
  const remainderOrder = [...rounded].sort(
    (left, right) => right.remainder - left.remainder || left.index - right.index,
  );
  for (const participant of remainderOrder) {
    if (remaining === 0) break;
    participant.percentage += 1;
    remaining -= 1;
  }
  return rounded
    .sort((left, right) => left.index - right.index)
    .map(({ index: _index, remainder: _remainder, ...participant }) => participant);
}

function unionDuration(intervals: readonly SpokenInterval[]): number {
  const ordered = [...intervals].sort(
    (left, right) => left.startedAtMs - right.startedAtMs || left.endedAtMs - right.endedAtMs,
  );
  let total = 0;
  let currentStart: number | undefined;
  let currentEnd: number | undefined;
  for (const interval of ordered) {
    if (currentStart === undefined || currentEnd === undefined) {
      currentStart = interval.startedAtMs;
      currentEnd = interval.endedAtMs;
      continue;
    }
    if (interval.startedAtMs <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.endedAtMs);
      continue;
    }
    total += currentEnd - currentStart;
    currentStart = interval.startedAtMs;
    currentEnd = interval.endedAtMs;
  }
  return Math.round(
    total +
      (currentStart === undefined || currentEnd === undefined ? 0 : currentEnd - currentStart),
  );
}
