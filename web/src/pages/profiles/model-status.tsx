import { CircleDollarSign, HardDrive, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Button, FormError } from "../../components/ui";
import { invalidateModelCatalogs, useModelCatalog } from "../../hooks/use-model-catalog";
import { isDownloadActive, type ModelDownloads } from "../../hooks/use-model-downloads";
import { ApiError, api, type ModelCatalog, type ModelDownload } from "../../lib/api";
import { downloadProgress, formatBytes } from "./model-labels";
import type { Stage } from "./profile-stages";

type LocalProvider = ModelDownload["provider"];

const operationMessages: Record<string, string> = {
  download_queue_full:
    "A fila de downloads está cheia. Aguarde um download terminar e tente de novo.",
  model_download_active: "Há um download deste modelo em andamento. Aguarde ele terminar.",
  model_in_use:
    "Uma gravação ou reunião em processamento ainda usa este modelo. Tente depois que o processamento terminar.",
  model_lifecycle_busy: "Outra operação de modelos está em andamento. Tente de novo em instantes.",
};

function operationMessage(error: unknown, fallback: string): string {
  return (error instanceof ApiError ? operationMessages[error.code] : undefined) ?? fallback;
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
  if (needsModel) {
    return (
      <small className="text-[11px] leading-relaxed text-warn">
        A execução mudou. Escolha um modelo {provider === "openrouter" ? "do OpenRouter" : "local"}{" "}
        para esta etapa.
      </small>
    );
  }
  if (provider === "openrouter") {
    return (
      <p className="m-0 flex items-start gap-2 text-[12px] leading-relaxed text-ink-secondary">
        <CircleDollarSign className="mt-0.5 size-3.5 shrink-0 text-warn" />
        Esta etapa usa o OpenRouter e gera custo por uso, cobrado na sua conta do OpenRouter.
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
  const { state } = useModelCatalog(
    stage,
    provider,
    provider === "ollama" ? model.split(":")[0] : undefined,
  );
  const [error, setError] = useState<string | null>(null);
  const job = downloads.jobFor(provider, model);

  function download() {
    setError(null);
    downloads
      .start(stage, provider, model)
      .catch((reason: unknown) =>
        setError(operationMessage(reason, "Não foi possível iniciar o download. Tente de novo.")),
      );
  }

  if (job !== undefined && isDownloadActive(job)) {
    return <DownloadProgress downloads={downloads} job={job} />;
  }
  if (job?.status === "failed") {
    return (
      <div className={`${boxClass} border-fail/40 bg-fail-soft/40 text-ink-secondary`}>
        <strong className="text-[12.5px] text-ink">Não foi possível baixar {model}.</strong>
        Verifique o espaço em disco e a conexão desta instalação e tente de novo.
        <Button
          className="px-2.5 py-1 text-[12px]"
          onClick={download}
          type="button"
          variant="secondary"
        >
          Tentar de novo
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
    return (
      <small className="text-[11px] text-ink-muted">
        Não foi possível verificar se {model} está instalado nesta máquina.
      </small>
    );
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
          <strong className="text-[12.5px] text-ink">
            {model} ainda não está instalado
            {entry?.sizeBytes == null ? "" : ` (${formatBytes(entry.sizeBytes)})`}.
          </strong>
          Você pode salvar o perfil, mas ele não vai gravar até o modelo ser baixado.
          <Button
            className="px-2.5 py-1 text-[12px]"
            onClick={download}
            type="button"
            variant="secondary"
          >
            Baixar agora
          </Button>
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
  if (compatibility === "incompatible") {
    return (
      <p className="m-0 flex items-start gap-2 rounded-lg border border-fail/40 bg-fail-soft px-3.5 py-2.5 text-[12px] leading-relaxed text-fail">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
        Este modelo é incompatível com esta máquina e o bot não grava com ele. Escolha um modelo
        marcado como compatível ou recomendado.
      </p>
    );
  }
  if (compatibility === "above_recommended") {
    return (
      <p className="m-0 flex items-start gap-2 text-[12px] leading-relaxed text-warn">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
        Este modelo pede mais do que esta máquina recomenda e pode ficar lento ou falhar.
      </p>
    );
  }
  return null;
}

function DownloadProgress({ downloads, job }: { downloads: ModelDownloads; job: ModelDownload }) {
  const [error, setError] = useState<string | null>(null);
  const progress = downloadProgress(job);
  return (
    <div
      className={`${boxClass} w-full border-line bg-surface-raised text-ink-secondary`}
      role="status"
    >
      <span>{progress.label}</span>
      <div
        aria-label={`Download de ${job.model}`}
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
                setError(
                  operationMessage(reason, "Não foi possível cancelar o download. Tente de novo."),
                ),
              );
          }}
          type="button"
          variant="ghost"
        >
          Cancelar download
        </Button>
      )}
      <small className="text-[11px] text-ink-dim">
        Você pode salvar o perfil agora, mas ele só vai gravar quando o download terminar.
      </small>
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
      setError(operationMessage(reason, "Não foi possível desinstalar o modelo. Tente de novo."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-secondary">
        <span className="flex items-center gap-1.5 text-ok">
          <HardDrive className="size-3.5" />
          Instalado nesta máquina
        </span>
        {!confirming && (
          <Button
            className="px-2 py-1 text-[12px]"
            onClick={() => setConfirming(true)}
            type="button"
            variant="ghost"
          >
            Desinstalar modelo
          </Button>
        )}
      </div>
      {confirming && (
        <div
          aria-label={`Desinstalar ${model}?`}
          className={`${boxClass} border-warn/30 bg-warn/10 text-ink-secondary`}
          role="alertdialog"
        >
          <strong className="text-[12.5px] text-ink">Desinstalar {model}?</strong>
          Os arquivos saem desta máquina. Perfis que usam este modelo ficam sem poder gravar até ele
          ser baixado de novo.
          <div className="flex gap-2">
            <Button
              className="px-2.5 py-1 text-[12px]"
              disabled={busy}
              onClick={() => setConfirming(false)}
              type="button"
              variant="secondary"
            >
              Cancelar
            </Button>
            <Button
              className="px-2.5 py-1 text-[12px]"
              disabled={busy}
              onClick={() => void uninstall()}
              type="button"
              variant="danger"
            >
              Desinstalar
            </Button>
          </div>
        </div>
      )}
      {error !== null && <FormError>{error}</FormError>}
    </div>
  );
}
