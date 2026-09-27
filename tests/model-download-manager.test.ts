import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logger.js";
import {
  type DownloadStore,
  type ModelDownload,
  ModelDownloadManager,
  type ModelTransfer,
} from "../src/models/model-download-manager.js";

function fixture() {
  const job: ModelDownload = {
    downloadId: "b7ed5a38-5bed-4f1e-92dc-f1d2a57b9554",
    provider: "ollama",
    model: "qwen3:8b",
    status: "downloading",
    completedBytes: 10,
    totalBytes: 100,
    partialDigests: [],
    failureCode: null,
  };
  const store: DownloadStore = {
    list: vi.fn(async () => [job]),
    get: vi.fn(async () => job),
    create: vi.fn(async () => job),
    update: vi.fn(async (_id, patch) => {
      Object.assign(job, patch);
    }),
  };
  const transfer = {
    run: vi.fn<ModelTransfer["run"]>(async () => {}),
    cleanup: vi.fn(async () => {}),
  };
  const logger = createLogger("silent");
  const manager = new ModelDownloadManager(store, transfer, logger);
  return { job, store, transfer, manager, logger };
}

describe("durable model downloads", () => {
  it("aborts active cancellation, persists progress and cleans only after the transfer stops", async () => {
    const { job, transfer, manager } = fixture();
    transfer.run.mockImplementation(async (_job, signal, progress) => {
      await progress({ completedBytes: 50 });
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
      );
    });
    const running = manager.processNext();
    await vi.waitFor(() => expect(job.completedBytes).toBe(50));
    await manager.processNext();
    await manager.cancel(job.downloadId);
    await running;
    expect(transfer.run).toHaveBeenCalledOnce();
    expect(transfer.cleanup).toHaveBeenCalledOnce();
    expect(job.status).toBe("cancelled");
    await manager.cancel(job.downloadId);
    expect(job.status).toBe("cancelled");
  });
  it("preserves interrupted transfers for restart and sanitizes scheduler errors", async () => {
    const { job, transfer, manager, store, logger } = fixture();
    transfer.run.mockImplementation(async (_job, signal) => {
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("shutdown")), { once: true }),
      );
    });
    const running = manager.processNext();
    await vi.waitFor(() => expect(transfer.run).toHaveBeenCalledOnce());
    await manager.shutdown();
    await running;
    expect(job.status).toBe("downloading");
    expect(transfer.cleanup).not.toHaveBeenCalled();
    vi.useFakeTimers();
    try {
      const errorLog = vi.spyOn(logger, "error");
      vi.mocked(store.list).mockRejectedValue(new Error("Bearer secret-provider-key"));
      manager.start();
      manager.start();
      await vi.advanceTimersByTimeAsync(1000);
      expect(errorLog).toHaveBeenCalledOnce();
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain("secret-provider-key");
      await manager.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });
  it("retries failed cleanup without losing the failure state", async () => {
    const { job, transfer, manager } = fixture();
    transfer.run.mockRejectedValue(new Error("failed"));
    transfer.cleanup.mockRejectedValue(new Error("locked"));
    await expect(manager.processNext()).rejects.toThrow("locked");
    expect(job).toMatchObject({ status: "cancelling", failureCode: "download_failed" });
    transfer.cleanup.mockResolvedValue();
    await manager.processNext();
    expect(job.status).toBe("failed");
  });
  it("does not launch a job when shutdown happens during polling", async () => {
    const { store, transfer, manager } = fixture();
    vi.mocked(store.list).mockImplementation(async () => {
      await manager.shutdown();
      return [];
    });
    await manager.processNext();
    expect(transfer.run).not.toHaveBeenCalled();
    await expect(manager.cancel("unknown")).resolves.toBeUndefined();
    vi.mocked(store.get).mockResolvedValue(undefined);
    await expect(manager.cancel("unknown")).rejects.toMatchObject({ code: "download_not_found" });
  });
  it("resumes persisted in-progress downloads and marks success", async () => {
    const { job, transfer, manager } = fixture();
    await manager.processNext();
    expect(transfer.run).toHaveBeenCalledOnce();
    expect(job.status).toBe("completed");
  });
  it("cleans partials after cancellation and sanitizes provider failures", async () => {
    const { job, transfer, manager } = fixture();
    job.status = "cancelling";
    await manager.processNext();
    expect(transfer.cleanup).toHaveBeenCalledOnce();
    expect(job.status).toBe("cancelled");
    job.status = "queued";
    transfer.run.mockRejectedValue(new Error("Authorization: secret"));
    await manager.processNext();
    expect(job.status).toBe("failed");
    expect(job.failureCode).toBe("download_failed");
    expect(JSON.stringify(job)).not.toContain("secret");
  });
});
