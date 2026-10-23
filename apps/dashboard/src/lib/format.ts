import type { Messages } from "../i18n/messages/pt-BR";

/* Language-neutral helpers; dates, numbers and lists go through the i18n formatter instead. */

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

export function pipelineStatus(
  status: string,
  labels: Messages["pipeline"],
): { label: string; tone: StatusTone } {
  if (status === "completed") return { label: labels.completed, tone: "ok" };
  if (status === "failed") return { label: labels.failed, tone: "fail" };
  return { label: labels.inProgress, tone: "live" };
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
  if (words.length === 1) return (words[0] ?? "").slice(0, 2).toLocaleUpperCase();
  return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toLocaleUpperCase();
}
