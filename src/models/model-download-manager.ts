import type { Logger } from "pino";
import { z } from "zod";
import { ModelOperationError } from "./model-catalog.js";

export const downloadSchema = z.object({
  downloadId: z.uuid(),
  provider: z.enum(["ollama", "faster-whisper"]),
  model: z.string().min(1).max(256),
  status: z.enum(["queued", "downloading", "completed", "cancelling", "cancelled", "failed"]),
  completedBytes: z.number().nonnegative(),
  totalBytes: z.number().nonnegative().nullable(),
  partialDigests: z.array(z.string().regex(/^sha256:[a-f0-9]{64}$/)),
  failureCode: z.string().nullable(),
});
export type ModelDownload = z.infer<typeof downloadSchema>;
export type DownloadPatch = Partial<
  Pick<ModelDownload, "status" | "completedBytes" | "totalBytes" | "partialDigests" | "failureCode">
>;
export interface DownloadStore {
  list(): Promise<ModelDownload[]>;
  get(id: string): Promise<ModelDownload | undefined>;
  create(provider: ModelDownload["provider"], model: string): Promise<ModelDownload>;
  update(id: string, patch: DownloadPatch): Promise<void>;
}
export interface ModelTransfer {
  run(
    job: ModelDownload,
    signal: AbortSignal,
    progress: (patch: DownloadPatch) => Promise<void>,
  ): Promise<void>;
  cleanup(job: ModelDownload): Promise<void>;
}
export class ModelDownloadManager {
  #active: { id: string; controller: AbortController; promise: Promise<void> } | undefined;
  #polling = false;
  #stopping = false;
  #timer: NodeJS.Timeout | undefined;
  public constructor(
    public readonly store: DownloadStore,
    private readonly transfer: ModelTransfer,
    private readonly logger: Logger,
  ) {}
  public start(): void {
    if (this.#timer !== undefined) return;
    this.#stopping = false;
    this.#timer = setInterval(() => {
      void this.processNext().catch((error: unknown) =>
        this.logger.error(
          { errorType: error instanceof Error ? error.name : typeof error },
          "Model download scheduler failed",
        ),
      );
    }, 1_000);
    this.#timer.unref();
  }
  public async cancel(id: string): Promise<void> {
    const job = await this.store.get(id);
    if (job === undefined) throw new ModelOperationError("download_not_found", 404);
    if (["completed", "cancelled", "failed"].includes(job.status)) return;
    await this.store.update(id, { status: "cancelling" });
    if (this.#active?.id === id) this.#active.controller.abort();
  }
  public async shutdown(): Promise<void> {
    this.#stopping = true;
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
    this.#active?.controller.abort();
    await this.#active?.promise;
  }
  public async processNext(): Promise<void> {
    if (this.#active !== undefined || this.#polling || this.#stopping) return;
    this.#polling = true;
    try {
      const job = (await this.store.list()).find((candidate) =>
        ["queued", "downloading", "cancelling"].includes(candidate.status),
      );
      if (job === undefined || this.#stopping) return;
      const controller = new AbortController();
      const promise = this.#run(job, controller.signal);
      this.#active = { id: job.downloadId, controller, promise };
      await promise;
    } finally {
      this.#active = undefined;
      this.#polling = false;
    }
  }
  async #run(job: ModelDownload, signal: AbortSignal): Promise<void> {
    const id = job.downloadId;
    try {
      if (job.status === "cancelling") {
        await this.#clean(job, job.failureCode === "download_failed" ? "failed" : "cancelled");
        return;
      }
      await this.store.update(id, { status: "downloading", failureCode: null });
      this.logger.info(
        { downloadId: id, provider: job.provider, model: job.model },
        "Model download started or resumed",
      );
      await this.transfer.run(job, signal, async (patch) => {
        Object.assign(job, patch);
        await this.store.update(id, patch);
      });
      if ((await this.store.get(id))?.status === "cancelling") {
        await this.#clean(job, "cancelled");
        return;
      }
      await this.store.update(id, { status: "completed" });
      this.logger.info({ downloadId: id }, "Model download completed");
    } catch (error) {
      if (this.#stopping) return;
      const current = await this.store.get(id);
      const cancelled =
        current?.status === "cancelling" && current.failureCode !== "download_failed";
      await this.#clean(job, cancelled ? "cancelled" : "failed");
      this.logger.warn(
        { downloadId: id, errorType: error instanceof Error ? error.name : typeof error },
        "Model download stopped",
      );
    }
  }
  async #clean(job: ModelDownload, status: "cancelled" | "failed"): Promise<void> {
    await this.store.update(job.downloadId, {
      status: "cancelling",
      failureCode: status === "failed" ? "download_failed" : null,
    });
    await this.transfer.cleanup(job);
    await this.store.update(job.downloadId, {
      status,
      completedBytes: 0,
      partialDigests: [],
      failureCode: status === "failed" ? "download_failed" : null,
    });
  }
}
