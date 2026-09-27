import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, type ModelDownload } from "../lib/api";
import { useModelDownloads } from "./use-model-downloads";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ApiError: actual.ApiError,
    api: {
      cancelModelDownload: vi.fn(),
      listModelDownloads: vi.fn(),
      startModelDownload: vi.fn(),
    },
  };
});

const listDownloads = vi.mocked(api.listModelDownloads);

function aDownload(overrides: Partial<ModelDownload> = {}): ModelDownload {
  return {
    completedBytes: 0,
    downloadId: "d1",
    failureCode: null,
    model: "qwen3:8b",
    provider: "ollama",
    status: "downloading",
    totalBytes: 5_200_000_000,
    ...overrides,
  };
}

beforeEach(() => {
  listDownloads.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("useModelDownloads", () => {
  it("shows a download already running when the page opens", async () => {
    listDownloads.mockResolvedValue([aDownload({ completedBytes: 1_300_000_000 })]);

    const { result } = renderHook(() => useModelDownloads(vi.fn()));

    await waitFor(() =>
      expect(result.current.jobFor("ollama", "qwen3:8b")?.status).toBe("downloading"),
    );
    expect(result.current.jobFor("ollama", "qwen3:8b")?.completedBytes).toBe(1_300_000_000);
  });

  it("ignores downloads that finished before the page opened", async () => {
    listDownloads.mockResolvedValue([
      aDownload({ status: "failed", failureCode: "download_failed" }),
      aDownload({
        downloadId: "d0",
        model: "tiny",
        provider: "faster-whisper",
        status: "completed",
      }),
    ]);

    const { result } = renderHook(() => useModelDownloads(vi.fn()));

    await waitFor(() => expect(listDownloads).toHaveBeenCalled());
    expect(result.current.jobFor("ollama", "qwen3:8b")).toBeUndefined();
    expect(result.current.jobFor("faster-whisper", "tiny")).toBeUndefined();
  });

  it("follows a started download until it completes and reports it once", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onSettled = vi.fn();
    vi.mocked(api.startModelDownload).mockResolvedValue(aDownload({ status: "queued" }));
    const { result } = renderHook(() => useModelDownloads(onSettled));
    await waitFor(() => expect(listDownloads).toHaveBeenCalledTimes(1));

    listDownloads.mockResolvedValue([aDownload({ completedBytes: 2_600_000_000 })]);
    await act(() => result.current.start("summary", "ollama", "qwen3:8b"));
    expect(result.current.jobFor("ollama", "qwen3:8b")?.status).toBe("queued");

    await act(() => vi.advanceTimersByTimeAsync(1_500));
    expect(result.current.jobFor("ollama", "qwen3:8b")?.completedBytes).toBe(2_600_000_000);

    listDownloads.mockResolvedValue([
      aDownload({ completedBytes: 5_200_000_000, status: "completed" }),
    ]);
    await act(() => vi.advanceTimersByTimeAsync(1_500));
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
    expect(result.current.jobFor("ollama", "qwen3:8b")).toBeUndefined();

    const calls = listDownloads.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(listDownloads).toHaveBeenCalledTimes(calls);
  });

  it("keeps a failed download of this visit so the person can retry", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onSettled = vi.fn();
    vi.mocked(api.startModelDownload).mockResolvedValue(aDownload());
    const { result } = renderHook(() => useModelDownloads(onSettled));
    await waitFor(() => expect(listDownloads).toHaveBeenCalledTimes(1));

    listDownloads.mockResolvedValue([
      aDownload({ failureCode: "download_failed", status: "failed" }),
    ]);
    await act(() => result.current.start("summary", "ollama", "qwen3:8b"));
    await act(() => vi.advanceTimersByTimeAsync(1_500));

    expect(result.current.jobFor("ollama", "qwen3:8b")?.status).toBe("failed");
    expect(onSettled).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("asks the server to cancel and shows the cancellation until it ends", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listDownloads.mockResolvedValue([aDownload()]);
    vi.mocked(api.cancelModelDownload).mockResolvedValue({ status: "cancelling" });
    const { result } = renderHook(() => useModelDownloads(vi.fn()));
    await waitFor(() => expect(result.current.jobFor("ollama", "qwen3:8b")).toBeDefined());

    await act(() => result.current.cancel("d1"));
    expect(api.cancelModelDownload).toHaveBeenCalledWith("d1");
    expect(result.current.jobFor("ollama", "qwen3:8b")?.status).toBe("cancelling");

    listDownloads.mockResolvedValue([aDownload({ status: "cancelled" })]);
    await act(() => vi.advanceTimersByTimeAsync(1_500));
    expect(result.current.jobFor("ollama", "qwen3:8b")).toBeUndefined();
  });

  it("rejects a start the server refuses so the caller can explain it", async () => {
    vi.mocked(api.startModelDownload).mockRejectedValue(new ApiError(429, "download_queue_full"));
    const { result } = renderHook(() => useModelDownloads(vi.fn()));
    await waitFor(() => expect(listDownloads).toHaveBeenCalled());

    await expect(result.current.start("summary", "ollama", "qwen3:8b")).rejects.toMatchObject({
      code: "download_queue_full",
    });
  });

  it("keeps working when the download list cannot be read", async () => {
    listDownloads.mockRejectedValue(new ApiError(503, "model_service_unavailable"));

    const { result } = renderHook(() => useModelDownloads(vi.fn()));

    await waitFor(() => expect(result.current.listUnavailable).toBe(true));
    expect(result.current.jobFor("ollama", "qwen3:8b")).toBeUndefined();
  });
});
