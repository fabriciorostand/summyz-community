import type {
  SummaryDraft,
  SummaryTranscriptEntry,
} from "summyz-community-shared/summary/summary-result";
import { z } from "zod";

interface CalendarReference {
  referenceDate: string;
  timeZone: string;
  sourceEntryIds: string[];
  dates: { date: string; weekday: string }[];
}

/** Supplies calendar facts; interpreting a stated deadline remains the model's responsibility. */
export function createSummaryInput(
  entries: readonly SummaryTranscriptEntry[],
  partialSummaries?: readonly SummaryDraft[],
): {
  transcriptEntries: readonly SummaryTranscriptEntry[];
  partialSummaries?: readonly SummaryDraft[];
  calendarReferences?: CalendarReference[];
} {
  const calendars = new Map<string, CalendarReference>();
  for (const entry of entries) {
    if (entry.spokenAt === undefined) continue;
    const { instant, timeZone } = entry.spokenAt;
    const parts = new Intl.DateTimeFormat("en", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(instant));
    const values = new Map(parts.map(({ type, value }) => [type, value]));
    const referenceDate = z.iso
      .date()
      .parse([values.get("year"), values.get("month"), values.get("day")].join("-"));
    const key = JSON.stringify([referenceDate, timeZone]);
    const existing = calendars.get(key);
    if (existing !== undefined) {
      existing.sourceEntryIds.push(entry.id);
      continue;
    }
    calendars.set(key, {
      referenceDate,
      timeZone,
      sourceEntryIds: [entry.id],
      dates: calendarDates(referenceDate),
    });
  }
  return {
    transcriptEntries: entries,
    ...(partialSummaries === undefined ? {} : { partialSummaries }),
    ...(calendars.size === 0 ? {} : { calendarReferences: [...calendars.values()] }),
  };
}

function calendarDates(referenceDate: string): CalendarReference["dates"] {
  const firstDay = new Date(`${referenceDate}T00:00:00.000Z`).getTime();
  const weekday = new Intl.DateTimeFormat("en", { weekday: "long", timeZone: "UTC" });
  // UTC calendar arithmetic avoids shifting local dates at daylight-saving transitions.
  return Array.from({ length: 14 }, (_, offset) => {
    const date = new Date(firstDay + offset * 86_400_000);
    return { date: date.toISOString().slice(0, 10), weekday: weekday.format(date) };
  });
}
