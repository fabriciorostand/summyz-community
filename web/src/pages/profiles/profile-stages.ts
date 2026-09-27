import type { Profile, ProfileType } from "../../lib/api";

export const stages = ["transcription", "refinement", "summary"] as const;
export type Stage = (typeof stages)[number];
export type Execution = "local" | "api";
/** Voice detection settings that no longer fit after transcription moved to the external API. */
export type StageReview = ReadonlyMap<string, string>;

export const stageTitles: Record<Stage, string> = {
  refinement: "Refinamento",
  summary: "Resumo",
  transcription: "Transcrição",
};

export const localEngines: Record<Stage, "faster-whisper" | "Ollama"> = {
  refinement: "Ollama",
  summary: "Ollama",
  transcription: "faster-whisper",
};

export function localProviderOf(stage: Stage): "faster-whisper" | "ollama" {
  return stage === "transcription" ? "faster-whisper" : "ollama";
}

export function executionOf(profile: Profile, stage: Stage): Execution | null {
  const { provider } = profile[stage];
  if (provider === null) return null;
  return provider === "openrouter" ? "api" : "local";
}

/** Same rule the server applies, so the badge follows the edit before it is saved. */
export function profileTypeOf(profile: Profile): ProfileType {
  const executions = stages.map((stage) => executionOf(profile, stage));
  if (executions.includes(null)) return null;
  if (executions.every((execution) => execution === "api")) return "external";
  if (executions.every((execution) => execution === "local")) return "local";
  return "hybrid";
}

export function incompleteStages(profile: Profile): Stage[] {
  return stages.filter(
    (stage) => profile[stage].provider === null || profile[stage].model === null,
  );
}

interface ExecutionChange {
  needsModel: boolean;
  profile: Profile;
  review: StageReview;
}

/**
 * Moves one stage to another execution. Going back to the saved execution restores the saved
 * stage; any other move empties the model so the person picks one from the new catalog.
 */
export function changeExecution(
  draft: Profile,
  saved: Profile,
  review: StageReview,
  stage: Stage,
  execution: Execution,
): ExecutionChange {
  if (executionOf(draft, stage) === execution) return { needsModel: false, profile: draft, review };
  const remaining = new Map([...review].filter(([path]) => !path.startsWith(`${stage}.`)));
  if (executionOf(saved, stage) === execution) {
    return { needsModel: false, profile: { ...draft, [stage]: saved[stage] }, review: remaining };
  }
  if (stage === "transcription") {
    const moved = moveTranscription(draft.transcription, execution);
    for (const [path, message] of moved.review) remaining.set(path, message);
    return {
      needsModel: true,
      profile: { ...draft, transcription: moved.stage },
      review: remaining,
    };
  }
  const provider = execution === "api" ? "openrouter" : "ollama";
  const next: Profile =
    stage === "refinement"
      ? { ...draft, refinement: { ...draft.refinement, model: null, provider } }
      : { ...draft, summary: { ...draft.summary, model: null, provider } };
  return { needsModel: true, profile: next, review: remaining };
}

const externalMinimums = {
  minSilenceDurationMs: 32,
  minSpeechDurationMs: 32,
  threshold: 0.15,
} as const;
const externalSilenceDefault = 768;

function moveTranscription(
  current: Profile["transcription"],
  execution: Execution,
): { review: Map<string, string>; stage: Profile["transcription"] } {
  const review = new Map<string, string>();
  const { maxSpeechDurationSeconds, minSilenceDurationMs, ...vad } = {
    maxSpeechDurationSeconds: "auto" as const,
    ...current.vad,
  };
  const { batchSize: _batchSize, ...base } = { batchSize: "auto" as const, ...current };
  if (execution === "local") {
    return {
      review,
      stage: {
        ...base,
        batchSize: current.provider === "faster-whisper" ? current.batchSize : "auto",
        model: null,
        provider: "faster-whisper",
        vad: { ...vad, maxSpeechDurationSeconds, minSilenceDurationMs },
      },
    };
  }
  const silence =
    typeof minSilenceDurationMs === "number" ? minSilenceDurationMs : externalSilenceDefault;
  if (minSilenceDurationMs === "auto") {
    review.set(
      "transcription.vad.minSilenceDurationMs",
      `A API externa não aceita "auto" aqui. Usamos ${String(externalSilenceDefault)} ms; confirme ou ajuste.`,
    );
  }
  const minimumSilence = Math.max(silence, externalMinimums.minSilenceDurationMs);
  if (silence < externalMinimums.minSilenceDurationMs) {
    review.set(
      "transcription.vad.minSilenceDurationMs",
      `A API externa exige pelo menos ${String(externalMinimums.minSilenceDurationMs)} ms. Ajustamos o valor; confirme ou ajuste.`,
    );
  }
  if (vad.minSpeechDurationMs < externalMinimums.minSpeechDurationMs) {
    review.set(
      "transcription.vad.minSpeechDurationMs",
      `A API externa exige pelo menos ${String(externalMinimums.minSpeechDurationMs)} ms. Ajustamos o valor; confirme ou ajuste.`,
    );
  }
  if (vad.threshold < externalMinimums.threshold) {
    review.set(
      "transcription.vad.threshold",
      "A API externa exige um limiar de pelo menos 0,15. Ajustamos o valor; confirme ou ajuste.",
    );
  }
  return {
    review,
    stage: {
      ...base,
      model: null,
      provider: "openrouter",
      vad: {
        ...vad,
        minSilenceDurationMs: minimumSilence,
        minSpeechDurationMs: Math.max(
          vad.minSpeechDurationMs,
          externalMinimums.minSpeechDurationMs,
        ),
        threshold: Math.max(vad.threshold, externalMinimums.threshold),
      },
    },
  };
}

const reviewedMinimums = new Map<string, number>(
  Object.entries(externalMinimums).map(([field, minimum]) => [
    `transcription.vad.${field}`,
    minimum,
  ]),
);

/** A flagged value stops needing review once it is valid for the external API. */
export function resolveReview(review: StageReview, path: string, value: unknown): StageReview {
  if (!review.has(path)) return review;
  const minimum = reviewedMinimums.get(path);
  if (minimum !== undefined && (typeof value !== "number" || value < minimum)) return review;
  return acknowledgeReview(review, path);
}

export function acknowledgeReview(review: StageReview, path: string): StageReview {
  const next = new Map(review);
  next.delete(path);
  return next;
}
