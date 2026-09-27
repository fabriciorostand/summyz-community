import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { invalidateModelCatalogs } from "../../hooks/use-model-catalog";
import type { ModelDownloads } from "../../hooks/use-model-downloads";
import { ApiError, api, type ModelCatalog, type ModelDownload } from "../../lib/api";
import { renderWithRouter } from "../../tests/test-utils";
import { ModelStatus } from "./model-status";

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ApiError: actual.ApiError, api: { listModels: vi.fn(), uninstallModel: vi.fn() } };
});

const listModels = vi.mocked(api.listModels);

function variants(
  installed: boolean,
  compatibility: ModelCatalog["items"][number]["compatibility"] = "compatible",
): ModelCatalog {
  return {
    fetchedAt: Date.now(),
    installedModels: installed ? [{ model: "qwen3:8b", sizeBytes: 5_200_000_000 }] : [],
    inventoryStatus: "available",
    items: [
      {
        compatibility,
        family: "qwen3",
        installed,
        model: "qwen3:8b",
        name: "qwen3:8b",
        sizeBytes: 5_200_000_000,
      },
    ],
    phase: "summary",
    provider: "ollama",
    status: "fresh",
  };
}

function downloads(job?: Partial<ModelDownload>): ModelDownloads {
  return {
    cancel: vi.fn().mockResolvedValue(undefined),
    jobFor: () =>
      job === undefined
        ? undefined
        : {
            completedBytes: 1_820_000_000,
            downloadId: "d1",
            failureCode: null,
            model: "qwen3:8b",
            provider: "ollama",
            status: "downloading",
            totalBytes: 5_200_000_000,
            ...job,
          },
    listUnavailable: false,
    start: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  listModels.mockResolvedValue(variants(false));
});

afterEach(() => {
  cleanup();
  invalidateModelCatalogs();
  vi.clearAllMocks();
});

describe("ModelStatus", () => {
  it("warns that an external API stage has a cost", () => {
    renderWithRouter(
      <ModelStatus
        downloads={downloads()}
        model="google/gemini-3.7-flash"
        needsModel={false}
        onModelsChanged={vi.fn()}
        provider="openrouter"
        stage="summary"
      />,
    );

    expect(
      screen.getByText(
        "Esta etapa usa o OpenRouter e gera custo por uso, cobrado na sua conta do OpenRouter.",
      ),
    ).toBeInTheDocument();
    expect(listModels).not.toHaveBeenCalled();
  });

  it("asks for a model after the execution changed", () => {
    renderWithRouter(
      <ModelStatus
        downloads={downloads()}
        model={null}
        needsModel
        onModelsChanged={vi.fn()}
        provider="ollama"
        stage="summary"
      />,
    );

    expect(
      screen.getByText("A execução mudou. Escolha um modelo local para esta etapa."),
    ).toBeInTheDocument();
  });

  it("offers to download a local model that is not installed yet", async () => {
    const queue = downloads();
    renderWithRouter(
      <ModelStatus
        downloads={queue}
        model="qwen3:8b"
        needsModel={false}
        onModelsChanged={vi.fn()}
        provider="ollama"
        stage="summary"
      />,
    );

    expect(
      await screen.findByText("qwen3:8b ainda não está instalado (5,2 GB)."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Você pode salvar o perfil, mas ele não vai gravar até o modelo ser baixado/,
      ),
    ).toBeInTheDocument();
    expect(listModels).toHaveBeenCalledWith("summary", "ollama", "qwen3");
    await userEvent.click(screen.getByRole("button", { name: "Baixar agora" }));

    expect(queue.start).toHaveBeenCalledWith("summary", "ollama", "qwen3:8b");
  });

  it("explains why a download could not start", async () => {
    const queue = downloads();
    vi.mocked(queue.start).mockRejectedValue(new ApiError(429, "download_queue_full"));
    renderWithRouter(
      <ModelStatus
        downloads={queue}
        model="qwen3:8b"
        needsModel={false}
        onModelsChanged={vi.fn()}
        provider="ollama"
        stage="summary"
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Baixar agora" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A fila de downloads está cheia. Aguarde um download terminar e tente de novo.",
    );
  });

  it("shows the download progress and lets the person cancel it", async () => {
    const queue = downloads({});
    renderWithRouter(
      <ModelStatus
        downloads={queue}
        model="qwen3:8b"
        needsModel={false}
        onModelsChanged={vi.fn()}
        provider="ollama"
        stage="summary"
      />,
    );

    expect(await screen.findByText("Baixando… 35% de 5,2 GB")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Download de qwen3:8b" })).toHaveAttribute(
      "aria-valuenow",
      "35",
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancelar download" }));

    expect(queue.cancel).toHaveBeenCalledWith("d1");
  });

  it("lets the person retry a failed download", async () => {
    const queue = downloads({ failureCode: "download_failed", status: "failed" });
    renderWithRouter(
      <ModelStatus
        downloads={queue}
        model="qwen3:8b"
        needsModel={false}
        onModelsChanged={vi.fn()}
        provider="ollama"
        stage="summary"
      />,
    );

    expect(await screen.findByText("Não foi possível baixar qwen3:8b.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));

    expect(queue.start).toHaveBeenCalledWith("summary", "ollama", "qwen3:8b");
  });

  it("uninstalls an installed model after confirmation", async () => {
    listModels.mockResolvedValue(variants(true));
    vi.mocked(api.uninstallModel).mockResolvedValue(undefined);
    const onModelsChanged = vi.fn();
    renderWithRouter(
      <ModelStatus
        downloads={downloads()}
        model="qwen3:8b"
        needsModel={false}
        onModelsChanged={onModelsChanged}
        provider="ollama"
        stage="summary"
      />,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Desinstalar modelo" }));
    expect(screen.getByRole("alertdialog", { name: "Desinstalar qwen3:8b?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Desinstalar" }));

    expect(api.uninstallModel).toHaveBeenCalledWith("ollama", "qwen3:8b");
    expect(onModelsChanged).toHaveBeenCalled();
  });

  it("keeps the model when the person gives up the uninstall", async () => {
    listModels.mockResolvedValue(variants(true));
    renderWithRouter(
      <ModelStatus
        downloads={downloads()}
        model="qwen3:8b"
        needsModel={false}
        onModelsChanged={vi.fn()}
        provider="ollama"
        stage="summary"
      />,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Desinstalar modelo" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.uninstallModel).not.toHaveBeenCalled();
  });

  it("explains an uninstall the server refuses", async () => {
    listModels.mockResolvedValue(variants(true));
    vi.mocked(api.uninstallModel).mockRejectedValue(new ApiError(409, "model_in_use"));
    renderWithRouter(
      <ModelStatus
        downloads={downloads()}
        model="qwen3:8b"
        needsModel={false}
        onModelsChanged={vi.fn()}
        provider="ollama"
        stage="summary"
      />,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Desinstalar modelo" }));
    await userEvent.click(screen.getByRole("button", { name: "Desinstalar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Uma gravação ou reunião em processamento ainda usa este modelo.",
    );
  });

  it("warns strongly about a model this machine cannot run", async () => {
    listModels.mockResolvedValue(variants(true, "incompatible"));
    renderWithRouter(
      <ModelStatus
        downloads={downloads()}
        model="qwen3:8b"
        needsModel={false}
        onModelsChanged={vi.fn()}
        provider="ollama"
        stage="summary"
      />,
    );

    expect(
      await screen.findByText(
        /Este modelo é incompatível com esta máquina e o bot não grava com ele/,
      ),
    ).toBeInTheDocument();
  });

  it("warns about a model above what this machine recommends", async () => {
    listModels.mockResolvedValue(variants(true, "above_recommended"));
    renderWithRouter(
      <ModelStatus
        downloads={downloads()}
        model="qwen3:8b"
        needsModel={false}
        onModelsChanged={vi.fn()}
        provider="ollama"
        stage="summary"
      />,
    );

    expect(await screen.findByText(/pode ficar lento ou falhar/)).toBeInTheDocument();
  });

  it("says when it cannot check the local installation", async () => {
    listModels.mockResolvedValue({ ...variants(false), inventoryStatus: "unavailable", items: [] });
    renderWithRouter(
      <ModelStatus
        downloads={downloads()}
        model="qwen3:8b"
        needsModel={false}
        onModelsChanged={vi.fn()}
        provider="ollama"
        stage="summary"
      />,
    );

    expect(
      await screen.findByText(
        "Não foi possível verificar se qwen3:8b está instalado nesta máquina.",
      ),
    ).toBeInTheDocument();
  });
});
