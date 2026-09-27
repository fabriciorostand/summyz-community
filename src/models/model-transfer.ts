import { lstat, readdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { DownloadPatch, ModelDownload, ModelTransfer } from "./model-download-manager.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const progressSchema = z.object({
  status: z.string().optional(),
  error: z.string().optional(),
  digest: digestSchema.optional(),
  completed: z.number().nonnegative().optional(),
  total: z.number().nonnegative().optional(),
});
const whisperStatusSchema = z.object({
  status: z.enum(["downloading", "completed", "cancelled", "failed", "unknown", "cancelling"]),
  completedBytes: z.number().nonnegative().optional(),
  totalBytes: z.number().nonnegative().nullable().optional(),
});
const layerSchema = z.object({ digest: digestSchema, size: z.number().nonnegative() });

export class ProviderModelTransfer implements ModelTransfer {
  public constructor(
    private readonly request: typeof fetch = fetch,
    private readonly blobsRoot = "/models/ollama/models/blobs",
  ) {}
  public async run(
    job: ModelDownload,
    signal: AbortSignal,
    progress: (patch: DownloadPatch) => Promise<void>,
  ): Promise<void> {
    signal = AbortSignal.any([signal, AbortSignal.timeout(24 * 60 * 60_000)]);
    if (job.provider === "ollama") return this.#ollama(job, signal, progress);
    await this.#whisperRequest("download", job.model, signal);
    while (true) {
      signal.throwIfAborted();
      const status = whisperStatusSchema.parse(
        await this.#whisperRequest("download/status", job.model, signal),
      );
      await progress({
        completedBytes: status.completedBytes ?? 0,
        totalBytes: status.totalBytes ?? null,
      });
      if (status.status === "completed") return;
      if (status.status === "unknown") await this.#whisperRequest("download", job.model, signal);
      if (status.status === "failed" || status.status === "cancelled")
        throw new Error("Model download failed");
      await delay(1_000, undefined, { signal });
    }
  }
  public async cleanup(job: ModelDownload): Promise<void> {
    if (job.provider === "faster-whisper") {
      const result = whisperStatusSchema.parse(
        await this.#whisperRequest("download/cancel", job.model),
      );
      if (result.status !== "cancelled") throw new Error("Model cancellation is still pending");
      return;
    }
    await delay(1_000);
    await removeOllamaPartials(this.blobsRoot, job.partialDigests);
  }
  async #whisperRequest(path: string, model: string, signal?: AbortSignal): Promise<unknown> {
    const response = await this.request(`http://faster-whisper:8000/models/${path}`, {
      method: "POST",
      body: JSON.stringify({ model }),
      headers: { "Content-Type": "application/json" },
      signal:
        signal === undefined
          ? AbortSignal.timeout(50_000)
          : AbortSignal.any([signal, AbortSignal.timeout(50_000)]),
    });
    if (!response.ok) throw new Error("Model service unavailable");
    return response.json();
  }
  async #ollama(
    job: ModelDownload,
    signal: AbortSignal,
    progress: (patch: DownloadPatch) => Promise<void>,
  ): Promise<void> {
    const match = /^([a-z0-9][a-z0-9._-]*):([A-Za-z0-9._-]+)$/.exec(job.model);
    if (match === null) throw new Error("Invalid model identifier");
    const metadata = await this.request(
      `https://registry.ollama.ai/v2/library/${match[1]}/manifests/${match[2]}`,
      { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]), redirect: "error" },
    );
    if (!metadata.ok) throw new Error("Model metadata unavailable");
    const manifest = z
      .object({ config: layerSchema, layers: z.array(layerSchema).max(1000) })
      .parse(await metadata.json());
    const layers = new Map(
      [...manifest.layers, manifest.config].map((layer) => [layer.digest, layer.size]),
    );
    const totalBytes = [...layers.values()].reduce((sum, size) => sum + size, 0);
    if (totalBytes > 1024 ** 4) throw new Error("Model download exceeds storage limit");
    await progress({
      partialDigests: [...new Set([...job.partialDigests, ...layers.keys()])],
      totalBytes,
    });
    const response = await this.request("http://ollama:11434/api/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: job.model, stream: true }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(24 * 60 * 60_000)]),
    });
    if (!response.ok || response.body === null) throw new Error("Model download unavailable");
    const completed = new Map<string, number>();
    let success = false;
    await readProgressLines(response.body, async (value) => {
      const event = progressSchema.parse(value);
      if (event.error !== undefined) throw new Error("Model download failed");
      if (event.digest !== undefined) {
        if (!layers.has(event.digest)) throw new Error("Model manifest changed during download");
        completed.set(
          event.digest,
          event.completed ??
            (event.status?.startsWith("pulling") === true ? 0 : (layers.get(event.digest) ?? 0)),
        );
        await progress({
          completedBytes: [...completed.values()].reduce((sum, count) => sum + count, 0),
        });
      }
      if (event.status === "success") success = true;
    });
    if (!success) throw new Error("Incomplete model download");
    await progress({ completedBytes: totalBytes, totalBytes });
  }
}

export async function readProgressLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (value: unknown) => Promise<void>,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const chunk = await reader.read();
      pending += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      if (pending.length > 1024 * 1024) throw new Error("Invalid model progress stream");
      let index = pending.indexOf("\n");
      while (index >= 0) {
        const line = pending.slice(0, index).trim();
        pending = pending.slice(index + 1);
        if (line.length > 0) await onLine(JSON.parse(line));
        index = pending.indexOf("\n");
      }
      if (chunk.done) break;
    }
    if (pending.trim().length > 0) await onLine(JSON.parse(pending));
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

export async function removeOllamaPartials(
  root: string,
  digests: readonly string[],
): Promise<void> {
  if (digests.length === 0) return;
  const prefixes = digests.map(
    (digest) => `${digestSchema.parse(digest).replace(":", "-")}-partial`,
  );
  for (const name of await readdir(root)) {
    if (
      !prefixes.some(
        (prefix) =>
          name === prefix ||
          (name.startsWith(`${prefix}-`) && /^\d+$/.test(name.slice(prefix.length + 1))),
      )
    )
      continue;
    const path = resolve(root, name);
    if (!(await lstat(path)).isFile()) throw new Error("Invalid model partial file");
    await unlink(path);
  }
}
