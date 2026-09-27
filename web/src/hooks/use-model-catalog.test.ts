import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, type ModelCatalog } from "../lib/api";
import { invalidateModelCatalogs, useModelCatalog } from "./use-model-catalog";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ApiError: actual.ApiError, api: { listModels: vi.fn() } };
});

const listModels = vi.mocked(api.listModels);

function aCatalog(overrides: Partial<ModelCatalog> = {}): ModelCatalog {
  return {
    fetchedAt: 1_790_482_294_102,
    installedModels: [],
    inventoryStatus: "available",
    items: [
      {
        compatibility: "recommended",
        installed: false,
        model: "large-v3",
        name: "large-v3",
        sizeBytes: 3_090_835_702,
      },
    ],
    phase: "transcription",
    provider: "faster-whisper",
    status: "fresh",
    ...overrides,
  };
}

afterEach(() => {
  // Unmount first so the invalidation below does not make the last test read again.
  cleanup();
  invalidateModelCatalogs();
  vi.clearAllMocks();
});

describe("useModelCatalog", () => {
  it("loads the catalog of a stage and provider", async () => {
    listModels.mockResolvedValue(aCatalog());

    const { result } = renderHook(() => useModelCatalog("transcription", "faster-whisper"));

    expect(result.current.state.status).toBe("loading");
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(listModels).toHaveBeenCalledWith("transcription", "faster-whisper", undefined);
  });

  it("shares one request between everything that shows the same catalog", async () => {
    listModels.mockResolvedValue(aCatalog());

    const first = renderHook(() => useModelCatalog("transcription", "faster-whisper"));
    const second = renderHook(() => useModelCatalog("transcription", "faster-whisper"));

    await waitFor(() => expect(first.result.current.state.status).toBe("ready"));
    await waitFor(() => expect(second.result.current.state.status).toBe("ready"));
    expect(listModels).toHaveBeenCalledTimes(1);
  });

  it("asks for the variants of an Ollama family", async () => {
    listModels.mockResolvedValue(aCatalog({ phase: "summary", provider: "ollama" }));

    renderHook(() => useModelCatalog("summary", "ollama", "qwen3"));

    await waitFor(() => expect(listModels).toHaveBeenCalledWith("summary", "ollama", "qwen3"));
  });

  it("waits while there is nothing to ask for", () => {
    const { result } = renderHook(() => useModelCatalog("summary", null));

    expect(result.current.state.status).toBe("idle");
    expect(listModels).not.toHaveBeenCalled();
  });

  it("reports why the catalog could not be read and loads it again on retry", async () => {
    listModels.mockRejectedValueOnce(new ApiError(409, "openrouter_api_key_missing"));
    const { result } = renderHook(() => useModelCatalog("summary", "openrouter"));

    await waitFor(() =>
      expect(result.current.state).toEqual({ code: "openrouter_api_key_missing", status: "error" }),
    );

    listModels.mockResolvedValue(aCatalog({ phase: "summary", provider: "openrouter" }));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
  });

  it("reads the catalog again after it is invalidated", async () => {
    listModels.mockResolvedValue(aCatalog());
    const { result } = renderHook(() => useModelCatalog("transcription", "faster-whisper"));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    listModels.mockResolvedValue(
      aCatalog({
        items: [
          {
            compatibility: "recommended",
            installed: true,
            model: "large-v3",
            name: "large-v3",
            sizeBytes: 3_090_835_702,
          },
        ],
      }),
    );
    act(() => invalidateModelCatalogs());

    await waitFor(() => {
      const { state } = result.current;
      expect(state.status === "ready" && state.catalog.items[0]?.installed).toBe(true);
    });
  });
});
