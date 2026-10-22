import type { DateFormat, Language, TimeFormat } from "./preferences";

export interface FormatSettings {
  dateFormat: DateFormat;
  language: Language;
  timeFormat: TimeFormat;
}

export interface DeadlineParts {
  deadlineDate: string | null;
  deadlinePrecision: "date" | "minute" | null;
  deadlineTime: string | null;
}

type CostEntry = { amount: string; currency: string };

export type Formatter = ReturnType<typeof createFormatter>;

interface CalendarParts {
  day: string;
  hour: number;
  minute: number;
  month: string;
  year: string;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Reads the calendar fields of an instant in a zone, always with Latin digits. */
function calendarParts(value: string, timeZone: string): CalendarParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    numberingSystem: "latn",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return {
    day: part("day"),
    hour: Number(part("hour")),
    minute: Number(part("minute")),
    month: part("month"),
    year: part("year"),
  };
}

/**
 * Every date, time, number and list on screen goes through here, so the dashboard language
 * decides the words and separators while the chosen formats decide the calendar and the clock.
 */
export function createFormatter({ dateFormat, language, timeFormat }: FormatSettings) {
  const numbers = (fractionDigits: number) =>
    new Intl.NumberFormat(language, {
      maximumFractionDigits: fractionDigits,
      minimumFractionDigits: fractionDigits,
    });
  const oneDecimal = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  const listFormat = new Intl.ListFormat(language);
  const languageNames = new Intl.DisplayNames([language], { type: "language" });

  function clock(hour: number, minute: number): string {
    if (timeFormat === "24h") return `${pad(hour)}:${pad(minute)}`;
    return `${String(hour % 12 === 0 ? 12 : hour % 12)}:${pad(minute)} ${hour < 12 ? "AM" : "PM"}`;
  }

  function dayMonthOf(day: string, month: string): string {
    if (dateFormat === "YYYY-MM-DD") return `${month}-${day}`;
    return dateFormat === "MM/DD/YYYY" ? `${month}/${day}` : `${day}/${month}`;
  }

  function calendarDayMonth(calendarDate: string): string {
    const [, month = "", day = ""] = calendarDate.split("-");
    return dayMonthOf(day, month);
  }

  function fullDateOf({ day, month, year }: CalendarParts): string {
    if (dateFormat === "YYYY-MM-DD") return `${year}-${month}-${day}`;
    return dateFormat === "MM/DD/YYYY" ? `${month}/${day}/${year}` : `${day}/${month}/${year}`;
  }

  function costs(
    entries: readonly CostEntry[],
    formatAmount: (amount: number, currency: string) => string,
  ): string {
    if (entries.length === 0) return "—";
    return entries
      .map((entry) => {
        const amount = Number(entry.amount);
        if (!Number.isFinite(amount)) return `${entry.currency} ${entry.amount}`;
        return formatAmount(amount, entry.currency);
      })
      .join(" · ");
  }

  return {
    bytes(value: number): string {
      if (value >= 1e9)
        return `${oneDecimal.format(value >= 1e11 ? Math.round(value / 1e9) : value / 1e9)} GB`;
      return `${oneDecimal.format(Math.round(value / 1e6))} MB`;
    },
    /** Joins every confirmed currency with its code first; only the separators follow the language. */
    cost(entries: readonly CostEntry[]): string {
      const precise = new Intl.NumberFormat(language, { maximumFractionDigits: 6 });
      return costs(entries, (amount, currency) => `${currency} ${precise.format(amount)}`);
    },
    /** Full date with the year, followed by the time. */
    dateTime(value: string | null, timeZone: string): string {
      if (value === null) return "—";
      const parts = calendarParts(value, timeZone);
      return `${fullDateOf(parts)} ${clock(parts.hour, parts.minute)}`;
    },
    /** A `YYYY-MM-DD` calendar date shown as day and month, without any time zone shift. */
    dayMonth: calendarDayMonth,
    /**
     * Deadlines are calendar dates, so the weekday comes from the date itself. The time is the
     * wall-clock time that was said, shown in the chosen clock.
     */
    deadline(parts: DeadlineParts): string | null {
      if (parts.deadlineDate === null) return null;
      const weekday = new Intl.DateTimeFormat(language, { timeZone: "UTC", weekday: "short" })
        .format(new Date(`${parts.deadlineDate}T12:00:00.000Z`))
        .replace(".", "")
        .slice(0, 3)
        .toLocaleUpperCase(language);
      const base = `${weekday} ${calendarDayMonth(parts.deadlineDate)}`;
      if (parts.deadlinePrecision !== "minute" || parts.deadlineTime === null) return base;
      const [hour = "0", minute = "0"] = parts.deadlineTime.split(":");
      return `${base} ${clock(Number(hour), Number(minute))}`;
    },
    /** Shows only the decimals a value actually has, up to two. */
    decimal(value: number): string {
      return new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(value);
    },
    languageName(code: string): string {
      const name = languageNames.of(code) ?? code;
      return name.charAt(0).toLocaleUpperCase(language) + name.slice(1);
    },
    list(items: readonly string[]): string {
      return listFormat.format(items);
    },
    number(value: number, fractionDigits = 0): string {
      return numbers(fractionDigits).format(value);
    },
    /** Two decimals, flagging positive amounts that would otherwise round down to zero. */
    roundedCost(entries: readonly CostEntry[]): string {
      const cents = numbers(2);
      return costs(entries, (amount, currency) =>
        amount > 0 && amount < 0.005
          ? `< ${currency} ${cents.format(0.01)}`
          : `${currency} ${cents.format(amount)}`,
      );
    },
    /** Day and month without the year, followed by the time, for dense lists. */
    shortDateTime(value: string | null, timeZone: string): string {
      if (value === null) return "—";
      const parts = calendarParts(value, timeZone);
      return `${dayMonthOf(parts.day, parts.month)} ${clock(parts.hour, parts.minute)}`;
    },
    time(value: string, timeZone: string): string {
      const parts = calendarParts(value, timeZone);
      return clock(parts.hour, parts.minute);
    },
  };
}
