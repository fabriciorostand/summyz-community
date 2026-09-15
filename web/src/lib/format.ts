const locale = "pt-BR";

export type StatusTone = "ok" | "fail" | "live";

/** Human-readable duration used across cards and lists. */
export function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return "—";
  if (milliseconds < 60_000) return `${String(Math.floor(milliseconds / 1_000))}s`;
  const totalMinutes = Math.floor(milliseconds / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${String(minutes)}m`;
  return `${String(hours)}h ${String(minutes).padStart(2, "0")}m`;
}

/** Running clock for the live meeting card. */
export function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const tail = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours === 0 ? tail : `${String(hours)}:${tail}`;
}

export function formatCost(entries: readonly { amount: string; currency: string }[]): string {
  if (entries.length === 0) return "—";
  return entries
    .map((entry) => {
      const amount = Number(entry.amount);
      if (!Number.isFinite(amount)) return `${entry.currency} ${entry.amount}`;
      return `${entry.currency} ${amount.toLocaleString(locale, { maximumFractionDigits: 6 })}`;
    })
    .join(" · ");
}

/**
 * Overview variant of {@link formatCost}: two decimals, flagging positive amounts that would
 * otherwise round down to zero.
 */
export function formatRoundedCost(
  entries: readonly { amount: string; currency: string }[],
): string {
  if (entries.length === 0) return "—";
  return entries
    .map((entry) => {
      const amount = Number(entry.amount);
      if (!Number.isFinite(amount)) return `${entry.currency} ${entry.amount}`;
      const rounded = amount.toLocaleString(locale, {
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      });
      if (amount > 0 && rounded === "0,00") return `< ${entry.currency} 0,01`;
      return `${entry.currency} ${rounded}`;
    })
    .join(" · ");
}

export function formatDate(value: string | null, timeZone: string): string {
  if (value === null) return "—";
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
  })
    .format(new Date(value))
    .replace(", ", " ");
}

export function formatShortDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    timeZone,
  }).format(new Date(`${value}T12:00:00.000Z`));
}

export interface DeadlineParts {
  deadlineDate: string | null;
  deadlinePrecision: "date" | "minute" | null;
  deadlineTime: string | null;
}

export function formatDeadline(parts: DeadlineParts, timeZone: string): string {
  if (parts.deadlineDate === null) return "sem prazo";
  const instant = new Date(`${parts.deadlineDate}T12:00:00.000Z`);
  const weekday = new Intl.DateTimeFormat(locale, { timeZone, weekday: "short" })
    .format(instant)
    .replace(".", "")
    .slice(0, 3)
    .toLocaleUpperCase(locale);
  const day = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    timeZone,
  }).format(instant);
  const base = `${weekday} ${day}`;
  if (parts.deadlinePrecision !== "minute" || parts.deadlineTime === null) return base;
  return `${base} ${parts.deadlineTime.slice(0, 5)}`;
}

export function pipelineStatus(status: string): { label: string; tone: StatusTone } {
  if (status === "completed") return { label: "Concluída", tone: "ok" };
  if (status === "failed") return { label: "Falhou", tone: "fail" };
  return { label: "Em andamento", tone: "live" };
}

export function percentageOf(value: number, maximum: number): number {
  if (maximum <= 0) return 0;
  return Math.round((value / maximum) * 100);
}

export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) return "?";
  if (words.length === 1) return (words[0] ?? "").slice(0, 2).toLocaleUpperCase(locale);
  return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toLocaleUpperCase(locale);
}

export function formatInteger(value: number, fractionDigits = 0): string {
  return value.toLocaleString(locale, {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  });
}
