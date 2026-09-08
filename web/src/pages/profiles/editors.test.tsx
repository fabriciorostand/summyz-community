import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { Profile } from "../../lib/api";
import { aProfile } from "../../tests/test-utils";
import { PhaseSettings, TranscriptionSettings, TranslationSettings } from "./generation-editor";
import { VadEditor } from "./vad-editor";

/** Narrows the fixture so a spread keeps the external branch of the discriminated union. */
function externalProfile(): Extract<Profile, { profileType: "external" }> {
  const profile = aProfile();
  if (profile.profileType !== "external") throw new Error("fixture must be an external profile");
  return profile;
}

const localProfile = aProfile({
  profileType: "local",
  refinement: {
    generation: {},
    maxChunkCharacters: 8_000,
    model: "qwen3:4b",
    prompt: null,
    provider: "ollama",
  },
  summary: {
    consolidationPrompt: null,
    extractionPrompt: null,
    generation: {},
    maxChunkCharacters: 8_000,
    model: "qwen3:4b",
    provider: "ollama",
  },
  transcription: {
    batchSize: "auto",
    interSpeechSilenceMs: 700,
    mergeMaxGapMs: 400,
    model: "large-v3",
    prompt: null,
    provider: "faster-whisper",
    vad: {
      enabled: true,
      maxSpeechDurationSeconds: "auto",
      minSilenceDurationMs: "auto",
      minSpeechDurationMs: 250,
      negativeSpeechThreshold: "auto",
      speechPadMs: 300,
      threshold: 0.5,
    },
  },
  translation: null,
}) as Profile;

/**
 * Text fields that accept "auto" are controlled by the profile, so a test that types into one
 * has to feed the change back in or the input snaps to the old value on every keystroke.
 */
function Controlled({
  initial,
  onChange,
  render: renderEditor,
}: {
  initial: Profile;
  onChange: (profile: Profile) => void;
  render: (profile: Profile, change: (next: unknown) => void) => ReactNode;
}) {
  const [profile, setProfile] = useState(initial);
  return (
    <>
      {renderEditor(profile, (next) => {
        setProfile(next as Profile);
        onChange(next as Profile);
      })}
    </>
  );
}

describe("VadEditor", () => {
  it("turns voice detection off", async () => {
    const onChange = vi.fn();
    render(<VadEditor onChange={onChange} profile={aProfile()} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /Detectar presença de voz/ }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        transcription: expect.objectContaining({
          vad: expect.objectContaining({ enabled: false }),
        }),
      }),
    );
  });

  it("edits the speech padding", async () => {
    const onChange = vi.fn();
    render(<VadEditor onChange={onChange} profile={aProfile()} />);
    await userEvent.type(screen.getByLabelText("Margem de fala (ms)"), "5");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        transcription: expect.objectContaining({
          vad: expect.objectContaining({ speechPadMs: 3005 }),
        }),
      }),
    );
  });

  it("uses a numeric silence field for an external profile", () => {
    render(<VadEditor onChange={vi.fn()} profile={aProfile()} />);
    expect(screen.getByLabelText("Silêncio para encerrar (ms)")).toHaveAttribute("type", "number");
    expect(screen.queryByLabelText("Duração máxima da fala (s)")).toBeNull();
  });

  it("accepts auto for a local profile", async () => {
    const onChange = vi.fn();
    render(
      <Controlled
        initial={localProfile}
        onChange={onChange}
        render={(profile, change) => <VadEditor onChange={change} profile={profile} />}
      />,
    );
    expect(screen.getByLabelText("Silêncio para encerrar")).toHaveValue("auto");
    expect(screen.getByLabelText("Duração máxima da fala (s)")).toHaveValue("auto");
    const field = screen.getByLabelText("Silêncio para encerrar");
    await userEvent.clear(field);
    await userEvent.type(field, "500");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        transcription: expect.objectContaining({
          vad: expect.objectContaining({ minSilenceDurationMs: 500 }),
        }),
      }),
    );
  });

  it("keeps auto for the negative threshold", async () => {
    const onChange = vi.fn();
    render(
      <Controlled
        initial={aProfile()}
        onChange={onChange}
        render={(profile, change) => <VadEditor onChange={change} profile={profile} />}
      />,
    );
    const field = screen.getByLabelText("Limiar negativo");
    await userEvent.clear(field);
    await userEvent.type(field, "auto");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        transcription: expect.objectContaining({
          vad: expect.objectContaining({ negativeSpeechThreshold: "auto" }),
        }),
      }),
    );
  });
});

describe("PhaseSettings", () => {
  it("edits the model of a phase", async () => {
    const onChange = vi.fn();
    render(<PhaseSettings onChange={onChange} phase="summary" profile={aProfile()} />);
    await userEvent.type(screen.getByLabelText("Modelo"), "x");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.objectContaining({ model: "anthropic/claude-sonnet-4x" }),
      }),
    );
  });

  it("clears the model back to the provider default", async () => {
    const onChange = vi.fn();
    render(<PhaseSettings onChange={onChange} phase="refinement" profile={aProfile()} />);
    await userEvent.clear(screen.getByLabelText("Modelo"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ refinement: expect.objectContaining({ model: null }) }),
    );
  });

  it("edits the chunk size", async () => {
    const onChange = vi.fn();
    render(<PhaseSettings onChange={onChange} phase="summary" profile={aProfile()} />);
    await userEvent.type(screen.getByLabelText("Máximo por trecho"), "1");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.objectContaining({ maxChunkCharacters: 80_001 }),
      }),
    );
  });

  it("drops the seed when the field is emptied", async () => {
    const onChange = vi.fn();
    const base = externalProfile();
    const profile: Profile = {
      ...base,
      summary: { ...base.summary, generation: { seed: 7 } },
    };
    render(<PhaseSettings onChange={onChange} phase="summary" profile={profile} />);
    await userEvent.clear(screen.getByLabelText("Seed"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ summary: expect.objectContaining({ generation: {} }) }),
    );
  });

  it("toggles the reasoning flag", async () => {
    const onChange = vi.fn();
    render(<PhaseSettings onChange={onChange} phase="summary" profile={aProfile()} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /Raciocínio do modelo/ }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.objectContaining({ generation: { think: true } }),
      }),
    );
  });
});

describe("TranscriptionSettings", () => {
  it("edits the merge gap", async () => {
    const onChange = vi.fn();
    render(<TranscriptionSettings onChange={onChange} profile={aProfile()} />);
    await userEvent.type(screen.getByLabelText("Intervalo máximo de união (ms)"), "0");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        transcription: expect.objectContaining({ mergeMaxGapMs: 4_000 }),
      }),
    );
  });

  it("drops the temperature when the field is emptied", async () => {
    const onChange = vi.fn();
    const base = externalProfile();
    const profile: Profile = {
      ...base,
      transcription: { ...base.transcription, temperature: 0.3 },
    };
    render(<TranscriptionSettings onChange={onChange} profile={profile} />);
    await userEvent.clear(screen.getByLabelText("Temperatura"));
    const [call] = onChange.mock.calls.at(-1) ?? [];
    expect(call).toBeDefined();
    expect((call as { transcription: Record<string, unknown> }).transcription).not.toHaveProperty(
      "temperature",
    );
  });

  it("offers the batch size only for a local profile", () => {
    const { unmount } = render(<TranscriptionSettings onChange={vi.fn()} profile={aProfile()} />);
    expect(screen.queryByLabelText("Tamanho do lote")).toBeNull();
    unmount();
    render(<TranscriptionSettings onChange={vi.fn()} profile={localProfile} />);
    expect(screen.getByLabelText("Tamanho do lote")).toHaveValue("auto");
  });

  it("accepts a numeric batch size", async () => {
    const onChange = vi.fn();
    render(
      <Controlled
        initial={localProfile}
        onChange={onChange}
        render={(profile, change) => <TranscriptionSettings onChange={change} profile={profile} />}
      />,
    );
    const field = screen.getByLabelText("Tamanho do lote");
    await userEvent.clear(field);
    await userEvent.type(field, "8");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ transcription: expect.objectContaining({ batchSize: 8 }) }),
    );
  });
});

describe("TranslationSettings", () => {
  it("renders nothing when translation is disabled", () => {
    const { container } = render(<TranslationSettings onChange={vi.fn()} profile={aProfile()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("edits the translation model", async () => {
    const onChange = vi.fn();
    const profile = aProfile({
      translation: { generation: {}, model: null, prompt: null, provider: "openrouter" },
    });
    render(<TranslationSettings onChange={onChange} profile={profile} />);
    await userEvent.type(screen.getByLabelText("Modelo"), "m");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ translation: expect.objectContaining({ model: "m" }) }),
    );
  });

  it("warns that the phase costs an extra model call", () => {
    const profile = aProfile({
      translation: { generation: {}, model: null, prompt: null, provider: "openrouter" },
    });
    render(<TranslationSettings onChange={vi.fn()} profile={profile} />);
    expect(screen.getByText(/adiciona uma chamada ao modelo/)).toBeInTheDocument();
  });
});
