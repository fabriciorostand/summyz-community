import { TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Button, FormError } from "../../components/ui";
import { useModelCatalog } from "../../hooks/use-model-catalog";
import { isDownloadActive, type ModelDownloads } from "../../hooks/use-model-downloads";
import {
  ApiError,
  type ModelDownload,
  type Profile,
  type ProfileAvailability,
} from "../../lib/api";
import { downloadProgress } from "./model-labels";
import { type Stage, stageTitles } from "./profile-stages";

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

export function missingSummary(missing: readonly MissingModel[]): string {
  return new Intl.ListFormat("pt-BR").format(
    missing.map((entry) => `${entry.model} (${stageTitles[entry.phase]})`),
  );
}

/** One line about whether a saved profile can record, for the list and the server screen. */
export function availabilityLine(
  availability: ProfileAvailability,
  jobFor: (provider: ModelDownload["provider"], model: string) => ModelDownload | undefined,
): { text: string; tone: "warn" | "muted" } | null {
  if (availability.status === "incomplete") {
    return { text: "Incompleto: escolha a execução e o modelo das etapas", tone: "warn" };
  }
  if (availability.status === "unavailable") {
    return { text: "Não foi possível verificar os modelos locais", tone: "muted" };
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
    return { text: `Baixando ${busy.model}${percent}`, tone: "muted" };
  }
  const models = new Intl.ListFormat("pt-BR").format([
    ...new Set(availability.missingModels.map((entry) => entry.model)),
  ]);
  return { text: `Indisponível: falta instalar ${models}`, tone: "warn" };
}

const downloadMessages: Record<string, string> = {
  download_queue_full:
    "A fila de downloads está cheia. Aguarde um download terminar e tente de novo.",
  model_lifecycle_busy: "Outra operação de modelos está em andamento. Tente de novo em instantes.",
};

function MissingRow({ downloads, entry }: { downloads: ModelDownloads; entry: MissingModel }) {
  const [error, setError] = useState<string | null>(null);
  const job = downloads.jobFor(entry.provider, entry.model);
  const progress = job !== undefined && isDownloadActive(job) ? downloadProgress(job) : null;
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <code className="font-mono text-[11.5px] text-ink">{entry.model}</code>
        <span className="text-[11.5px] text-ink-muted">
          {stageTitles[entry.phase]}
          {job?.status === "failed" ? " · o download falhou" : ""}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {progress !== null && job !== undefined ? (
            <>
              <span className="text-[11px] text-ink-muted">{progress.label}</span>
              {job.status !== "cancelling" && (
                <Button
                  aria-label={`Cancelar download de ${entry.model}`}
                  className="px-2 py-1 text-[11.5px]"
                  onClick={() => {
                    void downloads
                      .cancel(job.downloadId)
                      .catch(() =>
                        setError("Não foi possível cancelar o download. Tente de novo."),
                      );
                  }}
                  type="button"
                  variant="ghost"
                >
                  Cancelar
                </Button>
              )}
            </>
          ) : (
            <Button
              aria-label={`Baixar ${entry.model}`}
              className="px-2.5 py-1 text-[11.5px]"
              onClick={() => {
                setError(null);
                downloads
                  .start(entry.phase, entry.provider, entry.model)
                  .catch((reason: unknown) =>
                    setError(
                      (reason instanceof ApiError ? downloadMessages[reason.code] : undefined) ??
                        "Não foi possível iniciar o download. Tente de novo.",
                    ),
                  );
              }}
              type="button"
              variant="secondary"
            >
              {job?.status === "failed" ? "Tentar de novo" : "Baixar agora"}
            </Button>
          )}
        </span>
      </div>
      {error !== null && <FormError>{error}</FormError>}
    </li>
  );
}

function serversWithoutRecording(activeServerCount: number): string {
  if (activeServerCount === 0) return "";
  return activeServerCount === 1
    ? " O servidor que usa este perfil está sem gravação até lá."
    : ` Os ${String(activeServerCount)} servidores que usam este perfil estão sem gravação até lá.`;
}

function bannerCopy(
  activeServerCount: number,
  availability: ProfileAvailability,
  changed: boolean,
  missing: readonly MissingModel[],
): { body: string; title: string } | null {
  if (!changed && availability.status === "incomplete") {
    return {
      body: "Escolha a execução e o modelo de cada etapa e salve. Até lá, o bot não grava com ele.",
      title: "Este perfil ainda não está completo.",
    };
  }
  if (!changed && availability.status === "unavailable") {
    return {
      body: "O serviço de modelos desta instalação não respondeu. A gravação pode ser recusada.",
      title: "Não foi possível verificar os modelos locais deste perfil.",
    };
  }
  if (missing.length === 0) return null;
  return {
    body: `Falta instalar ${missingSummary(missing)}. O bot recusa gravações com este perfil enquanto isso.${changed ? "" : serversWithoutRecording(activeServerCount)}`,
    title: changed
      ? "Com estas alterações, este perfil não vai gravar até terminar o download."
      : "Este perfil ainda não pode gravar.",
  };
}

/** Says, above the stages, whether the bot can record with this profile and how to fix it. */
export function AvailabilityBanner({
  activeServerCount,
  availability,
  changed,
  downloads,
  draftMissing,
}: {
  activeServerCount: number;
  availability: ProfileAvailability;
  /** The editor holds unsaved changes, so the edited models decide the message. */
  changed: boolean;
  downloads: ModelDownloads;
  draftMissing: readonly MissingModel[];
}) {
  const missing = changed ? draftMissing : availability.missingModels;
  const copy = bannerCopy(activeServerCount, availability, changed, missing);
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
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
