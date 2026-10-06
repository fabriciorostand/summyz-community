import { z } from "zod";

export interface CostRange {
  dateFrom: string;
  dateTo: string;
}

const calendarDate = z.iso.date();

/** The calendar date of an instant in a zone, as `YYYY-MM-DD`. */
function calendarDateIn(instant: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return `${String(parts.year)}-${String(parts.month)}-${String(parts.day)}`;
}

/** From the first of the current month to today, as the viewer's calendar sees it. */
export function currentMonthRange(now: Date, timeZone: string): CostRange {
  const today = calendarDateIn(now, timeZone);
  return { dateFrom: `${today.slice(0, 8)}01`, dateTo: today };
}

/**
 * The range kept in the address, so it survives a visit to a meeting and back. Missing or
 * malformed dates fall back as a pair; a reversed range is kept for the page to explain.
 */
export function costRange(parameters: URLSearchParams, fallback: CostRange): CostRange {
  const dateFrom = calendarDate.safeParse(parameters.get("from"));
  const dateTo = calendarDate.safeParse(parameters.get("to"));
  if (!dateFrom.success || !dateTo.success) return fallback;
  return { dateFrom: dateFrom.data, dateTo: dateTo.data };
}

/** Sum of confirmed amounts as a number; only proportions use it, never the displayed totals. */
export function confirmedAmount(entries: readonly { amount: string; currency: string }[]): number {
  return entries.reduce((sum, entry) => {
    const amount = Number(entry.amount);
    return Number.isFinite(amount) ? sum + amount : sum;
  }, 0);
}
