import { describe, expect, it } from "vitest";

import {
  completeTranscriptionGroup,
  createTranscriptionState,
  markTranscriptionFailed,
  retryFailedTranscription,
} from "../src/transcription/transcription-state.js";

describe("completeTranscriptionGroup", () => {
  it("persiste o resultado no representante e conclui os demais itens do lote", () => {
    const initial = createTranscriptionState(
      "meeting-1",
      ["silent", "representative", "merged"],
      "2026-08-16T20:00:00.000Z",
    );

    const completed = completeTranscriptionGroup(
      initial,
      {
        audioDurationMs: 4_000,
        representativeSegmentId: "representative",
        result: {
          attempts: 1,
          pieces: [{ endedAtMs: 4_000, startedAtMs: 3_000, text: "Olá." }],
        },
        segmentIds: ["silent", "representative", "merged"],
        timelineStartedAtMs: 10_000,
      },
      "2026-08-16T20:00:01.000Z",
    );

    expect(completed.segments).toEqual([
      { attempts: 0, pieces: [], segmentId: "silent", status: "completed", words: [] },
      {
        attempts: 1,
        audioDurationMs: 4_000,
        pieces: [{ endedAtMs: 4_000, startedAtMs: 3_000, text: "Olá." }],
        segmentId: "representative",
        status: "completed",
        timelineStartedAtMs: 10_000,
        words: [],
      },
      { attempts: 0, pieces: [], segmentId: "merged", status: "completed", words: [] },
    ]);
  });
});

describe("retryFailedTranscription", () => {
  it("reabre somente uma falha do provedor e preserva segmentos concluídos", () => {
    const initial = createTranscriptionState(
      "meeting-1",
      ["segment-1"],
      "2026-08-24T10:00:00.000Z",
    );
    const failed = markTranscriptionFailed(initial, "provider_failed", "2026-08-24T10:01:00.000Z");

    expect(retryFailedTranscription(failed, "2026-08-24T10:02:00.000Z")).toMatchObject({
      segments: initial.segments,
      startedAt: initial.startedAt,
      status: "processing",
      updatedAt: "2026-08-24T10:02:00.000Z",
    });
    expect(() =>
      retryFailedTranscription(
        markTranscriptionFailed(initial, "storage_failed", "2026-08-24T10:01:00.000Z"),
        "2026-08-24T10:02:00.000Z",
      ),
    ).toThrow(/retry/i);
  });

  it("persiste a incompatibilidade recuperável e a remove ao iniciar um novo ciclo", () => {
    const initial = createTranscriptionState(
      "meeting-1",
      ["segment-1"],
      "2026-08-24T10:00:00.000Z",
    );
    const failed = markTranscriptionFailed(
      initial,
      "provider_failed",
      "2026-08-24T10:01:00.000Z",
      "invalid_timestamps",
    );

    expect(failed).toMatchObject({ transcriptionRecoveryReason: "invalid_timestamps" });
    expect(retryFailedTranscription(failed, "2026-08-24T10:02:00.000Z")).not.toHaveProperty(
      "transcriptionRecoveryReason",
    );
  });
});
