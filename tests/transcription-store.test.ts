import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  completeTranscriptionSegment,
  createTranscriptionState,
  markTranscriptionCompleted,
  markTranscriptionFailed,
} from "../src/transcription/transcription-state.js";
import { TranscriptionStore } from "../src/transcription/transcription-store.js";

describe("TranscriptionStore", () => {
  it("rejeita estados impossíveis antes da persistência", () => {
    expect(() =>
      createTranscriptionState("meeting-1", ["segment-1", "segment-1"], "2026-08-16T20:00:00.000Z"),
    ).toThrow(/duplicados/i);
    const pending = createTranscriptionState(
      "meeting-1",
      ["segment-1"],
      "2026-08-16T20:00:00.000Z",
    );
    expect(() =>
      completeTranscriptionSegment(
        pending,
        "missing",
        {
          attempts: 1,
          pieces: [{ endedAtMs: 1, startedAtMs: 0, text: "texto" }],
        },
        "2026-08-16T20:01:00.000Z",
      ),
    ).toThrow(/não pertence/i);
    expect(() => markTranscriptionCompleted(pending, "2026-08-16T20:01:00.000Z")).toThrow(
      /pendentes/i,
    );
  });

  it("persiste resultados por segmento e escreve o txt atomicamente", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-transcriptions-"));
    const store = new TranscriptionStore(root);
    const initial = createTranscriptionState(
      "meeting-1",
      ["segment-1"],
      "2026-08-16T20:00:00.000Z",
    );
    const withSegment = completeTranscriptionSegment(
      initial,
      "segment-1",
      {
        attempts: 2,
        pieces: [{ endedAtMs: 1_000, startedAtMs: 0, text: "Olá" }],
      },
      "2026-08-16T20:01:00.000Z",
    );

    await store.save(withSegment);
    await expect(access(store.transcriptPath("meeting-1"))).rejects.toThrow();
    await store.writeTranscript("meeting-1", "transcrição completa\n");
    await store.save(markTranscriptionCompleted(withSegment, "2026-08-16T20:02:00.000Z"));

    await expect(store.load("meeting-1")).resolves.toMatchObject({ status: "completed" });
    await expect(readFile(store.transcriptPath("meeting-1"), "utf8")).resolves.toBe(
      "transcrição completa\n",
    );
  });

  it("preserva a primeira transcrição bruta mesmo após o arquivo final ser revisado", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-transcriptions-"));
    const store = new TranscriptionStore(root);
    await store.writeTranscript("meeting-1", "texto bruto\n");

    await expect(store.preserveRawTranscript("meeting-1")).resolves.toBe("texto bruto\n");
    await store.writeTranscript("meeting-1", "texto revisado\n");
    await expect(store.preserveRawTranscript("meeting-1")).resolves.toBe("texto bruto\n");
    await expect(readFile(store.rawTranscriptPath("meeting-1"), "utf8")).resolves.toBe(
      "texto bruto\n",
    );
  });

  it("rejeita identificadores e caminhos que escapam do diretório", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-transcriptions-"));
    const store = new TranscriptionStore(root);

    await expect(store.load("../outside")).rejects.toThrow(/identificador/i);
    expect(() => store.resolveMeetingFile("meeting-1", "../outside.ogg")).toThrow(/caminho/i);
    expect(() => store.resolveMeetingFile("meeting-1", "")).toThrow(/caminho/i);
    expect(() => store.resolveMeetingFile("meeting-1", "C:\\outside.ogg")).toThrow(/caminho/i);
  });

  it("retorna listas vazias quando o diretório ainda não existe", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-transcriptions-"));
    const store = new TranscriptionStore(join(root, "missing"));

    await expect(store.tryLoad("meeting-1")).resolves.toBeUndefined();
  });

  it("prepara uma falha de provedor para nova execução durável", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-transcriptions-"));
    const store = new TranscriptionStore(root);
    await store.save(
      markTranscriptionFailed(
        createTranscriptionState("meeting-1", ["segment-1"], "2026-08-24T10:00:00.000Z"),
        "provider_failed",
        "2026-08-24T10:01:00.000Z",
      ),
    );

    await store.prepareRetry("meeting-1", "2026-08-24T10:02:00.000Z");

    await expect(store.load("meeting-1")).resolves.toMatchObject({ status: "processing" });
  });

  it("propaga arquivos inválidos", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-transcriptions-"));
    const store = new TranscriptionStore(root);
    await mkdir(store.meetingDirectory("meeting-1"), { recursive: true });
    await writeFile(
      store.resolveMeetingFile("meeting-1", "transcription.json"),
      "inválido",
      "utf8",
    );
    await expect(store.tryLoad("meeting-1")).rejects.toThrow();
    await rm(store.meetingDirectory("meeting-1"), { recursive: true });

    await store.writeTranscript("meeting-2", "texto bruto\n");
    await mkdir(store.rawTranscriptPath("meeting-2"));
    await expect(store.preserveRawTranscript("meeting-2")).rejects.toThrow();
  });
});
