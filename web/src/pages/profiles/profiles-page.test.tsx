import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../lib/api";
import { aProfile, renderScreen } from "../../test-utils";
import { ProfilesPage } from "./profiles-page";

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    api: {
      createProfile: vi.fn(),
      deleteProfile: vi.fn(),
      getPromptDefaults: vi.fn(),
      listProfiles: vi.fn(),
      updateProfile: vi.fn(),
    },
    profileSchema: actual.profileSchema,
  };
});

const listProfiles = vi.mocked(api.listProfiles);

const localProfile = aProfile({
  name: "Local sem custo",
  profileId: "p2",
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
});

beforeEach(() => {
  listProfiles.mockResolvedValue([
    { active: true, activeServerCount: 1, profile: aProfile() },
    { active: false, activeServerCount: 0, profile: localProfile },
  ]);
  vi.mocked(api.getPromptDefaults).mockResolvedValue({
    refinement: "prompt de refino",
    summaryConsolidation: "prompt de consolidação",
    summaryExtraction: "prompt de extração",
    transcription: null,
  });
  vi.mocked(api.updateProfile).mockResolvedValue(undefined);
  vi.mocked(api.deleteProfile).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ProfilesPage", () => {
  it("keeps only four fields in the essentials card", async () => {
    renderScreen(<ProfilesPage />);
    expect(await screen.findByLabelText("Nome do perfil")).toHaveValue("Padrão OpenRouter");
    expect(screen.getByLabelText("Idioma")).toBeInTheDocument();
    expect(screen.getByLabelText("Modelo de transcrição")).toHaveValue("openai/whisper-1");
    expect(screen.getByLabelText("Modelo de resumo")).toHaveValue("anthropic/claude-sonnet-4");
  });

  it("marks the profile that a server is using", async () => {
    renderScreen(<ProfilesPage />);
    expect(await screen.findByText("Em uso")).toBeInTheDocument();
    expect(screen.getByText(/Este perfil está ativo em 1 servidor/)).toBeInTheDocument();
  });

  it("switches between external and local profiles", async () => {
    renderScreen(<ProfilesPage />);
    await screen.findByLabelText("Nome do perfil");
    await userEvent.click(screen.getByRole("tab", { name: "Local" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Nome do perfil")).toHaveValue("Local sem custo"),
    );
  });

  it("hides the advanced settings behind disclosures", async () => {
    renderScreen(<ProfilesPage />);
    const vad = await screen.findByRole("button", { name: /Detecção de voz/ });
    expect(vad).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /Prompts do pipeline/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Geração e fatiamento/ })).toBeInTheDocument();
  });

  it("summarises the VAD configuration on the closed panel", async () => {
    renderScreen(<ProfilesPage />);
    expect(await screen.findByRole("button", { name: /Detecção de voz/ })).toHaveAccessibleName(
      expect.stringContaining("Ativada · limiar 0.5 · margem 300 ms"),
    );
  });

  it("edits a VAD threshold", async () => {
    renderScreen(<ProfilesPage />);
    await userEvent.click(await screen.findByRole("button", { name: /Detecção de voz/ }));
    const threshold = screen.getByLabelText("Limiar de fala");
    await userEvent.clear(threshold);
    await userEvent.type(threshold, "0.7");
    expect(threshold).toHaveValue(0.7);
  });

  it("lets a numeric field sit empty mid-edit without pushing NaN into the profile", async () => {
    renderScreen(<ProfilesPage />);
    await userEvent.click(await screen.findByRole("button", { name: /Detecção de voz/ }));
    const threshold = screen.getByLabelText("Limiar de fala");
    await userEvent.clear(threshold);
    expect(threshold).toHaveValue(null);
    // The editor must survive the empty state: the profile keeps its last valid value.
    await userEvent.type(threshold, "0.42");
    expect(threshold).toHaveValue(0.42);
  });

  it("marks prompts as default until they are customised", async () => {
    renderScreen(<ProfilesPage />);
    expect(await screen.findByText("Padrão")).toBeInTheDocument();
  });

  it("saves the profile", async () => {
    renderScreen(<ProfilesPage />);
    const name = await screen.findByLabelText("Nome do perfil");
    await userEvent.clear(name);
    await userEvent.type(name, "Novo nome");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
    await waitFor(() =>
      expect(api.updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Novo nome" }),
      ),
    );
  });

  it("asks before saving a profile a server is using", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderScreen(<ProfilesPage />);
    await screen.findByLabelText("Nome do perfil");
    await userEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(api.updateProfile).not.toHaveBeenCalled();
  });

  it("refuses to delete a profile that is in use", async () => {
    renderScreen(<ProfilesPage />);
    expect(await screen.findByRole("button", { name: "Excluir" })).toBeDisabled();
  });

  it("deletes an unused profile", async () => {
    listProfiles.mockResolvedValue([
      { active: false, activeServerCount: 0, profile: aProfile() },
      {
        active: false,
        activeServerCount: 0,
        profile: aProfile({ name: "Outro", profileId: "p3" }),
      },
    ]);
    renderScreen(<ProfilesPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Excluir" }));
    await waitFor(() => expect(api.deleteProfile).toHaveBeenCalledWith("p1"));
  });

  it("creates a profile from the selected one", async () => {
    vi.mocked(api.createProfile).mockResolvedValue(aProfile({ name: "Perfil 1", profileId: "p9" }));
    renderScreen(<ProfilesPage />);
    await userEvent.click(await screen.findByRole("button", { name: /Novo perfil/ }));
    await waitFor(() =>
      expect(api.createProfile).toHaveBeenCalledWith(expect.objectContaining({ name: "Perfil 1" })),
    );
  });

  it("warns about third-party model licences", async () => {
    renderScreen(<ProfilesPage />);
    expect(await screen.findByText("Licenças dos modelos")).toBeInTheDocument();
  });

  it("adds the translation panel once a fixed language is chosen", async () => {
    renderScreen(<ProfilesPage />);
    await screen.findByLabelText("Idioma");
    expect(screen.queryByRole("button", { name: /^Tradução/ })).toBeNull();
  });

  it("drops the translation panel in auto", async () => {
    listProfiles.mockResolvedValue([
      { active: false, activeServerCount: 0, profile: aProfile({ language: "auto" }) },
    ]);
    renderScreen(<ProfilesPage />);
    await screen.findByLabelText("Idioma");
    expect(screen.queryByRole("button", { name: /^Tradução/ })).toBeNull();
  });

  it("offers a retry when the profiles fail to load", async () => {
    listProfiles.mockRejectedValue(new Error("offline"));
    renderScreen(<ProfilesPage />);
    expect(
      await screen.findByRole("heading", { name: "Perfis indisponíveis" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Tentar novamente/ }));
    await waitFor(() => expect(listProfiles).toHaveBeenCalledTimes(2));
  });

  it("filters the language list as the operator searches", async () => {
    renderScreen(<ProfilesPage />);
    await userEvent.type(await screen.findByLabelText("Pesquisar idioma"), "zh");
    expect(screen.getByRole("option", { name: "zh-TW" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "auto — usa o idioma predominante" })).toBeNull();
  });
});
