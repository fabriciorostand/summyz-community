import { describe, expect, it } from "vitest";

import type { RecordingSegment } from "../src/recording/manifest.js";
import {
  composeTranscriptionBatch,
  createAnalyzedTranscriptionGroups,
  createTranscriptionGroups,
  mapTranscriptPiecesToTimeline,
} from "../src/transcription/transcription-batch.js";

function segment(input: {
  durationMs: number;
  segmentId: string;
  startedAtMs: number;
  userId?: string;
}): RecordingSegment {
  return {
    durationMs: input.durationMs,
    endedAtMs: input.startedAtMs + input.durationMs,
    file: `participants/${input.userId ?? "user-a"}/${input.segmentId}.ogg`,
    format: "ogg_opus",
    segmentId: input.segmentId,
    startedAtMs: input.startedAtMs,
    status: "ready",
    userDisplayName: input.userId ?? "Ana",
    userId: input.userId ?? "user-a",
  };
}

describe("createTranscriptionGroups", () => {
  it("consolida somente segmentos próximos da mesma pessoa dentro da janela", () => {
    const segments = [
      segment({ durationMs: 2_000, segmentId: "a-1", startedAtMs: 0 }),
      segment({ durationMs: 1_000, segmentId: "b-1", startedAtMs: 1_000, userId: "user-b" }),
      segment({ durationMs: 2_000, segmentId: "a-2", startedAtMs: 3_500 }),
      segment({ durationMs: 1_000, segmentId: "a-3", startedAtMs: 8_000 }),
      segment({ durationMs: 2_000, segmentId: "a-4", startedAtMs: 37_000 }),
    ];

    const groups = createTranscriptionGroups(segments, {
      maxGapMs: 2_000,
      maxWindowMs: 30_000,
    });

    expect(groups.map((group) => group.map((item) => item.segmentId))).toEqual([
      ["a-1", "a-2"],
      ["b-1"],
      ["a-3"],
      ["a-4"],
    ]);
  });

  it("não usa segmentos silenciosos para aproximar falas distantes", () => {
    const first = segment({ durationMs: 1_000, segmentId: "speech-1", startedAtMs: 0 });
    const silent = segment({ durationMs: 1_000, segmentId: "silent", startedAtMs: 2_500 });
    const last = segment({ durationMs: 1_000, segmentId: "speech-2", startedAtMs: 5_000 });
    const samples = new Float32Array(16_000);

    const groups = createAnalyzedTranscriptionGroups(
      [
        {
          containsSpeech: true,
          samples,
          segment: first,
          speechRanges: [{ endedAtSample: 16_000, startedAtSample: 0 }],
        },
        { containsSpeech: false, samples, segment: silent, speechRanges: [] },
        {
          containsSpeech: true,
          samples,
          segment: last,
          speechRanges: [{ endedAtSample: 16_000, startedAtSample: 0 }],
        },
      ],
      { maxGapMs: 2_000, maxWindowMs: 30_000 },
    );

    expect(groups.map((group) => group.map((item) => item.segment.segmentId))).toEqual([
      ["speech-1"],
      ["speech-2"],
    ]);
  });
});

describe("composeTranscriptionBatch", () => {
  it("insere silêncio sintético configurado sem alterar o mapeamento da reunião", () => {
    const first = segment({ durationMs: 1_000, segmentId: "speech-1", startedAtMs: 0 });
    const second = segment({ durationMs: 1_000, segmentId: "speech-2", startedAtMs: 2_000 });
    const batch = composeTranscriptionBatch(
      [
        {
          containsSpeech: true,
          samples: new Float32Array(16_000).fill(0.25),
          segment: first,
          speechRanges: [{ endedAtSample: 16_000, startedAtSample: 0 }],
        },
        {
          containsSpeech: true,
          samples: new Float32Array(16_000).fill(-0.25),
          segment: second,
          speechRanges: [{ endedAtSample: 16_000, startedAtSample: 0 }],
        },
      ],
      16_000,
      350,
    );
    if (batch === undefined) {
      throw new Error("O teste exige um lote");
    }

    expect(batch.audioDurationMs).toBe(2_350);
    expect(batch.audio.readUInt32LE(40)).toBe(75_200);
    expect(batch.audio.readInt16LE(44 + 16_000 * 2)).toBe(0);
    expect(batch.audio.readInt16LE(44 + 21_600 * 2)).toBeLessThan(0);
    expect(
      mapTranscriptPiecesToTimeline(batch, [
        { endedAtMs: 1_000, startedAtMs: 0, text: "Primeira." },
        { endedAtMs: 2_350, startedAtMs: 1_350, text: "Segunda." },
      ]),
    ).toEqual([
      { endedAtMs: 1_000, startedAtMs: 0, text: "Primeira." },
      { endedAtMs: 3_000, startedAtMs: 2_000, text: "Segunda." },
    ]);
  });

  it("descarta itens sem voz e preserva o intervalo real como silêncio", () => {
    const first = segment({ durationMs: 1_000, segmentId: "silent", startedAtMs: 0 });
    const second = segment({ durationMs: 1_000, segmentId: "speech-1", startedAtMs: 1_000 });
    const third = segment({ durationMs: 1_000, segmentId: "speech-2", startedAtMs: 2_500 });

    const batch = composeTranscriptionBatch(
      [
        {
          containsSpeech: false,
          samples: new Float32Array(16_000),
          segment: first,
          speechRanges: [],
        },
        {
          containsSpeech: true,
          samples: new Float32Array(16_000).fill(0.25),
          segment: second,
          speechRanges: [{ endedAtSample: 16_000, startedAtSample: 0 }],
        },
        {
          containsSpeech: true,
          samples: new Float32Array(16_000).fill(-0.25),
          segment: third,
          speechRanges: [{ endedAtSample: 16_000, startedAtSample: 8_000 }],
        },
      ],
      16_000,
    );

    expect(batch).toMatchObject({
      audioDurationMs: 1_500,
      durationMs: 2_500,
      representativeSegmentId: "speech-1",
      segmentIds: ["silent", "speech-1", "speech-2"],
      timelineStartedAtMs: 1_000,
    });
    expect(batch?.audio.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(batch?.audio.readUInt32LE(40)).toBe(48_000);
    expect(batch?.audio.readInt16LE(44)).toBeGreaterThan(0);
    expect(batch?.audio.readInt16LE(44 + 16_000 * 2)).toBeLessThan(0);

    expect(
      batch === undefined
        ? undefined
        : mapTranscriptPiecesToTimeline(batch, [
            { endedAtMs: 1_400, startedAtMs: 1_100, text: "Mapeada." },
          ]),
    ).toEqual([{ endedAtMs: 2_400, startedAtMs: 2_100, text: "Mapeada." }]);
  });

  it("não cria lote quando nenhum segmento contém voz", () => {
    const only = segment({ durationMs: 1_000, segmentId: "silent", startedAtMs: 0 });

    expect(
      composeTranscriptionBatch(
        [
          {
            containsSpeech: false,
            samples: new Float32Array(16_000),
            segment: only,
            speechRanges: [],
          },
        ],
        16_000,
      ),
    ).toBeUndefined();
  });

  it("rejeita resultados inconsistentes do detector de voz", () => {
    const only = segment({ durationMs: 1_000, segmentId: "invalid", startedAtMs: 0 });

    expect(() =>
      composeTranscriptionBatch([
        {
          containsSpeech: true,
          samples: new Float32Array(16_000),
          segment: only,
          speechRanges: [],
        },
      ]),
    ).toThrow(/inconsistente/i);
    expect(() =>
      composeTranscriptionBatch([
        {
          containsSpeech: true,
          samples: new Float32Array(16_000),
          segment: only,
          speechRanges: [{ endedAtSample: 16_001, startedAtSample: 0 }],
        },
      ]),
    ).toThrow(/intervalo inválido/i);
  });

  it("rejeita timestamps do provedor fora do áudio compactado", () => {
    const only = segment({ durationMs: 1_000, segmentId: "speech", startedAtMs: 0 });
    const batch = composeTranscriptionBatch([
      {
        containsSpeech: true,
        samples: new Float32Array(16_000),
        segment: only,
        speechRanges: [{ endedAtSample: 16_000, startedAtSample: 0 }],
      },
    ]);
    if (batch === undefined) {
      throw new Error("O teste exige um lote");
    }

    expect(() =>
      mapTranscriptPiecesToTimeline(batch, [
        { endedAtMs: 1_101, startedAtMs: 1_000, text: "Fora." },
      ]),
    ).toThrow(/fora do áudio/i);
    expect(() =>
      mapTranscriptPiecesToTimeline(batch, [
        { endedAtMs: 100, startedAtMs: 100, text: "Inválido." },
      ]),
    ).toThrow(/fora do áudio/i);
  });
});
