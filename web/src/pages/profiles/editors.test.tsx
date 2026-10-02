import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { Profile } from "../../lib/api";
import { aProfile } from "../../tests/test-utils";
import { MergeSettings, PhaseSettings, TranscriptionTuning } from "./generation-editor";
import { VadEditor } from "./vad-editor";

/** Narrows the fixture so a spread keeps the external transcription branch. */
function externalProfile() {
  const profile = aProfile();
  if (profile.transcription.provider !== "openrouter") throw new Error("fixture must be external");
  return { ...profile, transcription: profile.transcription };
}

const localProfile = aProfile({
  profileType: "local",
  refinement: {
    generation: {},
    maxChunkCharacters: 8_000,
    model: "qwen3:4b",
    prompt: null,
    provider: "ollama",
    device: "auto",
  },
  summary: {
    consolidationPrompt: null,
    extractionPrompt: null,
    generation: {},
    maxChunkCharacters: 8_000,
    model: "qwen3:4b",
    provider: "ollama",
    device: "auto",
  },
  transcription: {
    batchSize: "auto",
    interSpeechSilenceMs: 700,
    language: "auto",
    mergeMaxGapMs: 400,
    model: "large-v3",
    prompt: null,
    provider: "faster-whisper",
    device: "auto",
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

  it("uses a numeric silence field when transcription uses the external API", () => {
    render(<VadEditor onChange={vi.fn()} profile={aProfile()} />);
    expect(screen.getByLabelText("Silêncio para encerrar (ms)")).toHaveAttribute("type", "number");
    expect(screen.queryByLabelText("Duração máxima da fala (s)")).toBeNull();
  });

  it("accepts auto when transcription runs locally", async () => {
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

  it("lists the values adjusted for the external API and lets the person keep them", async () => {
    const onAcknowledge = vi.fn();
    render(
      <VadEditor
        onAcknowledge={onAcknowledge}
        onChange={vi.fn()}
        profile={aProfile()}
        review={
          new Map([
            ["transcription.vad.minSpeechDurationMs", { kind: "minimum", minimum: 32 } as const],
            ["transcription.vad.threshold", { kind: "minimum", minimum: 0.15 } as const],
            ["transcription.vad.minSilenceDurationMs", { fallback: 768, kind: "auto" } as const],
          ])
        }
      />,
    );

    expect(screen.getByText("Fala mínima (ms)", { selector: "strong" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "A API externa exige pelo menos 32 ms. Ajustamos o valor; confirme ou ajuste.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "A API externa exige um limiar de pelo menos 0,15. Ajustamos o valor; confirme ou ajuste.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('A API externa não aceita "auto" aqui. Usamos 768 ms; confirme ou ajuste.'),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Manter o valor de Fala mínima (ms)" }),
    );

    expect(onAcknowledge).toHaveBeenCalledWith("transcription.vad.minSpeechDurationMs");
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
  it("edits the chunk size", async () => {
    const onChange = vi.fn();
    render(<PhaseSettings onChange={onChange} phase="summary" profile={aProfile()} />);
    await userEvent.type(screen.getByLabelText("Tamanho máximo do chunk (caracteres)"), "1");
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

describe("MergeSettings", () => {
  it("edits the merge gap", async () => {
    const onChange = vi.fn();
    render(<MergeSettings onChange={onChange} profile={aProfile()} />);
    await userEvent.type(screen.getByLabelText("Intervalo máximo de união (ms)"), "0");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        transcription: expect.objectContaining({ mergeMaxGapMs: 4_000 }),
      }),
    );
  });
});

describe("TranscriptionTuning", () => {
  it("drops the temperature when the field is emptied", async () => {
    const onChange = vi.fn();
    const base = externalProfile();
    const profile: Profile = {
      ...base,
      transcription: { ...base.transcription, temperature: 0.3 },
    };
    render(<TranscriptionTuning onChange={onChange} profile={profile} />);
    await userEvent.clear(screen.getByLabelText("Temperatura"));
    const [call] = onChange.mock.calls.at(-1) ?? [];
    expect(call).toBeDefined();
    expect((call as { transcription: Record<string, unknown> }).transcription).not.toHaveProperty(
      "temperature",
    );
  });

  it("offers the batch size only when transcription runs locally", () => {
    const { unmount } = render(<TranscriptionTuning onChange={vi.fn()} profile={aProfile()} />);
    expect(screen.queryByLabelText("Tamanho do lote")).toBeNull();
    unmount();
    render(<TranscriptionTuning onChange={vi.fn()} profile={localProfile} />);
    expect(screen.getByLabelText("Tamanho do lote")).toHaveValue("auto");
  });

  it("accepts a numeric batch size", async () => {
    const onChange = vi.fn();
    render(
      <Controlled
        initial={localProfile}
        onChange={onChange}
        render={(profile, change) => <TranscriptionTuning onChange={change} profile={profile} />}
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
