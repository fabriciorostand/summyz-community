import { describe, expect, it } from "vitest";

import { addSegment, createManifest } from "../src/recording/manifest.js";
import {
  assembleTranscript,
  assembleTranscriptEntries,
  assembleTranscriptFromEntries,
} from "../src/transcription/transcript-assembler.js";

function createMeeting() {
  const manifest = createManifest({
    guildId: "guild-1",
    meetingId: "meeting-1",
    notificationChannelId: "text-1",
    startedAt: "2026-08-16T20:00:00.000Z",
    voiceChannelId: "voice-1",
  });

  return addSegment(
    addSegment(manifest, {
      durationMs: 5_000,
      endedAtMs: 15_000,
      file: "participants/user-a/segment-a.ogg",
      segmentId: "segment-a",
      startedAtMs: 10_000,
      userDisplayName: "Ana",
      userId: "user-a",
    }),
    {
      durationMs: 2_000,
      endedAtMs: 14_000,
      file: "participants/user-b/segment-b.ogg",
      segmentId: "segment-b",
      startedAtMs: 12_000,
      userDisplayName: "Bruno",
      userId: "user-b",
    },
  );
}

describe("montagem da transcrição", () => {
  it("intercala falas pelos timestamps absolutos e preserva sobreposições", () => {
    const transcript = assembleTranscript(createMeeting(), [
      {
        pieces: [{ endedAtMs: 5_000, startedAtMs: 0, text: "Vamos publicar amanhã." }],
        segmentId: "segment-a",
      },
      {
        pieces: [{ endedAtMs: 2_000, startedAtMs: 0, text: "Concordo." }],
        segmentId: "segment-b",
      },
    ]);

    expect(transcript).toBe(
      "[00:00:10.000 – 00:00:15.000] Ana: Vamos publicar amanhã.\n" +
        "[00:00:12.000 – 00:00:14.000] Bruno: Concordo.\n",
    );
  });

  it("expõe entradas estruturadas estáveis para as etapas posteriores", () => {
    const entries = assembleTranscriptEntries(createMeeting(), [
      {
        pieces: [{ endedAtMs: 5_000, startedAtMs: 0, text: "Vamos publicar amanhã." }],
        segmentId: "segment-a",
      },
      {
        pieces: [{ endedAtMs: 2_000, startedAtMs: 0, text: "Concordo." }],
        segmentId: "segment-b",
      },
    ]);

    expect(entries).toEqual([
      {
        endedAtMs: 15_000,
        id: "segment-a:000000",
        speaker: "Ana",
        startedAtMs: 10_000,
        text: "Vamos publicar amanhã.",
      },
      {
        endedAtMs: 14_000,
        id: "segment-b:000000",
        speaker: "Bruno",
        startedAtMs: 12_000,
        text: "Concordo.",
      },
    ]);
  });

  it("remonta o arquivo usando somente os metadados preservados e o texto revisado", () => {
    expect(
      assembleTranscriptFromEntries([
        {
          endedAtMs: 15_000,
          id: "segment-a:000000",
          speaker: "Ana",
          startedAtMs: 10_000,
          text: "Conjuntivite corrigida.",
        },
      ]),
    ).toBe("[00:00:10.000 – 00:00:15.000] Ana: Conjuntivite corrigida.\n");
  });

  it("desambigua nomes de exibição iguais sem expor userId", () => {
    const manifest = addSegment(createMeeting(), {
      durationMs: 1_000,
      endedAtMs: 17_000,
      file: "participants/user-c/segment-c.ogg",
      segmentId: "segment-c",
      startedAtMs: 16_000,
      userDisplayName: "Ana",
      userId: "user-c",
    });

    const transcript = assembleTranscript(manifest, [
      {
        pieces: [{ endedAtMs: 1_000, startedAtMs: 0, text: "Primeira Ana." }],
        segmentId: "segment-a",
      },
      {
        pieces: [{ endedAtMs: 1_000, startedAtMs: 0, text: "Segunda Ana." }],
        segmentId: "segment-c",
      },
      {
        pieces: [{ endedAtMs: 1_000, startedAtMs: 0, text: "Bruno." }],
        segmentId: "segment-b",
      },
    ]);

    expect(transcript).toContain("Ana #1: Primeira Ana.");
    expect(transcript).toContain("Ana #2: Segunda Ana.");
    expect(transcript).toContain("Bruno: Bruno.");
    expect(transcript).not.toContain("user-a");
    expect(transcript).not.toContain("user-c");
  });

  it("rejeita resultados ausentes ou timestamps fora do segmento", () => {
    expect(() => assembleTranscript(createMeeting(), [])).toThrow(/segmentos/i);
    expect(() =>
      assembleTranscript(createMeeting(), [
        { pieces: [], segmentId: "segment-a" },
        { pieces: [], segmentId: "segment-extra" },
      ]),
    ).toThrow(/segmentos/i);
    expect(() =>
      assembleTranscript(createMeeting(), [
        {
          pieces: [{ endedAtMs: 6_000, startedAtMs: 0, text: "Inválido" }],
          segmentId: "segment-a",
        },
        {
          pieces: [{ endedAtMs: 2_000, startedAtMs: 0, text: "Válido" }],
          segmentId: "segment-b",
        },
      ]),
    ).toThrow(/timestamp/i);
  });

  it("omite segmentos confirmados como silêncio sem invalidar a reunião", () => {
    const transcript = assembleTranscript(createMeeting(), [
      { pieces: [], segmentId: "segment-a" },
      {
        pieces: [{ endedAtMs: 1_000, startedAtMs: 0, text: "Fala válida." }],
        segmentId: "segment-b",
      },
    ]);

    expect(transcript).toBe("[00:00:12.000 – 00:00:13.000] Bruno: Fala válida.\n");
  });

  it("usa a origem temporal do lote consolidado", () => {
    const manifest = addSegment(createMeeting(), {
      durationMs: 2_000,
      endedAtMs: 18_000,
      file: "participants/user-a/segment-c.ogg",
      segmentId: "segment-c",
      startedAtMs: 16_000,
      userDisplayName: "Ana",
      userId: "user-a",
    });

    const transcript = assembleTranscript(manifest, [
      {
        audioDurationMs: 8_000,
        pieces: [{ endedAtMs: 8_000, startedAtMs: 6_000, text: "Fala consolidada." }],
        segmentId: "segment-a",
        timelineStartedAtMs: 10_000,
      },
      { pieces: [], segmentId: "segment-b" },
      { pieces: [], segmentId: "segment-c" },
    ]);

    expect(transcript).toBe("[00:00:16.000 – 00:00:18.000] Ana: Fala consolidada.\n");
  });

  it("gera arquivo vazio quando todos os lotes forem silêncio", () => {
    expect(
      assembleTranscript(createMeeting(), [
        { pieces: [], segmentId: "segment-a" },
        { pieces: [], segmentId: "segment-b" },
      ]),
    ).toBe("");
  });
});
