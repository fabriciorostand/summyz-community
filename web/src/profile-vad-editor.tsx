import type { Profile } from "./api";
import { Field, Toggle } from "./components";

export function VadEditor({
  onChange,
  profile,
}: {
  onChange: (profile: unknown) => void;
  profile: Profile;
}) {
  const vad = profile.transcription.vad;
  const replace = (nextVad: unknown) => {
    onChange({
      ...profile,
      transcription: { ...profile.transcription, vad: nextVad },
    });
  };
  return (
    <div className="vad-editor stack">
      <Toggle
        checked={vad.enabled}
        description="Quando desativado, o áudio completo segue diretamente para a transcrição."
        label="Detectar presença de voz"
        onChange={(enabled) => replace({ ...vad, enabled })}
      />
      <div className="form-grid">
        <Field
          hint="Probabilidade mínima para iniciar uma região de fala."
          label="Limiar de fala"
          max={1}
          min={profile.profileType === "external" ? 0.15 : 0}
          step={0.01}
          type="number"
          value={vad.threshold}
          onChange={(event) => replace({ ...vad, threshold: event.currentTarget.valueAsNumber })}
        />
        <Field
          hint="Ignora eventos de voz menores que esta duração."
          label="Fala mínima (ms)"
          max={2_000}
          min={profile.profileType === "external" ? 32 : 0}
          type="number"
          value={vad.minSpeechDurationMs}
          onChange={(event) =>
            replace({ ...vad, minSpeechDurationMs: event.currentTarget.valueAsNumber })
          }
        />
        <Field
          hint="Mantém áudio ao redor das bordas para evitar palavras cortadas."
          label="Margem de fala (ms)"
          max={5_000}
          min={0}
          type="number"
          value={vad.speechPadMs}
          onChange={(event) => replace({ ...vad, speechPadMs: event.currentTarget.valueAsNumber })}
        />
        {profile.profileType === "external" ? (
          <Field
            hint="Silêncio contínuo necessário para encerrar uma região."
            label="Silêncio para encerrar (ms)"
            max={10_000}
            min={32}
            type="number"
            value={profile.transcription.vad.minSilenceDurationMs}
            onChange={(event) =>
              replace({ ...vad, minSilenceDurationMs: event.currentTarget.valueAsNumber })
            }
          />
        ) : (
          <Field
            hint="Use “auto” para preservar 2.000 ms no modo normal e 160 ms em lote."
            label="Silêncio para encerrar"
            value={profile.transcription.vad.minSilenceDurationMs}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              replace({ ...vad, minSilenceDurationMs: raw === "auto" ? "auto" : Number(raw) });
            }}
          />
        )}
      </div>
      <details className="advanced-settings">
        <summary>Configurações avançadas</summary>
        <div className="form-grid">
          <Field
            hint="Use “auto” para manter 0,15 abaixo do limiar de fala."
            label="Limiar negativo"
            value={vad.negativeSpeechThreshold}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              replace({
                ...vad,
                negativeSpeechThreshold: raw === "auto" ? "auto" : Number(raw),
              });
            }}
          />
          {profile.profileType === "local" && (
            <Field
              hint="Use “auto” para preservar o limite próprio do modo de execução."
              label="Duração máxima da fala (s)"
              value={profile.transcription.vad.maxSpeechDurationSeconds}
              onChange={(event) => {
                const raw = event.currentTarget.value;
                replace({
                  ...vad,
                  maxSpeechDurationSeconds: raw === "auto" ? "auto" : Number(raw),
                });
              }}
            />
          )}
        </div>
      </details>
    </div>
  );
}
