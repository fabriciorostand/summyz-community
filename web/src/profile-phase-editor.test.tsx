import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Profile, PromptDefaults } from "./api";
import { PhaseEditor, PromptEditor, TranslationEditor } from "./profile-phase-editor";
import { VadEditor } from "./profile-vad-editor";

const promptDefaults: PromptDefaults = {
  refinement: "Default refinement",
  summaryConsolidation: "Default consolidation",
  summaryExtraction: "Default extraction",
  transcription: null,
};

describe("profile phase editors", () => {
  it("updates every external transcription and VAD boundary", () => {
    const onChange = vi.fn();
    const profile = externalProfile();
    const onTabChange = vi.fn();
    const { rerender } = render(
      <PhaseEditor
        phase="Transcrição"
        profile={profile}
        promptDefaults={promptDefaults}
        transcriptionTab="model"
        onChange={onChange}
        onTranscriptionTabChange={onTabChange}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "VAD" }));
    expect(onTabChange).toHaveBeenCalledWith("vad");
    fireEvent.change(screen.getByLabelText("Modelo"), { target: { value: "new-model" } });
    fireEvent.change(screen.getByLabelText("Intervalo máximo de união (ms)"), {
      target: { value: "3000" },
    });
    fireEvent.change(screen.getByLabelText("Silêncio entre falas (ms)"), {
      target: { value: "250" },
    });
    fireEvent.change(screen.getByLabelText("Temperatura"), { target: { value: "0.2" } });
    fireEvent.blur(screen.getByLabelText(/Opções avançadas do provedor/), {
      target: { value: '{"openrouter":{"language":"pt"}}' },
    });
    fireEvent.blur(screen.getByLabelText(/Opções avançadas do provedor/), {
      target: { value: "not-json" },
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        transcription: expect.objectContaining({ model: "new-model" }),
      }),
    );

    rerender(
      <PhaseEditor
        phase="Transcrição"
        profile={profile}
        promptDefaults={promptDefaults}
        transcriptionTab="vad"
        onChange={onChange}
        onTranscriptionTabChange={onTabChange}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /detectar presença de voz/i }));
    changeNumber("Limiar de fala", "0.7");
    changeNumber("Fala mínima (ms)", "128");
    changeNumber("Margem de fala (ms)", "120");
    changeNumber("Silêncio para encerrar (ms)", "900");
    fireEvent.click(screen.getByText("Configurações avançadas"));
    fireEvent.change(screen.getByLabelText(/Limiar negativo/), { target: { value: "0.3" } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        transcription: expect.objectContaining({
          vad: expect.objectContaining({ negativeSpeechThreshold: 0.3 }),
        }),
      }),
    );
  });

  it("updates local-only transcription and VAD settings", () => {
    const onChange = vi.fn();
    const profile = localProfile();
    const { rerender } = render(
      <PhaseEditor
        phase="Transcrição"
        profile={profile}
        promptDefaults={promptDefaults}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Tamanho do lote"), { target: { value: "16" } });
    fireEvent.change(screen.getByLabelText("Tamanho do lote"), { target: { value: "auto" } });
    fireEvent.change(screen.getByLabelText("Temperatura"), { target: { value: "" } });
    rerender(<VadEditor profile={profile} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/Silêncio para encerrar/), { target: { value: "240" } });
    fireEvent.change(screen.getByLabelText(/Silêncio para encerrar/), {
      target: { value: "auto" },
    });
    fireEvent.change(screen.getByLabelText(/Limiar negativo/), { target: { value: "auto" } });
    fireEvent.change(screen.getByLabelText(/Duração máxima da fala \(s\)/), {
      target: { value: "30" },
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        transcription: expect.objectContaining({
          vad: expect.objectContaining({ maxSpeechDurationSeconds: 30 }),
        }),
      }),
    );
  });

  it("updates refinement, summary, and translation generation settings", () => {
    const onChange = vi.fn();
    const profile = externalProfile("pt-BR");
    const { rerender } = render(
      <PhaseEditor
        phase="Refinamento"
        profile={profile}
        promptDefaults={promptDefaults}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Modelo"), { target: { value: "refinement-model" } });
    changeNumber("Máximo por trecho", "9000");
    changeNumber("Temperatura", "0.4");
    changeNumber("Seed", "42");
    fireEvent.click(screen.getByRole("checkbox", { name: /raciocínio do modelo/i }));

    rerender(
      <PhaseEditor
        phase="Resumo"
        profile={profile}
        promptDefaults={promptDefaults}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Temperatura"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Seed"), { target: { value: "" } });

    rerender(<TranslationEditor profile={profile} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Modelo"), { target: { value: "translation-model" } });
    fireEvent.click(screen.getByRole("button", { name: "Usar modelo do resumo" }));
    fireEvent.click(screen.getByText("Configurações avançadas"));
    changeNumber("Temperatura", "0.1");
    changeNumber("Seed", "7");
    fireEvent.click(screen.getByRole("checkbox", { name: /raciocínio do modelo/i }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        translation: expect.objectContaining({ model: profile.summary.model }),
      }),
    );
  });

  it("requires confirmation to disable or restore a customized prompt", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PromptEditor
        defaultPrompt="Default"
        disabledMessage="Disabled"
        label="Prompt"
        toggleLabel="Use prompt"
        value="Customized"
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Prompt/), { target: { value: "Edited" } });
    fireEvent.click(screen.getByRole("button", { name: "Restaurar padrão" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "Restaurar padrão" }));
    fireEvent.click(screen.getByRole("button", { name: "Restaurar prompt" }));
    expect(onChange).toHaveBeenCalledWith("Default");

    fireEvent.click(screen.getByRole("checkbox", { name: /Use prompt/ }));
    fireEvent.click(screen.getByRole("button", { name: "Desativar prompt" }));
    expect(onChange).toHaveBeenCalledWith(null);

    rerender(
      <PromptEditor
        defaultPrompt="Default"
        disabledMessage="Disabled"
        label="Prompt"
        toggleLabel="Use prompt"
        value={null}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Usar prompt padrão" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Use prompt/ }));
    expect(onChange).toHaveBeenCalledWith("Default");
  });
});

function changeNumber(label: string, value: string): void {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  fireEvent.change(screen.getByLabelText(new RegExp(escapedLabel)), { target: { value } });
}

function externalProfile(language: "auto" | "pt-BR" = "auto"): Profile {
  return {
    language,
    name: "External profile",
    profileId: "external-profile",
    profileType: "external",
    refinement: {
      generation: { seed: 1, temperature: 0.3 },
      maxChunkCharacters: 500_000,
      model: "refinement",
      prompt: "Customized refinement",
      provider: "openrouter",
    },
    summary: {
      consolidationPrompt: "Customized consolidation",
      extractionPrompt: "Customized extraction",
      generation: { seed: 2, temperature: 0.2 },
      maxChunkCharacters: 500_000,
      model: "summary",
      provider: "openrouter",
    },
    transcription: {
      interSpeechSilenceMs: 0,
      mergeMaxGapMs: 2_000,
      model: "transcription",
      prompt: null,
      provider: "openrouter",
      providerOptions: {},
      temperature: 0.1,
      vad: {
        enabled: true,
        minSilenceDurationMs: 768,
        minSpeechDurationMs: 96,
        negativeSpeechThreshold: "auto",
        speechPadMs: 96,
        threshold: 0.5,
      },
    },
    translation:
      language === "auto"
        ? null
        : {
            generation: { seed: 3, temperature: 0.3 },
            model: "translation",
            prompt: "Translate",
            provider: "openrouter",
          },
    userId: "user-id",
  };
}

function localProfile(): Profile {
  const profile = externalProfile();
  return {
    ...profile,
    profileId: "local-profile",
    profileType: "local",
    refinement: { ...profile.refinement, provider: "ollama" },
    summary: { ...profile.summary, provider: "ollama" },
    transcription: {
      ...profile.transcription,
      batchSize: "auto",
      provider: "faster-whisper",
      vad: {
        ...profile.transcription.vad,
        maxSpeechDurationSeconds: "auto",
        minSilenceDurationMs: "auto",
      },
    },
    translation: null,
  };
}
