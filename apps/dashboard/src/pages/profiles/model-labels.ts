import type { Messages } from "../../i18n/messages/pt-BR";
import type { I18nSnapshot } from "../../i18n/store";
import type { ModelCatalogItem, ModelDownload } from "../../lib/api";

export type TagTone = "ok" | "action" | "neutral" | "warn" | "fail";
export interface Tag {
  label: string;
  tone: TagTone;
}

type Copy = Pick<I18nSnapshot, "format" | "t">;

export function compatibilityTag(
  compatibility: ModelCatalogItem["compatibility"],
  t: Messages,
): Tag | null {
  switch (compatibility) {
    case "recommended":
      return { label: t.models.recommended, tone: "action" };
    case "compatible":
      return { label: t.models.compatible, tone: "neutral" };
    case "above_recommended":
      return { label: t.models.aboveRecommended, tone: "warn" };
    case "incompatible":
      return { label: t.models.incompatible, tone: "fail" };
    case "unknown":
      return null;
  }
}

export function installTag(
  installed: boolean | null,
  sizeBytes: number | null,
  { format, t }: Copy,
): Tag | null {
  if (installed === null) return null;
  if (installed) return { label: t.models.installed, tone: "ok" };
  return {
    label:
      sizeBytes === null
        ? t.models.notInstalled
        : t.models.notInstalledSize(format.bytes(sizeBytes)),
    tone: "neutral",
  };
}

export function downloadProgress(
  job: ModelDownload,
  { format, t }: Copy,
): { label: string; percent: number | null } {
  if (job.status === "queued") return { label: t.models.queued, percent: null };
  if (job.status === "cancelling") return { label: t.models.cancelling, percent: null };
  if (job.totalBytes === null || job.totalBytes === 0) {
    return { label: t.models.downloadingBytes(format.bytes(job.completedBytes)), percent: null };
  }
  const percent = Math.min(100, Math.floor((job.completedBytes / job.totalBytes) * 100));
  return {
    label: t.models.downloadingPercent(String(percent), format.bytes(job.totalBytes)),
    percent,
  };
}
