import { AutoNumberField, NumberField } from "../../components/number-field";
import { Button, Toggle } from "../../components/ui";
import type { Profile } from "../../lib/api";
import type { StageReview } from "./profile-stages";

const reviewedLabels: Record<string, string> = {
  "transcription.vad.minSilenceDurationMs": "Silêncio para encerrar (ms)",
  "transcription.vad.minSpeechDurationMs": "Fala mínima (ms)",
  "transcription.vad.threshold": "Limiar de fala",
};

const noReview: StageReview = new Map();

export function VadEditor({
  onAcknowledge = () => undefined,
  onChange,
  profile,
  review = noReview,
}: {
  onAcknowledge?: (path: string) => void;
  onChange: (profile: unknown) => void;
  profile: Profile;
  review?: StageReview;
}) {
  const { transcription } = profile;
  const local = transcription.provider === "faster-whisper";
  const vad = transcription.vad;
  const replace = (nextVad: unknown) =>
    onChange({ ...profile, transcription: { ...transcription, vad: nextVad } });
  return (
    <div className="flex flex-col gap-3">
      {[...review].map(([path, message]) => {
        const label = reviewedLabels[path] ?? path;
        return (
          <div
            className="flex flex-col items-start gap-1.5 rounded-lg border border-warn/40 bg-warn/10 px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-secondary"
            key={path}
          >
            <strong className="text-[12.5px] font-medium text-ink">{label}</strong>
            <span>{message}</span>
            <Button
              aria-label={`Manter o valor de ${label}`}
              className="px-2.5 py-1 text-[12px]"
              onClick={() => onAcknowledge(path)}
              type="button"
              variant="secondary"
            >
              Manter este valor
            </Button>
          </div>
        );
      })}
      <Toggle
        checked={vad.enabled}
        description="Quando desativado, o áudio completo segue direto para a transcrição."
        label="Detectar presença de voz"
        onChange={(enabled) => replace({ ...vad, enabled })}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <NumberField
          hint="Probabilidade mínima para iniciar uma região de fala."
          label="Limiar de fala"
          max={1}
          min={local ? 0 : 0.15}
          onCommit={(threshold) => replace({ ...vad, threshold })}
          step={0.01}
          value={vad.threshold}
        />
        <NumberField
          hint="Ignora eventos de voz menores que esta duração."
          label="Fala mínima (ms)"
          max={2_000}
          min={local ? 0 : 32}
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
        {transcription.provider === "faster-whisper" ? (
          <AutoNumberField
            hint={'Use "auto" para preservar 2.000 ms no modo normal e 160 ms em lote.'}
            label="Silêncio para encerrar"
            onCommit={(minSilenceDurationMs) =>
              replace({ ...transcription.vad, minSilenceDurationMs })
            }
            value={transcription.vad.minSilenceDurationMs}
          />
        ) : (
          <NumberField
            hint="Silêncio contínuo necessário para encerrar uma região."
            label="Silêncio para encerrar (ms)"
            max={10_000}
            min={32}
            onCommit={(minSilenceDurationMs) =>
              replace({ ...transcription.vad, minSilenceDurationMs })
            }
            value={transcription.vad.minSilenceDurationMs}
          />
        )}
        <AutoNumberField
          hint={'Use "auto" para manter 0,15 abaixo do limiar de fala.'}
          label="Limiar negativo"
          onCommit={(negativeSpeechThreshold) => replace({ ...vad, negativeSpeechThreshold })}
          value={vad.negativeSpeechThreshold}
        />
        {transcription.provider === "faster-whisper" && (
          <AutoNumberField
            hint={'Use "auto" para preservar o limite próprio do modo de execução.'}
            label="Duração máxima da fala (s)"
            onCommit={(maxSpeechDurationSeconds) =>
              replace({ ...transcription.vad, maxSpeechDurationSeconds })
            }
            value={transcription.vad.maxSpeechDurationSeconds}
          />
        )}
      </div>
    </div>
  );
}
