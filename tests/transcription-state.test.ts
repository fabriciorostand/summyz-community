import { describe, expect, it } from "vitest";

import {
  completeTranscriptionGroup,
  createTranscriptionState,
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
      { attempts: 0, pieces: [], segmentId: "silent", status: "completed" },
      {
        attempts: 1,
        audioDurationMs: 4_000,
        pieces: [{ endedAtMs: 4_000, startedAtMs: 3_000, text: "Olá." }],
        segmentId: "representative",
        status: "completed",
        timelineStartedAtMs: 10_000,
      },
      { attempts: 0, pieces: [], segmentId: "merged", status: "completed" },
    ]);
  });
});
