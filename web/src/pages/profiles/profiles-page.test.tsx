import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, type Profile } from "../../lib/api";
import { aProfile, chooseOption, openOptions, renderScreen } from "../../tests/test-utils";
import { profileLanguages } from "./language-selector";
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

/** Narrows the fixture so a spread keeps the external branch of the discriminated union. */
function externalProfile(): Extract<Profile, { profileType: "external" }> {
  const profile = aProfile();
  if (profile.profileType !== "external") throw new Error("fixture must be an external profile");
  return profile;
}

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
    language: "auto",
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
  it("keeps only five fields in the essentials card", async () => {
    renderScreen(<ProfilesPage />);
    expect(await screen.findByLabelText("Nome do perfil")).toHaveValue("Padrão OpenRouter");
    expect(screen.getByRole("combobox", { name: "Idioma da transcrição" })).toHaveTextContent(
      "auto",
    );
    expect(screen.getByRole("combobox", { name: "Idioma do resumo" })).toHaveTextContent("pt-BR");
    expect(screen.getByLabelText("Modelo de transcrição")).toHaveValue("openai/whisper-1");
    expect(screen.getByLabelText("Modelo de resumo")).toHaveValue("anthropic/claude-sonnet-4");
  });

  it("has no help tip next to the title", async () => {
    renderScreen(<ProfilesPage />);
    await screen.findByLabelText("Nome do perfil");
    expect(screen.queryByRole("button", { name: "Ajuda" })).toBeNull();
    expect(screen.queryByText(/Perfis são globais/)).toBeNull();
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

  it("gives both execution types half of the selector", async () => {
    renderScreen(<ProfilesPage />);
    await screen.findByLabelText("Nome do perfil");
    expect(screen.getByRole("tablist", { name: "Tipo de execução" })).toHaveClass("w-full");
    expect(screen.getByRole("tab", { name: "API externa" })).toHaveClass("flex-1");
    expect(screen.getByRole("tab", { name: "Local" })).toHaveClass("flex-1");
  });

  it("hides the advanced settings behind disclosures", async () => {
    renderScreen(<ProfilesPage />);
    const vad = await screen.findByRole("button", { name: /Detecção de voz/ });
    expect(vad).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /Prompts do pipeline/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Geração e fatiamento/ })).toBeInTheDocument();
    expect(screen.getByText("Avançado")).toBeInTheDocument();
    expect(screen.queryByText("Mexa só se precisar")).toBeNull();
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

  it("omits the model licence notice", async () => {
    renderScreen(<ProfilesPage />);
    await screen.findByLabelText("Idioma do resumo");
    expect(screen.queryByText("Licenças dos modelos")).not.toBeInTheDocument();
  });

  it("has no translation controls even with a fixed summary language", async () => {
    renderScreen(<ProfilesPage />);
    await screen.findByLabelText("Idioma do resumo");
    expect(screen.queryByRole("button", { name: /Tradução/ })).toBeNull();
    expect(screen.queryByText(/tradução/i)).toBeNull();
  });

  it("drops the note about the automatic language", async () => {
    renderScreen(<ProfilesPage />);
    await screen.findByLabelText("Idioma do resumo");
    expect(screen.queryByText(/idioma predominante da call/)).toBeNull();
  });

  it("names the automatic option only auto in both selectors", async () => {
    renderScreen(<ProfilesPage />);
    await screen.findByLabelText("Idioma do resumo");
    for (const label of ["Idioma da transcrição", "Idioma do resumo"]) {
      const list = await openOptions(label);
      expect(within(list).getByRole("option", { name: "auto" })).toBeInTheDocument();
      await userEvent.keyboard("{Escape}");
    }
    expect(screen.queryByRole("option", { name: /auto —/ })).toBeNull();
  });

  it("saves the transcription language independently of the summary language", async () => {
    renderScreen(<ProfilesPage />);
    await screen.findByLabelText("Idioma da transcrição");
    await chooseOption("Idioma da transcrição", "en");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
    await waitFor(() =>
      expect(api.updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          language: "pt-BR",
          transcription: expect.objectContaining({ language: "en" }),
        }),
      ),
    );
    expect(vi.mocked(api.updateProfile).mock.calls[0]?.[0]).not.toHaveProperty("translation");
  });

  it("loads the default prompts in the fixed summary language", async () => {
    listProfiles.mockResolvedValue([
      {
        active: false,
        activeServerCount: 0,
        profile: aProfile({
          transcription: { ...externalProfile().transcription, language: "en" },
        }),
      },
    ]);
    renderScreen(<ProfilesPage />);
    await waitFor(() => expect(api.getPromptDefaults).toHaveBeenCalledWith("pt-BR"));
    expect(api.getPromptDefaults).not.toHaveBeenCalledWith("en");
  });

  it("loads the default prompts in the transcription language when the summary is auto", async () => {
    listProfiles.mockResolvedValue([
      {
        active: false,
        activeServerCount: 0,
        profile: aProfile({
          language: "auto",
          transcription: { ...externalProfile().transcription, language: "es" },
        }),
      },
    ]);
    renderScreen(<ProfilesPage />);
    await waitFor(() => expect(api.getPromptDefaults).toHaveBeenCalledWith("es"));
  });

  it("retargets untouched prompts when the transcription language drives the summary", async () => {
    vi.mocked(api.getPromptDefaults).mockImplementation((language) =>
      Promise.resolve({
        refinement: `refino ${language}`,
        summaryConsolidation: `consolidação ${language}`,
        summaryExtraction: `extração ${language}`,
        transcription: null,
      }),
    );
    const base = externalProfile();
    listProfiles.mockResolvedValue([
      {
        active: false,
        activeServerCount: 0,
        profile: aProfile({
          language: "auto",
          summary: { ...base.summary, extractionPrompt: "extração auto" },
        }),
      },
    ]);
    renderScreen(<ProfilesPage />);
    await waitFor(() => expect(api.getPromptDefaults).toHaveBeenCalledWith("auto"));
    await chooseOption("Idioma da transcrição", "en");
    await waitFor(() => expect(api.getPromptDefaults).toHaveBeenCalledWith("en"));
    await userEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
    await waitFor(() =>
      expect(api.updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: expect.objectContaining({ extractionPrompt: "extração en" }),
        }),
      ),
    );
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

  it("offers every language tag without a search box", async () => {
    renderScreen(<ProfilesPage />);
    await screen.findByLabelText("Idioma do resumo");
    for (const label of ["Idioma do resumo", "Idioma da transcrição"]) {
      const list = await openOptions(label);
      expect(within(list).getAllByRole("option")).toHaveLength(profileLanguages.length);
      await userEvent.keyboard("{Escape}");
    }
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByPlaceholderText("Pesquisar uma tag BCP 47")).toBeNull();
  });
});
