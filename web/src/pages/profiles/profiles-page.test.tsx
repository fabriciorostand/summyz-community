import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { invalidateModelCatalogs } from "../../hooks/use-model-catalog";
import { setLanguage } from "../../i18n/store";
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
      getHardware: vi.fn().mockResolvedValue({
        hardware: { gpuAvailability: { ollama: false, "faster-whisper": false } },
      }),
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
    device: "auto",
  },
  summary: {
    consolidationPrompt: null,
    extractionPrompt: null,
    generation: {},
    maxChunkCharacters: 8_000,
    model: "qwen3:8b",
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

async function chooseProfile(name: string) {
  await screen.findByRole("combobox", { name: "Perfil" });
  const list = await openOptions("Perfil");
  await userEvent.click(within(list).getByRole("option", { name: new RegExp(`^${name}`) }));
}

async function editName(text: string, { replace = false } = {}) {
  await userEvent.click(await screen.findByRole("button", { name: "Editar nome do perfil" }));
  const name = screen.getByLabelText("Nome do perfil");
  if (replace) {
    // A whole new name is pasted: typing it re-renders the page on every key, which is slow
    // enough under coverage to time the test out.
    await userEvent.clear(name);
    await userEvent.paste(text);
    return;
  }
  await userEvent.type(name, text);
}

async function pickModel(model: RegExp) {
  await userEvent.click(screen.getByRole("button", { name: /^Modelo/ }));
  await userEvent.click(await screen.findByRole("option", { name: model }));
}

describe("ProfilesPage", () => {
  it("picks the profile from the header, with the type of each one", async () => {
    renderScreen(<ProfilesPage />);

    const header = await screen.findByRole("banner");
    const picker = await within(header).findByRole("combobox", { name: "Perfil" });
    expect(picker).toHaveTextContent("Padrão OpenRouter");
    expect(within(header).getByRole("button", { name: /Novo perfil/ })).toBeInTheDocument();
    const list = await openOptions("Perfil");
    const options = within(list).getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("Padrão OpenRouter");
    expect(options[0]).toHaveTextContent("API externa");
    expect(options[1]).toHaveTextContent("Local sem custo");
    expect(options[1]).toHaveTextContent("Local");
    expect(screen.queryByRole("navigation", { name: "Perfis" })).toBeNull();
  });

  it("shows the edit in progress in the header picker", async () => {
    renderScreen(<ProfilesPage />);
    await editName("!");

    expect(screen.getByRole("combobox", { name: "Perfil" })).toHaveTextContent(
      "Padrão OpenRouter!",
    );
  });

  it("labels the execution choice above its options", async () => {
    renderScreen(<ProfilesPage />);

    const group = await screen.findByRole("group", { name: "Execução da etapa Transcrição" });
    expect(within(group).getByText("Execução")).toBeVisible();
  });

  it("gives the header picker and button the overview control size", async () => {
    renderScreen(<ProfilesPage />);
    const header = await screen.findByRole("banner");

    const picker = await within(header).findByRole("combobox", { name: "Perfil" });
    const create = within(header).getByRole("button", { name: /Novo perfil/ });
    for (const control of [picker, create]) {
      expect(control).toHaveClass("h-[34px]", "text-[12.5px]");
    }
  });

  it("keeps the profile name locked until the pencil is clicked", async () => {
    renderScreen(<ProfilesPage />);
    const name = await screen.findByLabelText("Nome do perfil");

    expect(name).toHaveClass("border-line");
    expect(name).toHaveAttribute("readonly");
    await userEvent.type(name, "!");
    expect(name).toHaveValue("Padrão OpenRouter");

    await userEvent.click(screen.getByRole("button", { name: "Editar nome do perfil" }));
    expect(name).not.toHaveAttribute("readonly");
    expect(name).toHaveFocus();
    await userEvent.type(name, "!");
    await userEvent.keyboard("{Enter}");

    expect(name).toHaveAttribute("readonly");
    expect(name).toHaveValue("Padrão OpenRouter!");
    expect(screen.getByRole("button", { name: "Salvar perfil" })).toBeInTheDocument();
  });

  it("keeps the edited name when focus leaves it", async () => {
    renderScreen(<ProfilesPage />);
    await editName("!");
    await userEvent.click(screen.getByRole("tab", { name: /Refinamento/ }));

    const name = screen.getByLabelText("Nome do perfil");
    expect(name).toHaveAttribute("readonly");
    expect(name).toHaveValue("Padrão OpenRouter!");
  });

  it("restores the name from before the edit with Escape", async () => {
    renderScreen(<ProfilesPage />);
    await editName("!");
    await userEvent.keyboard("{Escape}");

    const name = screen.getByLabelText("Nome do perfil");
    expect(name).toHaveAttribute("readonly");
    expect(name).toHaveValue("Padrão OpenRouter");
    expect(screen.queryByRole("button", { name: "Salvar perfil" })).toBeNull();
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
    expect(screen.getByText("Híbrido")).toBeInTheDocument();
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
    await editName("!");
    await userEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
    await userEvent.click(screen.getByRole("button", { name: "Voltar" }));

    expect(screen.getByRole("button", { name: "Salvar perfil" })).toBeEnabled();
    expect(api.updateProfile).not.toHaveBeenCalled();
  });

  it("shows a name conflict next to the name", async () => {
    vi.mocked(api.updateProfile).mockRejectedValue(new ApiError(409, "profile_name_conflict"));
    renderScreen(<ProfilesPage />);
    await chooseProfile("Local sem custo");
    await editName("Padrão OpenRouter", { replace: true });
    await userEvent.keyboard("{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));

    expect(
      await screen.findByText(
        "Já existe um perfil chamado “Padrão OpenRouter”. Escolha outro nome.",
      ),
    ).toBeInTheDocument();
    const name = screen.getByLabelText("Nome do perfil");
    expect(name).toHaveAttribute("aria-invalid", "true");
    // The conflict reopens the name for editing so it can be fixed right away.
    expect(name).not.toHaveAttribute("readonly");
    expect(name).toHaveFocus();
  });

  it("explains a save the server refuses", async () => {
    vi.mocked(api.updateProfile).mockRejectedValue(new ApiError(503, "catalog_unavailable"));
    renderScreen(<ProfilesPage />);
    await chooseProfile("Local sem custo");
    await editName("!");
    await userEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível validar os modelos agora porque o catálogo está indisponível.",
    );
  });

  it("asks before leaving a profile with unsaved changes", async () => {
    renderScreen(<ProfilesPage />);
    await editName("!");
    await chooseProfile("Local sem custo");

    const dialog = screen.getByRole("dialog", { name: "Descartar alterações?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Continuar editando" }));
    expect(screen.getByLabelText("Nome do perfil")).toHaveValue("Padrão OpenRouter!");

    await chooseProfile("Local sem custo");
    await userEvent.click(screen.getByRole("button", { name: "Descartar alterações" }));
    expect(screen.getByLabelText("Nome do perfil")).toHaveValue("Local sem custo");
  });

  it("discards the changes from the save bar", async () => {
    renderScreen(<ProfilesPage />);
    await editName("!");
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
    await chooseProfile("Local sem custo");
    await userEvent.click(screen.getByRole("button", { name: "Excluir" }));
    await userEvent.click(screen.getByRole("button", { name: "Excluir perfil" }));

    await waitFor(() => expect(api.deleteProfile).toHaveBeenCalledWith("p2"));
    expect(screen.getByRole("combobox", { name: "Perfil" })).toHaveTextContent("Padrão OpenRouter");
    const list = await openOptions("Perfil");
    expect(within(list).queryByRole("option", { name: /Local sem custo/ })).toBeNull();
  });

  it("creates a profile from the selected one", async () => {
    vi.mocked(api.createProfile).mockResolvedValue(aProfile({ name: "Perfil 1", profileId: "p9" }));
    renderScreen(<ProfilesPage />);
    await userEvent.click(await screen.findByRole("button", { name: /Novo perfil/ }));

    await waitFor(() =>
      expect(api.createProfile).toHaveBeenCalledWith(expect.objectContaining({ name: "Perfil 1" })),
    );
    expect(vi.mocked(api.createProfile).mock.calls[0]?.[0]).not.toHaveProperty("profileType");
    const name = await screen.findByLabelText("Nome do perfil");
    await waitFor(() => expect(name).toHaveValue("Perfil 1"));
    expect(name).toHaveAttribute("readonly");
  });

  it("guides the setup profile, which has no execution chosen yet", async () => {
    const setup = aProfile({
      name: "Perfil 1",
      profileType: null,
      refinement: { ...aProfile().refinement, model: null, provider: null, device: undefined },
      summary: { ...aProfile().summary, model: null, provider: null, device: undefined },
      transcription: { ...apiTranscription(), model: null, provider: null, device: undefined },
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

  /** Makes every local catalog report its models as absent from this machine. */
  function withoutLocalModels() {
    vi.mocked(api.listModels).mockImplementation((phase, provider, family) => {
      const catalog = catalogFor(phase, provider, family);
      if (provider === "openrouter") return Promise.resolve(catalog);
      return Promise.resolve({
        ...catalog,
        installedModels: [],
        items: catalog.items.map((entry) => ({ ...entry, installed: false })),
      });
    });
  }

  function missing(...models: ProfileAvailability["missingModels"]): ProfileListItem {
    return item(localProfile, {
      availability: { missingModels: models, status: "missing_models", unavailableProviders: [] },
    });
  }

  it("sends the person to the stage of a missing model to download it there", async () => {
    withoutLocalModels();
    listProfiles.mockResolvedValue([
      missing({ model: "qwen3:8b", phase: "summary", provider: "ollama" }),
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
    expect(within(banner).queryByRole("button", { name: /^Baixar/ })).toBeNull();
    await userEvent.click(within(banner).getByRole("button", { name: "Ir para Resumo" }));

    expect(screen.getByRole("tab", { name: /Resumo/ })).toHaveAttribute("aria-selected", "true");
    expect(within(banner).queryByRole("button", { name: "Ir para Resumo" })).toBeNull();
    const [download, ...others] = await screen.findAllByRole("button", { name: /^Baixar/ });
    expect(others).toHaveLength(0);
    await userEvent.click(download as HTMLElement);

    expect(api.startModelDownload).toHaveBeenCalledWith("summary", "ollama", "qwen3:8b");
  });

  it("shows a running download in one place only", async () => {
    withoutLocalModels();
    listProfiles.mockResolvedValue([
      missing({ model: "large-v3", phase: "transcription", provider: "faster-whisper" }),
    ]);
    vi.mocked(api.listModelDownloads).mockResolvedValue([
      {
        completedBytes: 1_545_417_851,
        downloadId: "d1",
        failureCode: null,
        model: "large-v3",
        provider: "faster-whisper",
        status: "downloading",
        totalBytes: 3_090_835_702,
      },
    ]);
    renderScreen(<ProfilesPage />);

    const banner = await screen.findByRole("region", {
      name: "Este perfil ainda não pode gravar.",
    });
    await waitFor(() => expect(banner).toHaveTextContent("Baixando… 50% de 3,1 GB"));
    expect(within(banner).queryByRole("button")).toBeNull();
    expect(await screen.findAllByRole("button", { name: "Cancelar download" })).toHaveLength(1);
  });

  it("lists voice detection values adjusted for the external API before saving", async () => {
    renderScreen(<ProfilesPage />);
    await chooseProfile("Local sem custo");
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

  it("retargets default prompts when the transcription language drives the summary", async () => {
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
          promptModes: { ...aProfile().promptModes, summaryExtraction: "default" },
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
          promptModes: expect.objectContaining({ summaryExtraction: "default" }),
          summary: expect.objectContaining({ extractionPrompt: "extração en" }),
        }),
      ),
    );
  });

  it("never rewrites custom text, even when it matches the previous default", async () => {
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
          promptModes: expect.objectContaining({ summaryExtraction: "custom" }),
          summary: expect.objectContaining({ extractionPrompt: "extração auto" }),
        }),
      ),
    );
  });

  it("shows default prompts in Portuguese while saving them as defaults", async () => {
    listProfiles.mockResolvedValue([
      item(
        aProfile({
          promptModes: { ...aProfile().promptModes, refinement: "default" },
          refinement: { ...aProfile().refinement, prompt: "prompt de refino" },
        }),
      ),
    ]);
    renderScreen(<ProfilesPage />);
    await userEvent.click(await screen.findByRole("tab", { name: /Refinamento/ }));

    expect(
      await screen.findByText(/^Você é um revisor conservador de transcrições\./),
    ).toBeInTheDocument();
    expect(screen.queryByText("prompt de refino")).toBeNull();
  });

  it("names a new profile in the language of whoever creates it", async () => {
    setLanguage("en");
    vi.mocked(api.createProfile).mockImplementation((input) =>
      Promise.resolve({ ...input, profileId: "p3", profileType: "external" }),
    );
    renderScreen(<ProfilesPage />);
    await userEvent.click(await screen.findByRole("button", { name: /New profile/ }));

    await waitFor(() =>
      expect(api.createProfile).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Profile 1" }),
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

  it("only warns that the owner's account is not connected", async () => {
    listProfiles.mockRejectedValue(new ApiError(403, "discord_account_not_connected"));
    renderScreen(<ProfilesPage />);
    expect(
      await screen.findByRole("heading", { name: "Conta do dono não conectada" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Conecte a conta Discord para configurar servidores e perfis."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Discord|Bot/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Conectar/ })).toBeNull();
  });
});
