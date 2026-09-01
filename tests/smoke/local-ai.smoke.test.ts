import { describe, expect, it } from "vitest";
import { z } from "zod";

const fasterWhisperUrl = process.env.FASTER_WHISPER_SMOKE_URL ?? "http://faster-whisper:8000";
const ollamaUrl = process.env.OLLAMA_SMOKE_URL ?? "http://ollama:11434";
const whisperModel = process.env.SMOKE_WHISPER_MODEL ?? "tiny";
const ollamaModel = process.env.SMOKE_OLLAMA_MODEL ?? "qwen3:1.7b";
const localAiDevice = process.env.SMOKE_LOCAL_AI_DEVICE === "gpu" ? "gpu" : "cpu";
const expectedWhisperDevice = localAiDevice === "gpu" ? "cuda" : "cpu";

describe("serviços locais de IA", () => {
  it("prepara e executa faster-whisper com áudio sintético", async () => {
    const preparation = await fetch(`${fasterWhisperUrl}/models/prepare`, {
      body: JSON.stringify({
        batchSize: 0,
        device: localAiDevice,
        fallback: "none",
        model: whisperModel,
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
    const pull = await fetch(`${ollamaUrl}/api/pull`, {
      body: JSON.stringify({ model: ollamaModel, stream: false }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(pull.ok).toBe(true);

    const response = await fetch(`${ollamaUrl}/api/chat`, {
      body: JSON.stringify({
        format: {
          additionalProperties: false,
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
          type: "object",
        },
        messages: [{ content: 'Return {"ok": true}.', role: "user" }],
        model: ollamaModel,
        stream: false,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(response.ok).toBe(true);
    const body: unknown = await response.json();
    const content = z.object({ message: z.object({ content: z.string() }) }).parse(body)
      .message.content;
    expect(z.object({ ok: z.literal(true) }).parse(JSON.parse(content))).toEqual({ ok: true });

    const processes = await fetch(`${ollamaUrl}/api/ps`);
    expect(processes.ok).toBe(true);
    const active = z
      .object({ models: z.array(z.object({ model: z.string(), size_vram: z.number() })) })
      .parse(await processes.json())
      .models.find((model) => model.model === ollamaModel);
    expect(active).toBeDefined();
    expect((active?.size_vram ?? 0) > 0).toBe(localAiDevice === "gpu");
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
