import { describe, expect, it } from "vitest";

import type { Profile } from "../../lib/api";
import {
  acknowledgeReview,
  changeExecution,
  executionOf,
  incompleteStages,
  profileTypeOf,
  resolveReview,
  type StageReview,
} from "./profile-stages";

function externalProfile(): Profile {
  return {
    language: "auto",
    promptModes: {
      refinement: "custom",
      summaryConsolidation: "custom",
      summaryExtraction: "custom",
      transcription: "default",
    },
    name: "Perfil 1",
    profileId: "p1",
    profileType: "external",
    refinement: {
      generation: { seed: 0, temperature: 0 },
      maxChunkCharacters: 500_000,
      model: "google/gemini-3.7-flash",
      prompt: "Revise.",
      provider: "openrouter",
    },
    summary: {
      consolidationPrompt: "Consolide.",
      extractionPrompt: "Extraia.",
      generation: {},
      maxChunkCharacters: 500_000,
      model: "google/gemini-3.7-flash",
      provider: "openrouter",
    },
    transcription: {
      interSpeechSilenceMs: 0,
      language: "pt-BR",
      mergeMaxGapMs: 2_000,
      model: "openai/whisper-large-v3",
      prompt: null,
      provider: "openrouter",
      temperature: 0,
      vad: {
        enabled: true,
        minSilenceDurationMs: 768,
        minSpeechDurationMs: 96,
        negativeSpeechThreshold: "auto",
        speechPadMs: 96,
        threshold: 0.5,
      },
    },
  };
}

function localTranscription(): Profile["transcription"] {
  return {
    batchSize: "auto",
    interSpeechSilenceMs: 0,
    language: "pt-BR",
    mergeMaxGapMs: 2_000,
    model: "large-v3",
    prompt: null,
    provider: "faster-whisper",
    device: "auto",
    vad: {
      enabled: true,
      maxSpeechDurationSeconds: "auto",
      minSilenceDurationMs: "auto",
      minSpeechDurationMs: 0,
      negativeSpeechThreshold: "auto",
      speechPadMs: 400,
      threshold: 0.1,
    },
  };
}

const noReview: StageReview = new Map();

describe("profile stages", () => {
  it("calculates the profile type from where each stage runs", () => {
    const profile = externalProfile();
    expect(profileTypeOf(profile)).toBe("external");

    const hybrid = { ...profile, transcription: localTranscription() };
    expect(profileTypeOf(hybrid)).toBe("hybrid");

    const local: Profile = {
      ...hybrid,
      refinement: { ...hybrid.refinement, provider: "ollama", device: "auto" },
      summary: { ...hybrid.summary, provider: "ollama", device: "auto" },
    };
    expect(profileTypeOf(local)).toBe("local");

    const unset: Profile = {
      ...profile,
      summary: { ...profile.summary, provider: null, device: undefined },
    };
    expect(profileTypeOf(unset)).toBeNull();
  });

  it("reads the execution chosen for a stage", () => {
    const profile = externalProfile();
    expect(executionOf(profile, "summary")).toBe("api");
    expect(executionOf({ ...profile, transcription: localTranscription() }, "transcription")).toBe(
      "local",
    );
    expect(
      executionOf(
        { ...profile, refinement: { ...profile.refinement, provider: null, device: undefined } },
        "refinement",
      ),
    ).toBeNull();
  });

  it("empties the model when a stage moves to a new execution", () => {
    const saved = externalProfile();

    const change = changeExecution(saved, saved, noReview, "summary", "local");

    expect(change.profile.summary.provider).toBe("ollama");
    expect(change.profile.summary.model).toBeNull();
    expect(change.profile.summary.extractionPrompt).toBe("Extraia.");
    expect(change.needsModel).toBe(true);
  });

  it("restores the saved stage when the execution goes back to the saved one", () => {
    const saved = externalProfile();
    const moved = changeExecution(saved, saved, noReview, "summary", "local");

    const back = changeExecution(moved.profile, saved, moved.review, "summary", "api");

    expect(back.profile.summary).toEqual(saved.summary);
    expect(back.needsModel).toBe(false);
  });

  it("leaves the stage untouched when the execution does not change", () => {
    const saved = externalProfile();

    const change = changeExecution(saved, saved, noReview, "refinement", "api");

    expect(change.profile).toBe(saved);
    expect(change.needsModel).toBe(false);
  });

  it("adds the local-only transcription settings when transcription moves to this machine", () => {
    const saved = externalProfile();

    const { profile, review } = changeExecution(saved, saved, noReview, "transcription", "local");

    expect(profile.transcription.provider).toBe("faster-whisper");
    if (profile.transcription.provider !== "faster-whisper") throw new Error("expected local");
    expect(profile.transcription.batchSize).toBe("auto");
    expect(profile.transcription.vad.maxSpeechDurationSeconds).toBe("auto");
    expect(profile.transcription.vad.minSilenceDurationMs).toBe(768);
    expect(review.size).toBe(0);
  });

  it("adjusts voice detection values the external API rejects and flags them for review", () => {
    const saved: Profile = { ...externalProfile(), transcription: localTranscription() };

    const { profile, review } = changeExecution(saved, saved, noReview, "transcription", "api");

    if (profile.transcription.provider !== "openrouter") throw new Error("expected external");
    expect(profile.transcription).not.toHaveProperty("batchSize");
    expect(profile.transcription.vad).not.toHaveProperty("maxSpeechDurationSeconds");
    expect(profile.transcription.vad.minSilenceDurationMs).toBe(768);
    expect(profile.transcription.vad.minSpeechDurationMs).toBe(32);
    expect(profile.transcription.vad.threshold).toBe(0.15);
    expect([...review.keys()]).toEqual([
      "transcription.vad.minSilenceDurationMs",
      "transcription.vad.minSpeechDurationMs",
      "transcription.vad.threshold",
    ]);
    expect(Object.fromEntries(review)).toEqual({
      "transcription.vad.minSilenceDurationMs": { fallback: 768, kind: "auto" },
      "transcription.vad.minSpeechDurationMs": { kind: "minimum", minimum: 32 },
      "transcription.vad.threshold": { kind: "minimum", minimum: 0.15 },
    });
  });

  it("gives the setup profile a local voice detection shape when transcription runs locally", () => {
    const saved = externalProfile();
    if (saved.transcription.provider !== "openrouter") throw new Error("expected external");
    const setup: Profile = {
      ...saved,
      transcription: { ...saved.transcription, model: null, provider: null, device: undefined },
    };

    const { profile, needsModel } = changeExecution(
      setup,
      setup,
      noReview,
      "transcription",
      "local",
    );

    if (profile.transcription.provider !== "faster-whisper") throw new Error("expected local");
    expect(profile.transcription.vad.maxSpeechDurationSeconds).toBe("auto");
    expect(needsModel).toBe(true);
  });

  it("clears a review once the value is valid for the external API or acknowledged", () => {
    const saved: Profile = { ...externalProfile(), transcription: localTranscription() };
    const { review } = changeExecution(saved, saved, noReview, "transcription", "api");

    const afterTooLow = resolveReview(review, "transcription.vad.minSpeechDurationMs", 10);
    expect(afterTooLow.has("transcription.vad.minSpeechDurationMs")).toBe(true);

    const afterValid = resolveReview(review, "transcription.vad.minSpeechDurationMs", 120);
    expect(afterValid.has("transcription.vad.minSpeechDurationMs")).toBe(false);

    const acknowledged = acknowledgeReview(afterValid, "transcription.vad.threshold");
    expect([...acknowledged.keys()]).toEqual(["transcription.vad.minSilenceDurationMs"]);
  });

  it("drops the reviews of a stage when its execution changes again", () => {
    const saved: Profile = { ...externalProfile(), transcription: localTranscription() };
    const moved = changeExecution(saved, saved, noReview, "transcription", "api");

    const back = changeExecution(moved.profile, saved, moved.review, "transcription", "local");

    expect(back.review.size).toBe(0);
  });

  it("lists the stages still missing an execution or a model", () => {
    const profile = externalProfile();
    const partial: Profile = {
      ...profile,
      refinement: { ...profile.refinement, model: null },
      summary: { ...profile.summary, provider: null, device: undefined },
    };

    expect(incompleteStages(profile)).toEqual([]);
    expect(incompleteStages(partial)).toEqual(["refinement", "summary"]);
  });
});
