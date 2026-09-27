import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ModelDownload } from "../src/models/model-download-manager.js";
import {
  ProviderModelTransfer,
  readProgressLines,
  removeOllamaPartials,
} from "../src/models/model-transfer.js";

const digest = `sha256:${"a".repeat(64)}`;
const job: ModelDownload = {
  downloadId: "63d3b8c0-e02a-4fdf-8179-a0feec79e7c1",
  provider: "ollama",
  model: "qwen3:8b",
  status: "downloading",
  completedBytes: 0,
  totalBytes: null,
  partialDigests: [],
  failureCode: null,
};
const response = (value: unknown) => new Response(JSON.stringify(value));

describe("provider model transfers", () => {
  it("pins cleanup digests before streaming and reports aggregate progress", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ config: { digest, size: 10 }, layers: [{ digest, size: 10 }] }),
      )
      .mockResolvedValueOnce(
        new Response(
          `${JSON.stringify({ digest, completed: 7, total: 10 })}\n{"status":"success"}\n`,
        ),
      );
    const progress = vi.fn(async () => {});
    await new ProviderModelTransfer(request).run(job, new AbortController().signal, progress);
    expect(progress.mock.calls).toEqual([
      [{ partialDigests: [digest], totalBytes: 10 }],
      [{ completedBytes: 7 }],
      [{ completedBytes: 10, totalBytes: 10 }],
    ]);
    expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body)).stream).toBe(true);
  });
  it.each(['{"error":"Authorization: secret"}\n', '{"status":"pulling"}\n'])(
    "rejects incomplete or failed streams without exposing provider text",
    async (stream) => {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(response({ config: { digest, size: 10 }, layers: [] }))
        .mockResolvedValueOnce(new Response(stream));
      await expect(
        new ProviderModelTransfer(request).run(job, new AbortController().signal, async () => {}),
      ).rejects.toThrow(/download/);
    },
  );
  it("rejects traversal, missing metadata and changing digests", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 500 }));
    const transfer = new ProviderModelTransfer(request);
    await expect(
      transfer.run({ ...job, model: "../../file" }, new AbortController().signal, async () => {}),
    ).rejects.toThrow("Invalid model identifier");
    await expect(transfer.run(job, new AbortController().signal, async () => {})).rejects.toThrow(
      "metadata unavailable",
    );
    request
      .mockReset()
      .mockResolvedValueOnce(response({ config: { digest, size: 10 }, layers: [] }))
      .mockResolvedValueOnce(
        new Response(`${JSON.stringify({ digest: `sha256:${"b".repeat(64)}`, completed: 10 })}\n`),
      );
    await expect(transfer.run(job, new AbortController().signal, async () => {})).rejects.toThrow(
      "manifest changed",
    );
  });
  it("starts explicit whisper downloads, reads status and confirms cancellation", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ status: "downloading" }))
      .mockResolvedValueOnce(response({ status: "completed", completedBytes: 3, totalBytes: 3 }))
      .mockResolvedValueOnce(response({ status: "cancelled" }));
    const transfer = new ProviderModelTransfer(request);
    const progress = vi.fn(async () => {});
    await transfer.run(
      { ...job, provider: "faster-whisper", model: "tiny" },
      new AbortController().signal,
      progress,
    );
    expect(progress).toHaveBeenCalledWith({ completedBytes: 3, totalBytes: 3 });
    await transfer.cleanup({ ...job, provider: "faster-whisper", model: "tiny" });
    expect(request.mock.calls[2]?.[0]).toContain("download/cancel");
  });
  it.each(["failed", "cancelled"])(
    "rejects whisper %s without exposing error bodies",
    async (status) => {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(response({ status: "downloading" }))
        .mockResolvedValueOnce(response({ status }));
      await expect(
        new ProviderModelTransfer(request).run(
          { ...job, provider: "faster-whisper" },
          new AbortController().signal,
          async () => {},
        ),
      ).rejects.toThrow("download failed");
    },
  );
  it("does not claim cancellation is complete while the sidecar is still writing", async () => {
    const transfer = new ProviderModelTransfer(
      vi.fn<typeof fetch>().mockResolvedValue(response({ status: "cancelling" })),
    );
    await expect(transfer.cleanup({ ...job, provider: "faster-whisper" })).rejects.toThrow(
      "pending",
    );
  });
  it("parses fragmented UTF-8 lines and rejects excessive buffers", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"status":"rea'));
        controller.enqueue(encoder.encode('dy"}\n\n{"status":"done"}'));
        controller.close();
      },
    });
    const lines: unknown[] = [];
    await readProgressLines(stream, async (line) => {
      lines.push(line);
    });
    expect(lines).toEqual([{ status: "ready" }, { status: "done" }]);
    const large = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024 + 1));
        controller.close();
      },
    });
    await expect(readProgressLines(large, async () => {})).rejects.toThrow(
      "Invalid model progress",
    );
  });
  it("removes only the job's partial files and preserves completed or unrelated blobs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-model-partials-"));
    const name = digest.replace(":", "-");
    try {
      await Promise.all(
        [name, `${name}-partial`, `${name}-partial-0`, "unrelated-partial"].map((file) =>
          writeFile(join(directory, file), "content"),
        ),
      );
      await removeOllamaPartials(directory, [digest]);
      await expect(readFile(join(directory, `${name}-partial`))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(readFile(join(directory, name), "utf8")).resolves.toBe("content");
      await expect(readFile(join(directory, "unrelated-partial"), "utf8")).resolves.toBe("content");
      await expect(removeOllamaPartials(directory, ["../../outside"])).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
