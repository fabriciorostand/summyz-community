import { AudioLines, Cloud, Combine, HardDrive, Settings2 } from "lucide-react";

import { Disclosure } from "../../components/disclosure";
import { Badge, Label } from "../../components/ui";
import type { ModelDownloads } from "../../hooks/use-model-downloads";
import { presentPromptDefaults } from "../../i18n/prompt-defaults";
import { useI18n } from "../../i18n/store";
import type { Profile, PromptDefaults } from "../../lib/api";
import { MergeSettings, PhaseSettings, TranscriptionTuning } from "./generation-editor";
import { LanguageSelector } from "./language-selector";
import { ModelPicker } from "./model-picker";
import { ModelStatus } from "./model-status";
import {
  type Execution,
  executionOf,
  localProviderOf,
  type Stage,
  type StageReview,
  summaryPromptLanguage,
} from "./profile-stages";
import { PromptEditor } from "./prompt-editor";
import { stagePanelId, stageTabId } from "./stage-trail";
import { VadEditor } from "./vad-editor";

export interface StagePanelProps {
  downloads: ModelDownloads;
  needsModel: boolean;
  onAcknowledge: (path: string) => void;
  /** Receives any edited profile; the caller validates it against the contract. */
  onChange: (profile: unknown) => void;
  onExecution: (execution: Execution) => void;
  onModel: (model: string) => void;
  onModelsChanged: () => void;
  profile: Profile;
  promptDefaults: PromptDefaults | undefined;
  review: StageReview;
  stage: Stage;
}

function ExecutionChoice({
  onChange,
  stage,
  value,
}: {
  onChange: (execution: Execution) => void;
  stage: Stage;
  value: Execution | null;
}) {
  const { t } = useI18n();
  const options = [
    { icon: <HardDrive className="size-3" />, label: t.stagePanel.local, value: "local" as const },
    { icon: <Cloud className="size-3" />, label: t.stagePanel.external, value: "api" as const },
  ];
  // Native radios keep arrow-key selection and the group semantics without extra wiring. The
  // label sits above the options with the same spacing as the model field below.
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-1.5 p-0">
        <Label>{t.stagePanel.execution}</Label>{" "}
        <span className="sr-only">{t.stagePanel.executionOfStage(t.stages.titles[stage])}</span>
      </legend>
      <div className="inline-flex max-w-full gap-0.5 rounded-lg border border-line bg-surface p-1">
        {options.map((option) => (
          <label
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium whitespace-nowrap text-ink-secondary transition-colors hover:bg-surface-inset hover:text-ink has-checked:cursor-default has-checked:bg-action has-checked:text-white has-focus-visible:outline-2 has-focus-visible:outline-action sm:px-3"
            key={option.value}
          >
            <input
              checked={option.value === value}
              className="sr-only"
              name={`execution-${stage}`}
              onChange={() => onChange(option.value)}
              type="radio"
              value={option.value}
            />
            {option.icon}
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function StagePanel(props: StagePanelProps) {
  const { t } = useI18n();
  const { profile, stage } = props;
  const execution = executionOf(profile, stage);
  const provider = execution === "api" ? "openrouter" : localProviderOf(stage);
  return (
    <section
      aria-labelledby={stageTabId(stage)}
      className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-4 sm:p-5"
      id={stagePanelId}
      role="tabpanel"
    >
      <div className="flex flex-col gap-3 border-b border-line-soft pb-5">
        <ExecutionChoice onChange={props.onExecution} stage={stage} value={execution} />
        {execution === null ? (
          <p className="m-0 text-[12px] text-ink-muted">{t.stagePanel.chooseExecutionHint}</p>
        ) : (
          <>
            <ModelPicker
              jobFor={props.downloads.jobFor}
              key={provider}
              needsChoice={props.needsModel}
              onChange={props.onModel}
              provider={provider}
              stage={stage}
              value={props.needsModel ? null : profile[stage].model}
            />
            <ModelStatus
              downloads={props.downloads}
              model={props.needsModel ? null : profile[stage].model}
              needsModel={props.needsModel}
              onModelsChanged={props.onModelsChanged}
              provider={provider}
              stage={stage}
            />
          </>
        )}
      </div>
      <StageFields {...props} />
    </section>
  );
}

function StageFields({
  onAcknowledge,
  onChange,
  profile,
  promptDefaults,
  review,
  stage,
}: StagePanelProps) {
  const { format, language, t } = useI18n();
  const defaults = presentPromptDefaults(language, summaryPromptLanguage(profile), promptDefaults);
  if (stage === "transcription") {
    const { vad } = profile.transcription;
    return (
      <>
        <LanguageSelector
          autoLabel={t.profiles.autoDetect}
          label={t.stagePanel.spokenLanguage}
          onChange={(language) =>
            onChange({ ...profile, transcription: { ...profile.transcription, language } })
          }
          value={profile.transcription.language}
        />
        <div className="flex flex-col gap-2.5">
          <Disclosure
            badge={review.size > 0 ? <Badge>{t.stagePanel.review}</Badge> : undefined}
            icon={<AudioLines className="size-4" />}
            summary={
              review.size > 0
                ? t.stagePanel.reviewPending
                : t.stagePanel.vadSummary(
                    vad.enabled,
                    format.decimal(vad.threshold),
                    format.number(vad.speechPadMs),
                  )
            }
            title={t.stagePanel.voiceDetection}
          >
            <VadEditor
              onAcknowledge={onAcknowledge}
              onChange={onChange}
              profile={profile}
              review={review}
            />
          </Disclosure>
          <Disclosure
            icon={<Combine className="size-4" />}
            summary={t.stagePanel.mergeSummary(format.number(profile.transcription.mergeMaxGapMs))}
            title={t.stagePanel.speechMerge}
          >
            <MergeSettings onChange={onChange} profile={profile} />
          </Disclosure>
          <Disclosure
            icon={<Settings2 className="size-4" />}
            summary={t.stagePanel.transcriptionTuningSummary}
            title={t.stagePanel.modelTuning}
          >
            <TranscriptionTuning onChange={onChange} profile={profile} />
          </Disclosure>
        </div>
      </>
    );
  }
  const tuning = (
    <Disclosure
      icon={<Settings2 className="size-4" />}
      summary={t.stagePanel.phaseTuningSummary}
      title={t.stagePanel.modelTuning}
    >
      <PhaseSettings onChange={onChange} phase={stage} profile={profile} />
    </Disclosure>
  );
  if (stage === "refinement") {
    return (
      <>
        <PromptEditor
          defaultPrompt={defaults?.refinement}
          label={t.stagePanel.refinementPrompt}
          mode={profile.promptModes.refinement}
          onChange={({ mode, value }) =>
            onChange({
              ...profile,
              promptModes: { ...profile.promptModes, refinement: mode },
              refinement: { ...profile.refinement, prompt: value },
            })
          }
          value={profile.refinement.prompt}
        />
        {tuning}
      </>
    );
  }
  return (
    <>
      <LanguageSelector
        autoLabel={t.profiles.sameAsMeeting}
        label={t.stagePanel.summaryLanguage}
        onChange={(language) => onChange({ ...profile, language })}
        value={profile.language}
      />
      <PromptEditor
        defaultPrompt={defaults?.summaryExtraction}
        label={t.stagePanel.extractionPrompt}
        mode={profile.promptModes.summaryExtraction}
        onChange={({ mode, value }) =>
          onChange({
            ...profile,
            promptModes: { ...profile.promptModes, summaryExtraction: mode },
            summary: { ...profile.summary, extractionPrompt: value },
          })
        }
        value={profile.summary.extractionPrompt}
      />
      <PromptEditor
        defaultPrompt={defaults?.summaryConsolidation}
        label={t.stagePanel.consolidationPrompt}
        mode={profile.promptModes.summaryConsolidation}
        onChange={({ mode, value }) =>
          onChange({
            ...profile,
            promptModes: { ...profile.promptModes, summaryConsolidation: mode },
            summary: { ...profile.summary, consolidationPrompt: value },
          })
        }
        value={profile.summary.consolidationPrompt}
      />
      {tuning}
    </>
  );
}
