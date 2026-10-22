import { AutoNumberField, NumberField, OptionalNumberField } from "../../components/number-field";
import { Toggle } from "../../components/ui";
import { useI18n } from "../../i18n/store";
import type { Profile } from "../../lib/api";

type Phase = "refinement" | "summary";

/** Chunking and sampling knobs shared by the refinement and summary phases. */
export function PhaseSettings({
  onChange,
  phase,
  profile,
}: {
  onChange: (profile: unknown) => void;
  phase: Phase;
  profile: Profile;
}) {
  const { t } = useI18n();
  const value = profile[phase];
  const replace = (next: typeof value) =>
    onChange(
      phase === "refinement" ? { ...profile, refinement: next } : { ...profile, summary: next },
    );
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <OptionalNumberField
        hint={t.generation.temperatureHint}
        label={t.generation.temperature}
        max={2}
        min={0}
        onCommit={(temperature) =>
          replace({ ...value, generation: { ...value.generation, temperature } })
        }
        step={0.1}
        value={value.generation.temperature}
      />
      <OptionalNumberField
        hint={t.generation.seedHint}
        label={t.generation.seed}
        onCommit={(seed) => {
          const { seed: _seed, ...withoutSeed } = value.generation;
          replace({
            ...value,
            generation: seed === undefined ? withoutSeed : { ...value.generation, seed },
          });
        }}
        value={value.generation.seed}
      />
      <div className="sm:col-span-2">
        <NumberField
          hint={t.generation.chunkHint}
          label={t.generation.chunk}
          min={1_000}
          onCommit={(maxChunkCharacters) => replace({ ...value, maxChunkCharacters })}
          value={value.maxChunkCharacters}
        />
      </div>
      <div className="sm:col-span-2">
        <Toggle
          checked={value.generation.think ?? false}
          description={t.generation.thinkDescription}
          label={t.generation.think}
          onChange={(think) => replace({ ...value, generation: { ...value.generation, think } })}
        />
      </div>
    </div>
  );
}

/** How the speech of one person is stitched together after transcription. */
export function MergeSettings({
  onChange,
  profile,
}: {
  onChange: (profile: unknown) => void;
  profile: Profile;
}) {
  const { t } = useI18n();
  const value = profile.transcription;
  const replace = (next: unknown) => onChange({ ...profile, transcription: next });
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <NumberField
        hint={t.generation.mergeGapHint}
        label={t.generation.mergeGap}
        min={0}
        onCommit={(mergeMaxGapMs) => replace({ ...value, mergeMaxGapMs })}
        value={value.mergeMaxGapMs}
      />
      <NumberField
        label={t.generation.interSpeechSilence}
        min={0}
        onCommit={(interSpeechSilenceMs) => replace({ ...value, interSpeechSilenceMs })}
        value={value.interSpeechSilenceMs}
      />
    </div>
  );
}

export function TranscriptionTuning({
  onChange,
  profile,
}: {
  onChange: (profile: unknown) => void;
  profile: Profile;
}) {
  const { t } = useI18n();
  const value = profile.transcription;
  const replace = (next: unknown) => onChange({ ...profile, transcription: next });
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <OptionalNumberField
        hint={t.generation.temperatureHint}
        label={t.generation.temperature}
        max={1}
        min={0}
        onCommit={(temperature) => {
          const { temperature: _temperature, ...withoutTemperature } = value;
          replace(temperature === undefined ? withoutTemperature : { ...value, temperature });
        }}
        step={0.1}
        value={value.temperature}
      />
      {value.provider === "faster-whisper" && (
        <AutoNumberField
          hint={t.generation.batchHint}
          label={t.generation.batch}
          onCommit={(batchSize) => replace({ ...value, batchSize })}
          value={value.batchSize}
        />
      )}
    </div>
  );
}
