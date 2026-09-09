import { AutoNumberField, NumberField } from "../../components/number-field";
import { Toggle } from "../../components/ui";
import type { Profile } from "../../lib/api";

export function VadEditor({
  onChange,
  profile,
}: {
  onChange: (profile: unknown) => void;
  profile: Profile;
}) {
  const vad = profile.transcription.vad;
  const replace = (nextVad: unknown) =>
    onChange({ ...profile, transcription: { ...profile.transcription, vad: nextVad } });
  return (
    <div className="flex flex-col gap-3">
      <Toggle
        checked={vad.enabled}
        description="Quando desativado, o áudio completo segue direto para a transcrição."
        label="Detectar presença de voz"
        onChange={(enabled) => replace({ ...vad, enabled })}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField
          hint="Probabilidade mínima para iniciar uma região de fala."
          label="Limiar de fala"
          max={1}
          min={profile.profileType === "external" ? 0.15 : 0}
          onCommit={(threshold) => replace({ ...vad, threshold })}
          step={0.01}
          value={vad.threshold}
        />
        <NumberField
          hint="Ignora eventos de voz menores que esta duração."
          label="Fala mínima (ms)"
          max={2_000}
          min={profile.profileType === "external" ? 32 : 0}
          onCommit={(minSpeechDurationMs) => replace({ ...vad, minSpeechDurationMs })}
          value={vad.minSpeechDurationMs}
        />
        <NumberField
          hint="Mantém áudio ao redor das bordas para evitar palavras cortadas."
          label="Margem de fala (ms)"
          max={5_000}
          min={0}
          onCommit={(speechPadMs) => replace({ ...vad, speechPadMs })}
          value={vad.speechPadMs}
        />
        {profile.profileType === "external" ? (
          <NumberField
            hint="Silêncio contínuo necessário para encerrar uma região."
            label="Silêncio para encerrar (ms)"
            max={10_000}
            min={32}
            onCommit={(minSilenceDurationMs) => replace({ ...vad, minSilenceDurationMs })}
            value={profile.transcription.vad.minSilenceDurationMs}
          />
        ) : (
          <AutoNumberField
            hint={'Use "auto" para preservar 2.000 ms no modo normal e 160 ms em lote.'}
            label="Silêncio para encerrar"
            onCommit={(minSilenceDurationMs) => replace({ ...vad, minSilenceDurationMs })}
            value={profile.transcription.vad.minSilenceDurationMs}
          />
        )}
        <AutoNumberField
          hint={'Use "auto" para manter 0,15 abaixo do limiar de fala.'}
          label="Limiar negativo"
          onCommit={(negativeSpeechThreshold) => replace({ ...vad, negativeSpeechThreshold })}
          value={vad.negativeSpeechThreshold}
        />
        {profile.profileType === "local" && (
          <AutoNumberField
            hint={'Use "auto" para preservar o limite próprio do modo de execução.'}
            label="Duração máxima da fala (s)"
            onCommit={(maxSpeechDurationSeconds) => replace({ ...vad, maxSpeechDurationSeconds })}
            value={profile.transcription.vad.maxSpeechDurationSeconds}
          />
        )}
      </div>
    </div>
  );
}
