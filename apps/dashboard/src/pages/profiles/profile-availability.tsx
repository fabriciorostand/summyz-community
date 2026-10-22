import { TriangleAlert } from "lucide-react";

import { Button } from "../../components/ui";
import { useModelCatalog } from "../../hooks/use-model-catalog";
import { isDownloadActive, type ModelDownloads } from "../../hooks/use-model-downloads";
import { type I18nSnapshot, useI18n } from "../../i18n/store";
import type { ModelDownload, Profile, ProfileAvailability } from "../../lib/api";
import { downloadProgress } from "./model-labels";
import type { Stage } from "./profile-stages";

type MissingModel = ProfileAvailability["missingModels"][number];

function useMissingModel(profile: Profile, stage: Stage): MissingModel | undefined {
  const { model, provider } = profile[stage];
  const local = model !== null && (provider === "ollama" || provider === "faster-whisper");
  const { state } = useModelCatalog(
    stage,
    local ? provider : null,
    local && provider === "ollama" ? model.split(":")[0] : undefined,
  );
  if (!local || state.status !== "ready" || state.catalog.inventoryStatus !== "available") {
    return undefined;
  }
  const installed =
    state.catalog.items.find((item) => item.model === model)?.installed ??
    state.catalog.installedModels.some((item) => item.model === model);
  return installed ? undefined : { model, phase: stage, provider };
}

/** Local models of an edited profile that are not on this machine, read from the catalogs. */
export function useMissingModels(profile: Profile): MissingModel[] {
  const missing = [
    useMissingModel(profile, "transcription"),
    useMissingModel(profile, "refinement"),
    useMissingModel(profile, "summary"),
  ];
  return missing.filter((entry): entry is MissingModel => entry !== undefined);
}

type Copy = Pick<I18nSnapshot, "format" | "t">;

export function missingSummary(missing: readonly MissingModel[], { format, t }: Copy): string {
  return format.list(
    missing.map((entry) => t.availability.missingEntry(entry.model, t.stages.titles[entry.phase])),
  );
}

/** One line about whether a saved profile can record, for the list and the server screen. */
export function availabilityLine(
  availability: ProfileAvailability,
  jobFor: (provider: ModelDownload["provider"], model: string) => ModelDownload | undefined,
  { format, t }: Copy,
): { text: string; tone: "warn" | "muted" } | null {
  if (availability.status === "incomplete") {
    return { text: t.availability.incompleteLine, tone: "warn" };
  }
  if (availability.status === "unavailable") {
    return { text: t.availability.unavailableLine, tone: "muted" };
  }
  if (availability.status !== "missing_models") return null;
  const busy = availability.missingModels.find((entry) => {
    const job = jobFor(entry.provider, entry.model);
    return job !== undefined && isDownloadActive(job);
  });
  if (busy !== undefined) {
    const job = jobFor(busy.provider, busy.model);
    const percent =
      job?.totalBytes == null || job.totalBytes === 0
        ? ""
        : ` · ${String(Math.floor((job.completedBytes / job.totalBytes) * 100))}%`;
    return { text: `${t.availability.downloading(busy.model)}${percent}`, tone: "muted" };
  }
  const models = format.list([...new Set(availability.missingModels.map((entry) => entry.model))]);
  return { text: t.availability.missingLine(models), tone: "warn" };
}

/** A missing model; its download lives in the stage panel, so this row only points there. */
function MissingRow({
  downloads,
  entry,
  onGoTo,
  stage,
}: {
  downloads: ModelDownloads;
  entry: MissingModel;
  onGoTo: (stage: Stage) => void;
  stage: Stage;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const job = downloads.jobFor(entry.provider, entry.model);
  const progress = job !== undefined && isDownloadActive(job) ? downloadProgress(job, i18n) : null;
  return (
    <li className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
      <code className="font-mono text-[11.5px] text-ink">{entry.model}</code>
      <span className="text-[11.5px] text-ink-muted">
        {t.stages.titles[entry.phase]}
        {job?.status === "failed" ? t.availability.downloadFailedSuffix : ""}
      </span>
      {progress !== null && (
        <span className="ml-auto text-[11px] text-ink-muted">{progress.label}</span>
      )}
      {progress === null && entry.phase !== stage && (
        <Button
          className="ml-auto px-2 py-1 text-[11.5px]"
          onClick={() => onGoTo(entry.phase)}
          type="button"
          variant="ghost"
        >
          {t.saveBar.goTo(t.stages.titles[entry.phase])}
        </Button>
      )}
    </li>
  );
}

function bannerCopy(
  activeServerCount: number,
  availability: ProfileAvailability,
  changed: boolean,
  missing: readonly MissingModel[],
  i18n: Copy,
): { body: string; title: string } | null {
  const { availability: copy } = i18n.t;
  if (!changed && availability.status === "incomplete") {
    return { body: copy.bannerIncompleteBody, title: copy.bannerIncompleteTitle };
  }
  if (!changed && availability.status === "unavailable") {
    return { body: copy.bannerUnavailableBody, title: copy.bannerUnavailableTitle };
  }
  if (missing.length === 0) return null;
  const servers =
    changed || activeServerCount === 0 ? "" : copy.serversWithoutRecording(activeServerCount);
  return {
    body: `${copy.bannerMissingBody(missingSummary(missing, i18n))}${servers}`,
    title: changed ? copy.bannerMissingTitleChanged : copy.bannerMissingTitle,
  };
}

/** Says, above the stages, whether the bot can record with this profile and how to fix it. */
export function AvailabilityBanner({
  activeServerCount,
  availability,
  changed,
  downloads,
  draftMissing,
  onGoTo,
  stage,
}: {
  activeServerCount: number;
  availability: ProfileAvailability;
  /** The editor holds unsaved changes, so the edited models decide the message. */
  changed: boolean;
  downloads: ModelDownloads;
  draftMissing: readonly MissingModel[];
  onGoTo: (stage: Stage) => void;
  /** The stage open below, whose panel already holds the download of its model. */
  stage: Stage;
}) {
  const i18n = useI18n();
  const missing = changed ? draftMissing : availability.missingModels;
  const copy = bannerCopy(activeServerCount, availability, changed, missing, i18n);
  if (copy === null) return null;
  const { body, title } = copy;
  return (
    <section
      aria-label={title}
      className="flex gap-3 rounded-xl border border-warn/40 bg-warn/10 px-3.5 py-3"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-[12.5px] leading-relaxed text-ink-secondary">
        <strong className="text-[13px] font-semibold text-ink">{title}</strong>
        <span>{body}</span>
        {missing.length > 0 && (
          <ul className="m-0 mt-1 flex list-none flex-col gap-2 p-0">
            {missing.map((entry) => (
              <MissingRow
                downloads={downloads}
                entry={entry}
                key={`${entry.phase}-${entry.model}`}
                onGoTo={onGoTo}
                stage={stage}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
