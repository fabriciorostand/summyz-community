import { AutoNumberField, NumberField, OptionalNumberField } from "../../components/number-field";
import { Toggle } from "../../components/ui";
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
  const value = profile[phase];
  const replace = (next: typeof value) =>
    onChange(
      phase === "refinement" ? { ...profile, refinement: next } : { ...profile, summary: next },
    );
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <OptionalNumberField
        hint="Vazio usa o padrão do provedor. 0 deixa o texto mais previsível."
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
        hint="Com o mesmo seed, o modelo tende a repetir a mesma resposta."
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
        <NumberField
          hint="Reuniões maiores são divididas em chunks deste tamanho."
          label="Tamanho máximo do chunk (caracteres)"
          min={1_000}
          onCommit={(maxChunkCharacters) => replace({ ...value, maxChunkCharacters })}
          value={value.maxChunkCharacters}
        />
      </div>
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

/** How the speech of one person is stitched together after transcription. */
export function MergeSettings({
  onChange,
  profile,
}: {
  onChange: (profile: unknown) => void;
  profile: Profile;
}) {
  const value = profile.transcription;
  const replace = (next: unknown) => onChange({ ...profile, transcription: next });
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <NumberField
        hint="Falas da mesma pessoa separadas por pausas menores viram um só trecho."
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
  const value = profile.transcription;
  const replace = (next: unknown) => onChange({ ...profile, transcription: next });
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <OptionalNumberField
        hint="Vazio usa o padrão do provedor. 0 deixa o texto mais previsível."
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
      {value.provider === "faster-whisper" && (
        <AutoNumberField
          hint={'Use "auto" para deixar o runtime decidir.'}
          label="Tamanho do lote"
          onCommit={(batchSize) => replace({ ...value, batchSize })}
          value={value.batchSize}
        />
      )}
    </div>
  );
}
