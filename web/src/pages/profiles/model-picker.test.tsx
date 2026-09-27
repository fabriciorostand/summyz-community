import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { invalidateModelCatalogs } from "../../hooks/use-model-catalog";
import { ApiError, api, type ModelCatalog } from "../../lib/api";
import { renderWithRouter } from "../../tests/test-utils";
import { ModelPicker } from "./model-picker";

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ApiError: actual.ApiError, api: { listModels: vi.fn() } };
});

const listModels = vi.mocked(api.listModels);

function catalog(overrides: Partial<ModelCatalog>): ModelCatalog {
  return {
    fetchedAt: Date.now(),
    installedModels: [],
    inventoryStatus: "available",
    items: [],
    phase: "transcription",
    provider: "faster-whisper",
    status: "fresh",
    ...overrides,
  };
}

const whisper = catalog({
  items: [
    {
      compatibility: "compatible",
      installed: true,
      model: "small",
      name: "small",
      sizeBytes: 486_212_372,
    },
    {
      compatibility: "recommended",
      installed: false,
      model: "large-v3",
      name: "large-v3",
      sizeBytes: 3_090_835_702,
    },
  ],
});

const ollamaFamilies = catalog({
  installedModels: [{ model: "llama3.2:3b", sizeBytes: 2_000_000_000 }],
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
    {
      compatibility: "unknown",
      family: "gemma3",
      installed: false,
      model: "gemma3:latest",
      name: "gemma3",
      sizeBytes: null,
      variantsAvailable: true,
    },
  ],
  phase: "summary",
  provider: "ollama",
});

const qwenVariants = catalog({
  items: [
    {
      compatibility: "compatible",
      family: "qwen3",
      installed: false,
      model: "qwen3:4b",
      name: "qwen3:4b",
      sizeBytes: 2_500_000_000,
    },
    {
      compatibility: "above_recommended",
      family: "qwen3",
      installed: true,
      model: "qwen3:8b",
      name: "qwen3:8b",
      sizeBytes: 5_200_000_000,
    },
  ],
  phase: "summary",
  provider: "ollama",
});

beforeEach(() => {
  listModels.mockImplementation((phase, provider, family) => {
    if (provider === "faster-whisper") return Promise.resolve(whisper);
    if (provider === "ollama")
      return Promise.resolve(family === "qwen3" ? qwenVariants : ollamaFamilies);
    return Promise.resolve(
      catalog({
        items: [
          {
            compatibility: "unknown",
            installed: null,
            model: "google/gemini-3.7-flash",
            name: "google/gemini-3.7-flash",
            sizeBytes: null,
          },
        ],
        phase,
        provider,
      }),
    );
  });
});

afterEach(() => {
  cleanup();
  invalidateModelCatalogs();
  vi.clearAllMocks();
});

describe("ModelPicker", () => {
  it("lists local transcription models with what is installed and what fits this machine", async () => {
    const onChange = vi.fn();
    renderWithRouter(
      <ModelPicker
        onChange={onChange}
        provider="faster-whisper"
        stage="transcription"
        value={null}
      />,
    );

    expect(screen.getByRole("button", { name: /Modelo/ })).toHaveTextContent("Escolha um modelo");
    await userEvent.click(screen.getByRole("button", { name: /Modelo/ }));
    const list = await screen.findByRole("listbox", { name: "Modelos" });
    const large = within(list).getByRole("option", { name: /large-v3/ });
    expect(large).toHaveTextContent("Não instalado · 3,1 GB");
    expect(large).toHaveTextContent("Recomendado");
    expect(within(list).getByRole("option", { name: /small/ })).toHaveTextContent("Instalado");

    await userEvent.click(large);

    expect(onChange).toHaveBeenCalledWith("large-v3");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("filters the list by what the person types", async () => {
    renderWithRouter(
      <ModelPicker
        onChange={vi.fn()}
        provider="faster-whisper"
        stage="transcription"
        value="small"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Modelo/ }));
    await screen.findByRole("option", { name: /large-v3/ });

    await userEvent.type(screen.getByRole("combobox", { name: "Buscar modelo" }), "larg");

    expect(screen.getAllByRole("option")).toHaveLength(1);
    await userEvent.clear(screen.getByRole("combobox", { name: "Buscar modelo" }));
    await userEvent.type(screen.getByRole("combobox", { name: "Buscar modelo" }), "xyz");
    expect(screen.getByText("Nenhum modelo encontrado para “xyz”.")).toBeInTheDocument();
  });

  it("marks the chosen model and picks with the keyboard", async () => {
    const onChange = vi.fn();
    renderWithRouter(
      <ModelPicker
        onChange={onChange}
        provider="faster-whisper"
        stage="transcription"
        value="small"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Modelo/ }));

    expect(await screen.findByRole("option", { name: /small/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await userEvent.keyboard("{ArrowDown}{Enter}");

    expect(onChange).toHaveBeenCalledWith("large-v3");
  });

  it("closes with Escape and gives the focus back to the field", async () => {
    renderWithRouter(
      <ModelPicker
        onChange={vi.fn()}
        provider="faster-whisper"
        stage="transcription"
        value="small"
      />,
    );
    const trigger = screen.getByRole("button", { name: /Modelo/ });
    await userEvent.click(trigger);
    await screen.findByRole("listbox");

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("browses the Ollama library by family, then picks a variant", async () => {
    const onChange = vi.fn();
    renderWithRouter(
      <ModelPicker onChange={onChange} provider="ollama" stage="summary" value={null} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Modelo/ }));

    await userEvent.click(await screen.findByRole("option", { name: /qwen3/ }));
    const variant = await screen.findByRole("option", { name: /qwen3:8b/ });
    expect(variant).toHaveTextContent("Acima do seu hardware");
    expect(listModels).toHaveBeenCalledWith("summary", "ollama", "qwen3");

    await userEvent.click(screen.getByRole("button", { name: "Voltar às famílias" }));
    expect(await screen.findByRole("option", { name: /gemma3/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("option", { name: /qwen3/ }));
    await userEvent.click(await screen.findByRole("option", { name: /qwen3:4b/ }));
    expect(onChange).toHaveBeenCalledWith("qwen3:4b");
  });

  it("offers the Ollama models already on this machine first", async () => {
    const onChange = vi.fn();
    renderWithRouter(
      <ModelPicker onChange={onChange} provider="ollama" stage="refinement" value={null} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Modelo/ }));

    const installed = await screen.findByRole("option", { name: /llama3.2:3b/ });
    expect(installed).toHaveTextContent("Instalado");
    await userEvent.click(installed);

    expect(onChange).toHaveBeenCalledWith("llama3.2:3b");
  });

  it("opens the family of the chosen Ollama model", async () => {
    renderWithRouter(
      <ModelPicker onChange={vi.fn()} provider="ollama" stage="summary" value="qwen3:8b" />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Modelo/ }));

    expect(await screen.findByRole("option", { name: /qwen3:8b/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("explains that the OpenRouter key is missing and where to add it", async () => {
    listModels.mockRejectedValue(new ApiError(409, "openrouter_api_key_missing"));
    renderWithRouter(
      <ModelPicker onChange={vi.fn()} provider="openrouter" stage="summary" value={null} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Modelo/ }));

    expect(await screen.findByText(/Configure a chave do OpenRouter/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir Instalação" })).toHaveAttribute(
      "href",
      "/installation",
    );
  });

  it("lets the person try again when the catalog cannot be read", async () => {
    listModels.mockResolvedValueOnce(
      catalog({ phase: "summary", provider: "openrouter", status: "unavailable" }),
    );
    renderWithRouter(
      <ModelPicker onChange={vi.fn()} provider="openrouter" stage="summary" value={null} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Modelo/ }));

    expect(
      await screen.findByText(/Não foi possível carregar a lista de modelos/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));

    expect(await screen.findByRole("option", { name: /gemini-3.7-flash/ })).toBeInTheDocument();
  });

  it("warns when the list may be outdated", async () => {
    listModels.mockResolvedValue(
      catalog({
        items: whisper.items,
        status: "stale",
      }),
    );
    renderWithRouter(
      <ModelPicker
        onChange={vi.fn()}
        provider="faster-whisper"
        stage="transcription"
        value={null}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Modelo/ }));

    expect(await screen.findByText(/pode estar desatualizada/)).toBeInTheDocument();
  });

  it("explains an Ollama family without text models", async () => {
    listModels.mockImplementation((_phase, _provider, family) =>
      Promise.resolve(
        family === "qwen3" ? catalog({ phase: "summary", provider: "ollama" }) : ollamaFamilies,
      ),
    );
    renderWithRouter(
      <ModelPicker onChange={vi.fn()} provider="ollama" stage="summary" value={null} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Modelo/ }));
    await userEvent.click(await screen.findByRole("option", { name: /qwen3/ }));

    expect(
      await screen.findByText("Esta família não tem modelos de texto para esta etapa."),
    ).toBeInTheDocument();
  });

  it("shows the download progress of a model in the list", async () => {
    renderWithRouter(
      <ModelPicker
        jobFor={(_provider, model) =>
          model === "large-v3"
            ? {
                completedBytes: 1_545_000_000,
                downloadId: "d1",
                failureCode: null,
                model,
                provider: "faster-whisper",
                status: "downloading",
                totalBytes: 3_090_000_000,
              }
            : undefined
        }
        onChange={vi.fn()}
        provider="faster-whisper"
        stage="transcription"
        value={null}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Modelo/ }));

    expect(await screen.findByRole("option", { name: /large-v3/ })).toHaveTextContent(
      "Baixando 50%",
    );
  });
});
