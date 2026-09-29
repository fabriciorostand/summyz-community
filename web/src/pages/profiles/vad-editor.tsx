import { AutoNumberField, NumberField } from "../../components/number-field";
import { Button, Toggle } from "../../components/ui";
import { type I18nSnapshot, useI18n } from "../../i18n/store";
import type { Profile } from "../../lib/api";
import type { ReviewNote, StageReview } from "./profile-stages";

const noReview: StageReview = new Map();

function reviewLabel(path: string, { t }: Pick<I18nSnapshot, "t">): string {
  if (path === "transcription.vad.minSilenceDurationMs") return t.vad.silenceMs;
  if (path === "transcription.vad.minSpeechDurationMs") return t.vad.minSpeech;
  if (path === "transcription.vad.threshold") return t.vad.threshold;
  return path;
}

function reviewMessage(
  path: string,
  note: ReviewNote,
  { format, t }: Pick<I18nSnapshot, "format" | "t">,
): string {
  if (note.kind === "auto") return t.vad.review.autoSilence(format.number(note.fallback));
  return path === "transcription.vad.threshold"
    ? t.vad.review.minimumThreshold(format.decimal(note.minimum))
    : t.vad.review.minimumMs(format.number(note.minimum));
}

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
  const i18n = useI18n();
  const { t } = i18n;
  const { transcription } = profile;
  const local = transcription.provider === "faster-whisper";
  const vad = transcription.vad;
  const replace = (nextVad: unknown) =>
    onChange({ ...profile, transcription: { ...transcription, vad: nextVad } });
  return (
    <div className="flex flex-col gap-3">
      {[...review].map(([path, note]) => {
        const label = reviewLabel(path, i18n);
        return (
          <div
            className="flex flex-col items-start gap-1.5 rounded-lg border border-warn/40 bg-warn/10 px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-secondary"
            key={path}
          >
            <strong className="text-[12.5px] font-medium text-ink">{label}</strong>
            <span>{reviewMessage(path, note, i18n)}</span>
            <Button
              aria-label={t.vad.keepValueOf(label)}
              className="px-2.5 py-1 text-[12px]"
              onClick={() => onAcknowledge(path)}
              type="button"
              variant="secondary"
            >
              {t.vad.keepThisValue}
            </Button>
          </div>
        );
      })}
      <Toggle
        checked={vad.enabled}
        description={t.vad.detectDescription}
        label={t.vad.detect}
        onChange={(enabled) => replace({ ...vad, enabled })}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <NumberField
          hint={t.vad.thresholdHint}
          label={t.vad.threshold}
          max={1}
          min={local ? 0 : 0.15}
          onCommit={(threshold) => replace({ ...vad, threshold })}
          step={0.01}
          value={vad.threshold}
        />
        <NumberField
          hint={t.vad.minSpeechHint}
          label={t.vad.minSpeech}
          max={2_000}
          min={local ? 0 : 32}
          onCommit={(minSpeechDurationMs) => replace({ ...vad, minSpeechDurationMs })}
          value={vad.minSpeechDurationMs}
        />
        <NumberField
          hint={t.vad.paddingHint}
          label={t.vad.padding}
          max={5_000}
          min={0}
          onCommit={(speechPadMs) => replace({ ...vad, speechPadMs })}
          value={vad.speechPadMs}
        />
        {transcription.provider === "faster-whisper" ? (
          <AutoNumberField
            hint={t.vad.silenceAutoHint}
            label={t.vad.silence}
            onCommit={(minSilenceDurationMs) =>
              replace({ ...transcription.vad, minSilenceDurationMs })
            }
            value={transcription.vad.minSilenceDurationMs}
          />
        ) : (
          <NumberField
            hint={t.vad.silenceHint}
            label={t.vad.silenceMs}
            max={10_000}
            min={32}
            onCommit={(minSilenceDurationMs) =>
              replace({ ...transcription.vad, minSilenceDurationMs })
            }
            value={transcription.vad.minSilenceDurationMs}
          />
        )}
        <AutoNumberField
          hint={t.vad.negativeThresholdHint}
          label={t.vad.negativeThreshold}
          onCommit={(negativeSpeechThreshold) => replace({ ...vad, negativeSpeechThreshold })}
          value={vad.negativeSpeechThreshold}
        />
        {transcription.provider === "faster-whisper" && (
          <AutoNumberField
            hint={t.vad.maxSpeechHint}
            label={t.vad.maxSpeech}
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
