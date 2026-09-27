import type { ModelCatalogItem, ModelDownload } from "../../lib/api";

export type TagTone = "ok" | "action" | "neutral" | "warn" | "fail";
export interface Tag {
  label: string;
  tone: TagTone;
}

const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9)
    return `${decimal.format(bytes >= 1e11 ? Math.round(bytes / 1e9) : bytes / 1e9)} GB`;
  return `${decimal.format(Math.round(bytes / 1e6))} MB`;
}

export function compatibilityTag(compatibility: ModelCatalogItem["compatibility"]): Tag | null {
  switch (compatibility) {
    case "recommended":
      return { label: "Recomendado", tone: "action" };
    case "compatible":
      return { label: "Compatível", tone: "neutral" };
    case "above_recommended":
      return { label: "Acima do seu hardware", tone: "warn" };
    case "incompatible":
      return { label: "Incompatível", tone: "fail" };
    case "unknown":
      return null;
  }
}

export function installTag(installed: boolean | null, sizeBytes: number | null): Tag | null {
  if (installed === null) return null;
  if (installed) return { label: "Instalado", tone: "ok" };
  return {
    label: sizeBytes === null ? "Não instalado" : `Não instalado · ${formatBytes(sizeBytes)}`,
    tone: "neutral",
  };
}

export function downloadProgress(job: ModelDownload): { label: string; percent: number | null } {
  if (job.status === "queued") {
    return { label: "Na fila. Um download acontece por vez.", percent: null };
  }
  if (job.status === "cancelling") {
    return { label: "Cancelando e apagando os arquivos parciais…", percent: null };
  }
  if (job.totalBytes === null || job.totalBytes === 0) {
    return { label: `Baixando… ${formatBytes(job.completedBytes)}`, percent: null };
  }
  const percent = Math.min(100, Math.floor((job.completedBytes / job.totalBytes) * 100));
  return {
    label: `Baixando… ${String(percent)}% de ${formatBytes(job.totalBytes)}`,
    percent,
  };
}
