import type { DashboardAnalytics } from "./api";

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 60_000) return `${String(Math.floor(milliseconds / 1_000))}s`;
  const totalMinutes = Math.floor(milliseconds / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${String(minutes)}m`;
  return `${String(hours)}h ${String(minutes).padStart(2, "0")}m`;
}

export function formatCosts(costs: DashboardAnalytics["confirmedCost"]): string {
  if (costs.length === 0) return "—";
  return costs
    .map(
      (cost) =>
        `${cost.currency} ${cost.amount.toLocaleString("pt-BR", { maximumFractionDigits: 6 })}`,
    )
    .join(" · ");
}

export function formatDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

export function formatStatusLabel(status: string): string {
  if (status === "completed") return "Concluída";
  if (status === "failed") return "Falhou";
  return "Em andamento";
}

export function formatStatusClass(status: string): string {
  return status === "completed" ? "completed" : status === "failed" ? "failed" : "progress";
}
