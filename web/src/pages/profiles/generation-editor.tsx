import { AutoNumberField, NumberField, OptionalNumberField } from "../../components/number-field";
import { Field, Toggle } from "../../components/ui";
import type { Profile } from "../../lib/api";

type Phase = "refinement" | "summary";

/** Model, chunking and sampling knobs shared by the refinement and summary phases. */
export function PhaseSettings({
  onChange,
  phase,
  profile,
}: {
  onChange: (profile: unknown) => void;
  phase: Phase;
  profile: Profile;
}) {
  const value = profile[phase];
  const replace = (next: typeof value) =>
    onChange(
      phase === "refinement" ? { ...profile, refinement: next } : { ...profile, summary: next },
    );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field
        label="Modelo"
        onChange={(event) => replace({ ...value, model: event.currentTarget.value || null })}
        placeholder={profile.profileType === "local" ? "qwen3:4b" : "vendor/model"}
        value={value.model ?? ""}
      />
      <NumberField
        label="Máximo por trecho"
        min={1_000}
        onCommit={(maxChunkCharacters) => replace({ ...value, maxChunkCharacters })}
        value={value.maxChunkCharacters}
      />
      <OptionalNumberField
        label="Temperatura"
        max={2}
        min={0}
        onCommit={(temperature) =>
          replace({ ...value, generation: { ...value.generation, temperature } })
        }
        step={0.1}
        value={value.generation.temperature}
      />
      <OptionalNumberField
        label="Seed"
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
        <Toggle
          checked={value.generation.think ?? false}
          description="Encaminha think=true quando o provedor oferece suporte."
          label="Raciocínio do modelo"
          onChange={(think) => replace({ ...value, generation: { ...value.generation, think } })}
        />
      </div>
    </div>
  );
}

export function TranscriptionSettings({
  onChange,
  profile,
}: {
  onChange: (profile: unknown) => void;
  profile: Profile;
}) {
  const value = profile.transcription;
  const replace = (next: unknown) => onChange({ ...profile, transcription: next });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <NumberField
        label="Intervalo máximo de união (ms)"
        min={0}
        onCommit={(mergeMaxGapMs) => replace({ ...value, mergeMaxGapMs })}
        value={value.mergeMaxGapMs}
      />
      <NumberField
        label="Silêncio entre falas (ms)"
        min={0}
        onCommit={(interSpeechSilenceMs) => replace({ ...value, interSpeechSilenceMs })}
        value={value.interSpeechSilenceMs}
      />
      <OptionalNumberField
        label="Temperatura"
        max={1}
        min={0}
        onCommit={(temperature) => {
          const { temperature: _temperature, ...withoutTemperature } = value;
          replace(temperature === undefined ? withoutTemperature : { ...value, temperature });
        }}
        step={0.1}
        value={value.temperature}
      />
      {profile.profileType === "local" && (
        <AutoNumberField
          hint={'Use "auto" para deixar o runtime decidir.'}
          label="Tamanho do lote"
          onCommit={(batchSize) => replace({ ...value, batchSize })}
          value={profile.transcription.batchSize}
        />
      )}
    </div>
  );
}
