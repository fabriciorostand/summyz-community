import { CircleDollarSign, Download, HardDrive, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";

import { Button, FormError } from "../../components/ui";
import { invalidateModelCatalogs, useModelCatalog } from "../../hooks/use-model-catalog";
import { isDownloadActive, type ModelDownloads } from "../../hooks/use-model-downloads";
import type { Messages } from "../../i18n/messages/pt-BR";
import { useI18n } from "../../i18n/store";
import { ApiError, api, type ModelCatalog, type ModelDownload } from "../../lib/api";
import { downloadProgress } from "./model-labels";
import type { Stage } from "./profile-stages";

type LocalProvider = ModelDownload["provider"];

function operationMessage(error: unknown, fallback: string, t: Messages): string {
  return (error instanceof ApiError ? t.modelOperations[error.code] : undefined) ?? fallback;
}

const boxClass =
  "flex flex-col items-start gap-2 rounded-lg border px-3.5 py-3 text-[12px] leading-relaxed";

export interface ModelStatusProps {
  downloads: ModelDownloads;
  model: string | null;
  needsModel: boolean;
  /** Called after models change on disk, so availability can be read again. */
  onModelsChanged: () => void;
  provider: ModelCatalog["provider"];
  stage: Stage;
}

/** What the person needs to know about the model of a stage, right below the picker. */
export function ModelStatus({
  downloads,
  model,
  needsModel,
  onModelsChanged,
  provider,
  stage,
}: ModelStatusProps) {
  const { t } = useI18n();
  if (needsModel) {
    return (
      <small className="text-[11px] leading-relaxed text-warn">
        {t.models.executionChanged(provider === "openrouter")}
      </small>
    );
  }
  if (provider === "openrouter") {
    return (
      <p className="m-0 flex items-start gap-2 text-[12px] leading-relaxed text-ink-secondary">
        <CircleDollarSign className="mt-0.5 size-3.5 shrink-0 text-warn" />
        {t.models.openRouterCost}
      </p>
    );
  }
  if (model === null) return null;
  return (
    <LocalModelStatus
      downloads={downloads}
      model={model}
      onModelsChanged={onModelsChanged}
      provider={provider}
      stage={stage}
    />
  );
}

function LocalModelStatus({
  downloads,
  model,
  onModelsChanged,
  provider,
  stage,
}: {
  downloads: ModelDownloads;
  model: string;
  onModelsChanged: () => void;
  provider: LocalProvider;
  stage: Stage;
}) {
  const { format, t } = useI18n();
  const { state } = useModelCatalog(
    stage,
    provider,
    provider === "ollama" ? model.split(":")[0] : undefined,
  );
  const [error, setError] = useState<string | null>(null);
  const notInstalledId = useId();
  const job = downloads.jobFor(provider, model);

  function download() {
    setError(null);
    downloads
      .start(stage, provider, model)
      .catch((reason: unknown) =>
        setError(operationMessage(reason, t.availability.startFailed, t)),
      );
  }

  if (job !== undefined && isDownloadActive(job)) {
    return <DownloadProgress downloads={downloads} job={job} />;
  }
  if (job?.status === "failed") {
    return (
      <div className={`${boxClass} border-fail/40 bg-fail-soft/40 text-ink-secondary`}>
        <strong className="text-[12.5px] text-ink">{t.models.downloadFailedTitle(model)}</strong>
        {t.models.downloadFailedBody}
        <Button
          className="px-2.5 py-1 text-[12px]"
          onClick={download}
          type="button"
          variant="secondary"
        >
          {t.common.tryAgain}
        </Button>
        {error !== null && <FormError>{error}</FormError>}
      </div>
    );
  }
  if (state.status !== "ready" && state.status !== "error") return null;
  if (
    state.status === "error" ||
    state.catalog.status === "unavailable" ||
    state.catalog.inventoryStatus === "unavailable"
  ) {
    return <small className="text-[11px] text-ink-muted">{t.models.cannotVerify(model)}</small>;
  }
  const entry = state.catalog.items.find((item) => item.model === model);
  const installed =
    entry?.installed ?? state.catalog.installedModels.some((item) => item.model === model);
  return (
    <div className="flex w-full flex-col gap-2">
      <CompatibilityWarning compatibility={entry?.compatibility} />
      {installed ? (
        <InstalledModel model={model} onModelsChanged={onModelsChanged} provider={provider} />
      ) : (
        <div className={`${boxClass} border-line bg-surface-raised text-ink-secondary`}>
          <div className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <span id={notInstalledId}>{t.models.notInstalledHere}</span>
            <Button
              aria-describedby={notInstalledId}
              className="px-2.5 py-1 text-[12px]"
              onClick={download}
              type="button"
              variant="secondary"
            >
              <Download className="size-3.5 shrink-0" />
              {entry?.sizeBytes == null
                ? t.models.download
                : t.models.downloadWithSize(format.bytes(entry.sizeBytes))}
            </Button>
          </div>
          {error !== null && <FormError>{error}</FormError>}
        </div>
      )}
    </div>
  );
}

function CompatibilityWarning({
  compatibility,
}: {
  compatibility: ModelCatalog["items"][number]["compatibility"] | undefined;
}) {
  const { t } = useI18n();
  if (compatibility === "incompatible") {
    return (
      <p className="m-0 flex items-start gap-2 rounded-lg border border-fail/40 bg-fail-soft px-3.5 py-2.5 text-[12px] leading-relaxed text-fail">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
        {t.models.incompatibleWarning}
      </p>
    );
  }
  if (compatibility === "above_recommended") {
    return (
      <p className="m-0 flex items-start gap-2 text-[12px] leading-relaxed text-warn">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
        {t.models.aboveRecommendedWarning}
      </p>
    );
  }
  return null;
}

function DownloadProgress({ downloads, job }: { downloads: ModelDownloads; job: ModelDownload }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [error, setError] = useState<string | null>(null);
  const progress = downloadProgress(job, i18n);
  return (
    <div
      className={`${boxClass} w-full border-line bg-surface-raised text-ink-secondary`}
      role="status"
    >
      <span>{progress.label}</span>
      <div
        aria-label={t.models.downloadOf(job.model)}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={progress.percent ?? undefined}
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-inset"
        role="progressbar"
      >
        <div
          className={`h-full rounded-full bg-action transition-[width] ${
            progress.percent === null ? "w-1/3 animate-pulse" : ""
          }`}
          style={progress.percent === null ? undefined : { width: `${String(progress.percent)}%` }}
        />
      </div>
      {job.status !== "cancelling" && (
        <Button
          className="px-2.5 py-1 text-[12px]"
          onClick={() => {
            setError(null);
            downloads
              .cancel(job.downloadId)
              .catch((reason: unknown) =>
                setError(operationMessage(reason, t.availability.cancelFailed, t)),
              );
          }}
          type="button"
          variant="ghost"
        >
          {t.models.cancelDownload}
        </Button>
      )}
      {error !== null && <FormError>{error}</FormError>}
    </div>
  );
}

function InstalledModel({
  model,
  onModelsChanged,
  provider,
}: {
  model: string;
  onModelsChanged: () => void;
  provider: LocalProvider;
}) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function uninstall() {
    setBusy(true);
    setError(null);
    try {
      await api.uninstallModel(provider, model);
      setConfirming(false);
      invalidateModelCatalogs();
      onModelsChanged();
    } catch (reason) {
      setError(operationMessage(reason, t.models.uninstallFailed, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-secondary">
        <span className="flex items-center gap-1.5 text-ok">
          <HardDrive className="size-3.5" />
          {t.models.installedHere}
        </span>
        {!confirming && (
          <Button
            className="px-2 py-1 text-[12px]"
            onClick={() => setConfirming(true)}
            type="button"
            variant="ghost"
          >
            {t.models.uninstallModel}
          </Button>
        )}
      </div>
      {confirming && (
        <div
          aria-label={t.models.uninstallQuestion(model)}
          className={`${boxClass} border-warn/30 bg-warn/10 text-ink-secondary`}
          role="alertdialog"
        >
          <strong className="text-[12.5px] text-ink">{t.models.uninstallQuestion(model)}</strong>
          {t.models.uninstallWarning}
          <div className="flex gap-2">
            <Button
              className="px-2.5 py-1 text-[12px]"
              disabled={busy}
              onClick={() => setConfirming(false)}
              type="button"
              variant="secondary"
            >
              {t.common.cancel}
            </Button>
            <Button
              className="px-2.5 py-1 text-[12px]"
              disabled={busy}
              onClick={() => void uninstall()}
              type="button"
              variant="danger"
            >
              {t.models.uninstall}
            </Button>
          </div>
        </div>
      )}
      {error !== null && <FormError>{error}</FormError>}
    </div>
  );
}
