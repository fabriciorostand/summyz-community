import { describe, expect, it } from "vitest";

import {
  createMeetingAiConfiguration,
  hasInsufficientLocalHardware,
  type AiConfigurationConfig,
} from "../src/local-ai/meeting-ai-configuration.js";

const gibibyte = 1_024 ** 3;

describe("createMeetingAiConfiguration", () => {
  it("fixa modelos remotos explícitos e resolve modelos locais automáticos por fase", () => {
    const configuration = createMeetingAiConfiguration(
      {
        fasterWhisperModel: "auto",
        ollamaRefinementModel: "auto",
        ollamaSummaryModel: "unused",
        openRouterSummaryModel: "google/gemini-3.7-flash",
        refinementProvider: "ollama",
        summaryLanguage: "auto",
        summaryProvider: "openrouter",
        transcriptionLanguage: "auto",
        transcriptionProvider: "faster-whisper",
      } satisfies AiConfigurationConfig,
      { cpuCores: 8, memoryBytes: 16 * gibibyte },
    );

    expect(configuration).toMatchObject({
      refinement: { model: "qwen3:8b", provider: "ollama", status: "selected" },
      selectorVersion: 1,
      summary: {
        language: "auto",
        model: "google/gemini-3.7-flash",
        provider: "openrouter",
        status: "selected",
      },
      transcription: {
        language: "auto",
        model: "medium",
        provider: "faster-whisper",
        status: "selected",
      },
    });
  });

  it("fixa o menor modelo local com aviso quando o hardware é insuficiente", () => {
    const configuration = createMeetingAiConfiguration(
      {
        fasterWhisperModel: "unused",
        ollamaRefinementModel: "unused",
        ollamaSummaryModel: "auto",
        openRouterRefinementModel: "google/gemini-3.7-flash",
        openRouterTranscriptionModel: "openai/whisper-1",
        refinementProvider: "openrouter",
        summaryLanguage: "auto",
        summaryProvider: "ollama",
        transcriptionLanguage: "auto",
        transcriptionProvider: "openrouter",
      } satisfies AiConfigurationConfig,
      { cpuCores: 1, memoryBytes: gibibyte },
    );

    expect(configuration.summary).toEqual({
      hardwareWarning: true,
      language: "auto",
      model: "qwen3:4b",
      provider: "ollama",
      requestedModel: "auto",
      status: "selected",
    });
    expect(hasInsufficientLocalHardware(configuration)).toBe(true);
  });
});
