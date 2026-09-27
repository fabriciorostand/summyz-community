import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { invalidateModelCatalogs } from "../../hooks/use-model-catalog";
import {
  ApiError,
  api,
  type ModelCatalog,
  type Profile,
  type ProfileAvailability,
  type ProfileListItem,
} from "../../lib/api";
import { aProfile, chooseOption, openOptions, renderScreen } from "../../tests/test-utils";
import { ProfilesPage } from "./profiles-page";

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ApiError: actual.ApiError,
    api: {
      cancelModelDownload: vi.fn(),
      createProfile: vi.fn(),
      deleteProfile: vi.fn(),
      getPromptDefaults: vi.fn(),
      listModelDownloads: vi.fn(),
      listModels: vi.fn(),
      listProfiles: vi.fn(),
      startModelDownload: vi.fn(),
      uninstallModel: vi.fn(),
      updateProfile: vi.fn(),
    },
    profileSchema: actual.profileSchema,
  };
});

const listProfiles = vi.mocked(api.listProfiles);

const ready: ProfileAvailability = { missingModels: [], status: "ready", unavailableProviders: [] };

/** The fixture runs every stage on OpenRouter; narrow its transcription for spreads. */
function apiTranscription() {
  const { transcription } = aProfile();
  if (transcription.provider !== "openrouter") throw new Error("fixture must be external");
  return transcription;
}

const localProfile: Profile = aProfile({
  name: "Local sem custo",
  profileId: "p2",
  profileType: "local",
  refinement: {
    generation: {},
    maxChunkCharacters: 8_000,
    model: "qwen3:8b",
    prompt: null,
    provider: "ollama",
  },
  summary: {
    consolidationPrompt: null,
    extractionPrompt: null,
    generation: {},
    maxChunkCharacters: 8_000,
    model: "qwen3:8b",
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

function item(profile: Profile, overrides: Partial<ProfileListItem> = {}): ProfileListItem {
  return { active: false, activeServerCount: 0, availability: ready, profile, ...overrides };
}

function catalogFor(
  phase: ModelCatalog["phase"],
  provider: ModelCatalog["provider"],
  family?: string,
): ModelCatalog {
  const base = {
    fetchedAt: Date.now(),
    installedModels: [],
    inventoryStatus:
      provider === "openrouter" ? ("not_applicable" as const) : ("available" as const),
    phase,
    provider,
    status: "fresh" as const,
  };
  if (provider === "openrouter") {
    return {
      ...base,
      items: ["anthropic/claude-sonnet-4", "vendor/refine", "openai/whisper-1"].map((model) => ({
        compatibility: "unknown" as const,
        installed: null,
        model,
        name: model,
        sizeBytes: null,
      })),
    };
  }
  if (provider === "faster-whisper") {
    return {
      ...base,
      items: [
        {
          compatibility: "recommended",
          installed: true,
          model: "large-v3",
          name: "large-v3",
          sizeBytes: 3_090_835_702,
        },
      ],
    };
  }
  if (family === undefined) {
    return {
      ...base,
      installedModels: [{ model: "qwen3:8b", sizeBytes: 5_200_000_000 }],
      items: [
        {
          compatibility: "unknown",
          family: "qwen3",
          installed: false,
          model: "qwen3:latest",
          name: "qwen3",
          sizeBytes: null,
          variantsAvailable: true,
        },
      ],
    };
  }
  return {
    ...base,
    items: [
      {
        compatibility: "compatible",
        family: "qwen3",
        installed: true,
        model: "qwen3:8b",
        name: "qwen3:8b",
        sizeBytes: 5_200_000_000,
      },
      {
        compatibility: "compatible",
        family: "qwen3",
        installed: false,
        model: "qwen3:4b",
        name: "qwen3:4b",
        sizeBytes: 2_500_000_000,
      },
    ],
  };
}

beforeEach(() => {
  listProfiles.mockResolvedValue([
    item(aProfile(), { active: true, activeServerCount: 1 }),
    item(localProfile),
  ]);
  vi.mocked(api.getPromptDefaults).mockResolvedValue({
    refinement: "prompt de refino",
    summaryConsolidation: "prompt de consolidação",
    summaryExtraction: "prompt de extração",
    transcription: null,
  });
  vi.mocked(api.listModels).mockImplementation((phase, provider, family) =>
    Promise.resolve(catalogFor(phase, provider, family)),
  );
  vi.mocked(api.listModelDownloads).mockResolvedValue([]);
  vi.mocked(api.updateProfile).mockResolvedValue(undefined);
  vi.mocked(api.deleteProfile).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  invalidateModelCatalogs();
  vi.clearAllMocks();
});

async function openStage(title: "Transcrição" | "Refinamento" | "Resumo") {
  await userEvent.click(await screen.findByRole("tab", { name: new RegExp(title) }));
}

async function pickModel(model: RegExp) {
  await userEvent.click(screen.getByRole("button", { name: /^Modelo/ }));
  await userEvent.click(await screen.findByRole("option", { name: model }));
}

describe("ProfilesPage", () => {
  it("lists every profile once, with its type and where it is used", async () => {
    renderScreen(<ProfilesPage />);

    const list = await screen.findByRole("navigation", { name: "Perfis" });
    const first = within(list).getByRole("button", { name: /Padrão OpenRouter/ });
    expect(first).toHaveTextContent("API");
    expect(first).toHaveTextContent("Em uso em 1 servidor");
    expect(within(list).getByRole("button", { name: /Local sem custo/ })).toHaveTextContent(
      "Local",
    );
  });

  it("shows the three stages with the model and where each one runs", async () => {
    renderScreen(<ProfilesPage />);

    const trail = await screen.findByRole("tablist", { name: "Etapas do processamento" });
    const transcription = within(trail).getByRole("tab", { name: /Transcrição/ });
    expect(transcription).toHaveAttribute("aria-selected", "true");
    expect(transcription).toHaveTextContent("openai/whisper-1");
    expect(transcription).toHaveTextContent("API externa");
    expect(within(trail).getByRole("tab", { name: /Resumo/ })).toHaveTextContent(
      "anthropic/claude-sonnet-4",
    );
  });

  it("moves between the stages with the arrow keys", async () => {
    renderScreen(<ProfilesPage />);
    const transcription = await screen.findByRole("tab", { name: /Transcrição/ });
    transcription.focus();

    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /Refinamento/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: /Refinamento/ })).toHaveFocus();

    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("tab", { name: /Resumo/ })).toHaveAttribute("aria-selected", "true");
  });

  it("edits the refinement prompt and its model settings", async () => {
    renderScreen(<ProfilesPage />);
    await openStage("Refinamento");
    await userEvent.click(screen.getByRole("button", { name: "Usar prompt padrão" }));
    await userEvent.click(screen.getByRole("button", { name: /Ajustes do modelo/ }));
    await userEvent.type(screen.getByLabelText("Seed"), "7");
    await userEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar mesmo assim" }));

    await waitFor(() =>
      expect(api.updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          refinement: expect.objectContaining({
            generation: expect.objectContaining({ seed: 7 }),
            prompt: "prompt de refino",
          }),
        }),
      ),
    );
  });

  it("changes the summary language and prompts on the summary stage", async () => {
    renderScreen(<ProfilesPage />);
    await openStage("Resumo");
    await chooseOption("Idioma do resumo", "Mesmo idioma da reunião");
    await userEvent.click(
      screen.getAllByRole("button", { name: "Usar prompt padrão" })[1] as HTMLElement,
    );

    expect(screen.getByRole("tab", { name: /Resumo/ })).toHaveTextContent(
      "Mesmo idioma da reunião",
    );
    expect(screen.getByText(/Alterações não salvas/).parentElement).toHaveTextContent(
      "Alterações não salvas em Resumo",
    );
  });

  it("edits voice detection and how speech is merged on the transcription stage", async () => {
    renderScreen(<ProfilesPage />);
    await userEvent.click(await screen.findByRole("button", { name: /Detecção de voz/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Detectar presença de voz/ }));
    await userEvent.click(screen.getByRole("button", { name: /Junção de falas/ }));
    await userEvent.type(screen.getByLabelText("Silêncio entre falas (ms)"), "0");

    expect(screen.getByRole("button", { name: /Detecção de voz/ })).toHaveTextContent("Desativada");
    expect(screen.getByRole("tab", { name: /Transcrição/ })).toHaveTextContent("alterada");
  });

  it("explains a stage from its help button", async () => {
    renderScreen(<ProfilesPage />);
    await userEvent.hover(await screen.findByRole("button", { name: "Sobre a etapa Refinamento" }));

    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Revisa a transcrição e corrige erros evidentes, sem resumir nem traduzir.",
    );
  });

  it("warns that a stage on the external API has a cost", async () => {
    renderScreen(<ProfilesPage />);
    expect(
      await screen.findByText(
        "Esta etapa usa o OpenRouter e gera custo por uso, cobrado na sua conta do OpenRouter.",
      ),
    ).toBeInTheDocument();
  });

  it("asks for a model after a stage moves to another execution", async () => {
    renderScreen(<ProfilesPage />);
    await openStage("Resumo");
    await userEvent.click(screen.getByRole("radio", { name: "Local" }));

    expect(screen.getByRole("button", { name: /^Modelo/ })).toHaveTextContent("Escolha um modelo");
    expect(screen.getAllByText("Híbrido")).toHaveLength(2);
    expect(screen.getByText(/Escolha o modelo de Resumo/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar perfil" })).toBeDisabled();
  });

  it("restores the saved model when the stage goes back to its saved execution", async () => {
    renderScreen(<ProfilesPage />);
    await openStage("Resumo");
    await userEvent.click(screen.getByRole("radio", { name: "Local" }));
    await userEvent.click(screen.getByRole("radio", { name: "API externa" }));

    expect(screen.getByRole("button", { name: /^Modelo/ })).toHaveTextContent(
      "anthropic/claude-sonnet-4",
    );
    expect(screen.queryByRole("button", { name: "Salvar perfil" })).toBeNull();
  });

  it("saves a stage moved to a local model after the in-use confirmation", async () => {
    renderScreen(<ProfilesPage />);
    await openStage("Resumo");
    await userEvent.click(screen.getByRole("radio", { name: "Local" }));
    await pickModel(/qwen3:8b/);

    await userEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
    expect(screen.getByText(/Este perfil está em uso em 1 servidor/)).toBeInTheDocument();
    expect(api.updateProfile).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Salvar mesmo assim" }));

    await waitFor(() =>
      expect(api.updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: expect.objectContaining({ model: "qwen3:8b", provider: "ollama" }),
        }),
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Perfil salvo");
  });

  it("goes back from the in-use confirmation without saving", async () => {
    renderScreen(<ProfilesPage />);
    const name = await screen.findByLabelText("Nome do perfil");
    await userEvent.type(name, "!");
    await userEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
    await userEvent.click(screen.getByRole("button", { name: "Voltar" }));

    expect(screen.getByRole("button", { name: "Salvar perfil" })).toBeEnabled();
    expect(api.updateProfile).not.toHaveBeenCalled();
  });

  it("shows a name conflict next to the name", async () => {
    vi.mocked(api.updateProfile).mockRejectedValue(new ApiError(409, "profile_name_conflict"));
    renderScreen(<ProfilesPage />);
    await userEvent.click(await screen.findByRole("button", { name: /Local sem custo/ }));
    const name = screen.getByLabelText("Nome do perfil");
    await userEvent.clear(name);
    await userEvent.type(name, "Padrão OpenRouter");
    await userEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));

    expect(
      await screen.findByText(
        "Já existe um perfil chamado “Padrão OpenRouter”. Escolha outro nome.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Nome do perfil")).toHaveAttribute("aria-invalid", "true");
  });

  it("explains a save the server refuses", async () => {
    vi.mocked(api.updateProfile).mockRejectedValue(new ApiError(503, "catalog_unavailable"));
    renderScreen(<ProfilesPage />);
    await userEvent.click(await screen.findByRole("button", { name: /Local sem custo/ }));
    await userEvent.type(screen.getByLabelText("Nome do perfil"), "!");
    await userEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível validar os modelos agora porque o catálogo está indisponível.",
    );
  });

  it("asks before leaving a profile with unsaved changes", async () => {
    renderScreen(<ProfilesPage />);
    await userEvent.type(await screen.findByLabelText("Nome do perfil"), "!");
    await userEvent.click(screen.getByRole("button", { name: /Local sem custo/ }));

    const dialog = screen.getByRole("dialog", { name: "Descartar alterações?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Continuar editando" }));
    expect(screen.getByLabelText("Nome do perfil")).toHaveValue("Padrão OpenRouter!");

    await userEvent.click(screen.getByRole("button", { name: /Local sem custo/ }));
    await userEvent.click(screen.getByRole("button", { name: "Descartar alterações" }));
    expect(screen.getByLabelText("Nome do perfil")).toHaveValue("Local sem custo");
  });

  it("discards the changes from the save bar", async () => {
    renderScreen(<ProfilesPage />);
    await userEvent.type(await screen.findByLabelText("Nome do perfil"), "!");
    await userEvent.click(screen.getByRole("button", { name: "Descartar" }));

    expect(screen.getByLabelText("Nome do perfil")).toHaveValue("Padrão OpenRouter");
    expect(screen.queryByRole("button", { name: "Salvar perfil" })).toBeNull();
  });

  it("explains why a profile in use cannot be deleted", async () => {
    renderScreen(<ProfilesPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Excluir" }));

    expect(
      screen.getByText("Escolha outro perfil no servidor que usa este antes de excluir."),
    ).toBeInTheDocument();
    expect(api.deleteProfile).not.toHaveBeenCalled();
  });

  it("deletes an unused profile after confirmation", async () => {
    renderScreen(<ProfilesPage />);
    await userEvent.click(await screen.findByRole("button", { name: /Local sem custo/ }));
    await userEvent.click(screen.getByRole("button", { name: "Excluir" }));
    await userEvent.click(screen.getByRole("button", { name: "Excluir perfil" }));

    await waitFor(() => expect(api.deleteProfile).toHaveBeenCalledWith("p2"));
    expect(screen.queryByRole("button", { name: /Local sem custo/ })).toBeNull();
  });

  it("creates a profile from the selected one", async () => {
    vi.mocked(api.createProfile).mockResolvedValue(aProfile({ name: "Perfil 1", profileId: "p9" }));
    renderScreen(<ProfilesPage />);
    await userEvent.click(await screen.findByRole("button", { name: /Novo perfil/ }));

    await waitFor(() =>
      expect(api.createProfile).toHaveBeenCalledWith(expect.objectContaining({ name: "Perfil 1" })),
    );
    expect(vi.mocked(api.createProfile).mock.calls[0]?.[0]).not.toHaveProperty("profileType");
    expect(await screen.findByLabelText("Nome do perfil")).toHaveValue("Perfil 1");
  });

  it("guides the setup profile, which has no execution chosen yet", async () => {
    const setup = aProfile({
      name: "Perfil 1",
      profileType: null,
      refinement: { ...aProfile().refinement, model: null, provider: null },
      summary: { ...aProfile().summary, model: null, provider: null },
      transcription: { ...apiTranscription(), model: null, provider: null },
    });
    listProfiles.mockResolvedValue([
      item(setup, {
        availability: { missingModels: [], status: "incomplete", unavailableProviders: [] },
      }),
    ]);
    renderScreen(<ProfilesPage />);

    expect(await screen.findByText("Este perfil ainda não está completo.")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Transcrição/ })).toHaveTextContent(
      "Escolha a execução",
    );
    expect(screen.queryByRole("button", { name: /^Modelo/ })).toBeNull();

    await userEvent.click(screen.getByRole("radio", { name: "Local" }));
    expect(screen.getByRole("button", { name: /^Modelo/ })).toHaveTextContent("Escolha um modelo");
  });

  it("says a profile cannot record while a local model is missing and offers the download", async () => {
    listProfiles.mockResolvedValue([
      item(localProfile, {
        availability: {
          missingModels: [{ model: "qwen3:8b", phase: "summary", provider: "ollama" }],
          status: "missing_models",
          unavailableProviders: [],
        },
      }),
    ]);
    vi.mocked(api.startModelDownload).mockResolvedValue({
      completedBytes: 0,
      downloadId: "d1",
      failureCode: null,
      model: "qwen3:8b",
      provider: "ollama",
      status: "queued",
      totalBytes: null,
    });
    renderScreen(<ProfilesPage />);

    const banner = await screen.findByRole("region", {
      name: "Este perfil ainda não pode gravar.",
    });
    expect(banner).toHaveTextContent("Falta instalar qwen3:8b (Resumo).");
    expect(
      within(screen.getByRole("navigation", { name: "Perfis" })).getByText(/Indisponível/),
    ).toBeInTheDocument();
    await userEvent.click(within(banner).getByRole("button", { name: "Baixar qwen3:8b" }));

    expect(api.startModelDownload).toHaveBeenCalledWith("summary", "ollama", "qwen3:8b");
  });

  it("lists voice detection values adjusted for the external API before saving", async () => {
    renderScreen(<ProfilesPage />);
    await userEvent.click(await screen.findByRole("button", { name: /Local sem custo/ }));
    await userEvent.click(screen.getByRole("radio", { name: "API externa" }));
    await pickModel(/openai\/whisper-1/);

    expect(screen.getByText(/Revise 1 campo em Transcrição/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar perfil" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /Detecção de voz/ }));
    await userEvent.click(
      screen.getByRole("button", { name: "Manter o valor de Silêncio para encerrar (ms)" }),
    );

    expect(screen.getByRole("button", { name: "Salvar perfil" })).toBeEnabled();
  });

  it("names the languages and keeps the automatic choice first", async () => {
    renderScreen(<ProfilesPage />);
    await screen.findByRole("combobox", { name: "Idioma falado na reunião" });
    const list = await openOptions("Idioma falado na reunião");

    expect(within(list).getAllByRole("option")[0]).toHaveTextContent("Detectar automaticamente");
    expect(within(list).getByRole("option", { name: "Português (Brasil)" })).toBeInTheDocument();
  });

  it("loads the default prompts in the fixed summary language", async () => {
    listProfiles.mockResolvedValue([
      item(aProfile({ transcription: { ...apiTranscription(), language: "en" } })),
    ]);
    renderScreen(<ProfilesPage />);
    await waitFor(() => expect(api.getPromptDefaults).toHaveBeenCalledWith("pt-BR"));
    expect(api.getPromptDefaults).not.toHaveBeenCalledWith("en");
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
    listProfiles.mockResolvedValue([
      item(
        aProfile({
          language: "auto",
          summary: { ...aProfile().summary, extractionPrompt: "extração auto" },
        }),
      ),
    ]);
    renderScreen(<ProfilesPage />);
    await waitFor(() => expect(api.getPromptDefaults).toHaveBeenCalledWith("auto"));
    await chooseOption("Idioma falado na reunião", "Inglês");
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
});
