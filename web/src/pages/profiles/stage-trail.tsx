import { Cloud, HardDrive } from "lucide-react";
import { Fragment, type KeyboardEvent } from "react";

import { HelpTip } from "../../components/ui";
import type { Profile } from "../../lib/api";
import { executionOf, type Stage, stages, stageTitles } from "./profile-stages";

export interface StageNote {
  text: string;
  tone?: "warn";
}

export const stageHelp: Record<Stage, string> = {
  refinement: "Revisa a transcrição e corrige erros evidentes, sem resumir nem traduzir.",
  summary: "Encontra decisões e tarefas e escreve o resumo publicado no Discord.",
  transcription: "Converte a fala de cada participante em texto, com horário e autor.",
};

export const stagePanelId = "profile-stage-panel";
export const stageTabId = (stage: Stage) => `profile-stage-${stage}`;

function Connector() {
  return (
    <div aria-hidden="true" className="grid place-items-center text-line-strong">
      <svg
        aria-hidden="true"
        className="h-3 w-full"
        fill="none"
        preserveAspectRatio="none"
        viewBox="0 0 28 12"
      >
        <path d="M0 6h24" stroke="currentColor" strokeWidth="1.5" />
        <path d="m20 2 4 4-4 4" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

function Where({ profile, stage }: { profile: Profile; stage: Stage }) {
  const execution = executionOf(profile, stage);
  if (execution === null) return null;
  return execution === "local" ? (
    <span className="flex items-center gap-1.5 text-[11px] font-medium text-ink-secondary">
      <HardDrive className="size-3" />
      Local
    </span>
  ) : (
    <span className="flex items-center gap-1.5 text-[11px] font-medium text-accent">
      <Cloud className="size-3" />
      <span className="hidden sm:inline">API externa</span>
      <span className="sm:hidden">API</span>
    </span>
  );
}

/**
 * The profile read as what it is: three stages in order, each with its model and where it runs.
 * Picking a stage opens its settings in the panel right below.
 */
export function StageTrail({
  dirty,
  notes,
  onSelect,
  profile,
  selected,
}: {
  dirty: Record<Stage, boolean>;
  notes: Record<Stage, StageNote>;
  onSelect: (stage: Stage) => void;
  profile: Profile;
  selected: Stage;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = stages[(stages.indexOf(selected) + step + stages.length) % stages.length];
    if (next === undefined) return;
    onSelect(next);
    document.getElementById(stageTabId(next))?.focus();
  }

  return (
    <div
      aria-label="Etapas do processamento"
      className="grid grid-cols-[minmax(0,1fr)_12px_minmax(0,1fr)_12px_minmax(0,1fr)] p-0 sm:grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)_28px_minmax(0,1fr)]"
      onKeyDown={onKeyDown}
      role="tablist"
    >
      {stages.map((stage, index) => {
        const active = stage === selected;
        const { model } = profile[stage];
        const note = notes[stage];
        return (
          <Fragment key={stage}>
            {index > 0 && <Connector />}
            <div className="relative flex min-w-0">
              <button
                aria-controls={stagePanelId}
                aria-selected={active}
                className={`relative flex min-w-0 flex-1 flex-col gap-1.5 rounded-xl border px-2 pt-2.5 pb-2.5 text-left transition-colors sm:px-3.5 sm:pt-3 ${
                  active
                    ? "border-action bg-action-soft after:absolute after:-bottom-[7px] after:left-1/2 after:size-3 after:-translate-x-1/2 after:rotate-45 after:border-r after:border-b after:border-action after:bg-action-soft"
                    : "border-line bg-surface hover:border-line-strong"
                }`}
                id={stageTabId(stage)}
                onClick={() => onSelect(stage)}
                role="tab"
                tabIndex={active ? 0 : -1}
                type="button"
              >
                <span className="flex min-w-0 items-center gap-1.5 pr-0 sm:pr-5">
                  <span className="truncate text-[11.5px] font-semibold text-ink sm:text-[13px]">
                    {stageTitles[stage]}
                  </span>
                  {dirty[stage] && (
                    <span className="size-1.5 shrink-0 rounded-full bg-warn">
                      <span className="sr-only">alterada</span>
                    </span>
                  )}
                </span>
                {model === null ? (
                  <span className="truncate text-[11.5px] text-ink-dim">Sem modelo</span>
                ) : (
                  <span className="truncate font-mono text-[10px] text-ink sm:text-[11.5px]">
                    <span className="hidden sm:inline">{model}</span>
                    <span className="sm:hidden">{model.split("/").at(-1)}</span>
                  </span>
                )}
                <span
                  // Phones only have room for warnings; the regular note waits for wider screens.
                  className={`truncate text-[10.5px] sm:text-[11.5px] ${
                    note.tone === "warn" ? "block text-warn" : "hidden text-ink-muted sm:block"
                  }`}
                >
                  {note.text}
                </span>
                <Where profile={profile} stage={stage} />
              </button>
              <span className="absolute right-1.5 bottom-2 sm:top-2.5 sm:right-2.5 sm:bottom-auto">
                <HelpTip label={`Sobre a etapa ${stageTitles[stage]}`}>{stageHelp[stage]}</HelpTip>
              </span>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
