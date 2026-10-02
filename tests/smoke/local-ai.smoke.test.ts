import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { requestOllamaStructured } from "../../src/local-ai/ollama-client.js";
import { ProviderModelTransfer } from "../../src/models/model-transfer.js";
import {
  parseOllamaFamilies,
  parseOllamaVariants,
  readPublicLibrary,
} from "../../src/models/ollama-library.js";

const fasterWhisperUrl = process.env.FASTER_WHISPER_SMOKE_URL ?? "http://faster-whisper:8000";
const fasterWhisperManagementUrl = process.env.FASTER_WHISPER_MANAGEMENT_URL ?? fasterWhisperUrl;
const ollamaUrl = process.env.OLLAMA_SMOKE_URL ?? "http://ollama:11434";
const ollamaManagementUrl = process.env.OLLAMA_MANAGEMENT_URL ?? ollamaUrl;
const whisperModel = process.env.SMOKE_WHISPER_MODEL ?? "tiny";
const whisperRevision =
  process.env.SMOKE_WHISPER_REVISION ?? "d90ca5fe260221311c53c58e660288d3deb8d356";
const ollamaModel = process.env.SMOKE_OLLAMA_MODEL ?? "qwen3:1.7b";
const ollamaDigest =
  process.env.SMOKE_OLLAMA_DIGEST ??
  "sha256:8f68893c685c3ddff2aa3fffce2aa60a30bb2da65ca488b61fff134a4d1730e7";
const localAiDevice = process.env.SMOKE_LOCAL_AI_DEVICE === "gpu" ? "gpu" : "cpu";
const expectedWhisperDevice = localAiDevice === "gpu" ? "cuda" : "cpu";

describe("serviços locais de IA", () => {
  it("consulta a biblioteca pública e os catálogos locais sem baixar modelos", async () => {
    const families = parseOllamaFamilies(await readPublicLibrary(""));
    expect(families.some((item) => item.family === "qwen3")).toBe(true);
    const variants = parseOllamaVariants(await readPublicLibrary("/qwen3/tags"), "qwen3");
    expect(variants.some((item) => item.model === "qwen3:1.7b" && (item.sizeBytes ?? 0) > 0)).toBe(
      true,
    );
    const catalog = await fetch(`${fasterWhisperUrl}/models/catalog`);
    expect(
      z
        .object({ items: z.array(z.object({ model: z.string() })) })
        .parse(await catalog.json())
        .items.some((item) => item.model === "tiny"),
    ).toBe(true);
    const missing = await fetch(`${fasterWhisperUrl}/models/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "not-an-installed-model" }),
    });
    expect(missing.status).toBe(409);
  });
  it("prepara e executa faster-whisper com áudio sintético", async () => {
    const selection = { model: whisperModel, revision: whisperRevision };
    const download = await fetch(`${fasterWhisperManagementUrl}/models/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(selection),
    });
    expect(download.ok).toBe(true);
    let ready = false;
    const deadline = Date.now() + 25 * 60_000;
    while (!ready && Date.now() < deadline) {
      const response = await fetch(`${fasterWhisperManagementUrl}/models/download/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selection),
      });
      const state = z.object({ status: z.string() }).parse(await response.json());
      expect(["failed", "cancelled"]).not.toContain(state.status);
      ready = state.status === "completed";
      if (!ready) await delay(1_000);
    }
    expect(ready).toBe(true);
    const preparation = await fetch(`${fasterWhisperUrl}/models/prepare`, {
      body: JSON.stringify({
        batchSize: 0,
        device: localAiDevice,
        fallback: "none",
        model: whisperModel,
        revision: whisperRevision,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(preparation.ok).toBe(true);
    expect(
      z
        .object({
          device: z.enum(["cpu", "cuda"]),
          fallbackApplied: z.boolean(),
          multilingual: z.literal(true),
        })
        .parse(await preparation.json()),
    ).toMatchObject({
      device: expectedWhisperDevice,
      fallbackApplied: false,
      multilingual: true,
    });

    const form = new FormData();
    form.set("audio", new Blob([createSilentWav(500)]), "synthetic.wav");
    form.set("language", "auto");
    form.set("model", whisperModel);
    form.set("revision", whisperRevision);
    form.set("device", localAiDevice);
    form.set("fallback", "none");
    form.set("batchSize", "0");
    const response = await fetch(`${fasterWhisperUrl}/transcribe`, { body: form, method: "POST" });
    expect(response.ok).toBe(true);
    const result: unknown = await response.json();
    expect(
      z
        .object({
          text: z.string(),
          words: z.array(z.object({ end: z.number(), start: z.number() })),
        })
        .parse(result),
    ).toMatchObject({ text: expect.any(String), words: expect.any(Array) });
  });

  it("baixa e valida saída estruturada do Ollama", async () => {
    const transfer = new ProviderModelTransfer((url, init) =>
      fetch(String(url).replace("http://ollama:11434", ollamaManagementUrl), init),
    );
    let completedBytes = 0;
    await transfer.run(
      {
        downloadId: "00000000-0000-4000-8000-000000000001",
        provider: "ollama",
        model: ollamaModel,
        status: "downloading",
        completedBytes: 0,
        totalBytes: null,
        partialDigests: [],
        failureCode: null,
      },
      new AbortController().signal,
      async (patch) => {
        if (patch.completedBytes !== undefined) completedBytes = patch.completedBytes;
      },
    );
    expect(completedBytes).toBeGreaterThan(0);

    const tags = await fetch(`${ollamaUrl}/api/tags`);
    expect(tags.ok).toBe(true);
    const pulledModel = z
      .object({
        models: z.array(z.object({ digest: z.string(), model: z.string() })),
      })
      .parse(await tags.json())
      .models.find((model) => model.model === ollamaModel);
    expect(canonicalSha256(pulledModel?.digest)).toBe(canonicalSha256(ollamaDigest));

    await expect(
      requestOllamaStructured({
        baseUrl: ollamaUrl,
        device: localAiDevice,
        input: {},
        instruction: 'Return {"ok": true}.',
        jsonSchema: {
          additionalProperties: false,
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
          type: "object",
        },
        model: ollamaModel,
        outputSchema: z.object({ ok: z.literal(true) }),
        timeoutMs: 120_000,
      }),
    ).resolves.toEqual({ ok: true });

    const processes = await fetch(`${ollamaUrl}/api/ps`);
    expect(processes.ok).toBe(true);
    const active = z
      .object({ models: z.array(z.object({ model: z.string() })) })
      .parse(await processes.json())
      .models.find((model) => model.model === ollamaModel);
    expect(active).toBeDefined();
  });
});

function createSilentWav(durationMs: number): ArrayBuffer {
  const sampleRate = 16_000;
  const sampleCount = Math.round((sampleRate * durationMs) / 1_000);
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeAscii(view, 8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, sampleCount * 2, true);
  return buffer;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function canonicalSha256(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.startsWith("sha256:") ? value : `sha256:${value}`;
}
