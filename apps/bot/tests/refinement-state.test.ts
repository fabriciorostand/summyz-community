import { describe, expect, it } from "vitest";

import {
  createRefinementState,
  markRefinementCompleted,
  markRefinementFallback,
} from "../src/refinement/refinement-state.js";

const entries = [
  {
    endedAtMs: 2_000,
    id: "segment-1:000000",
    speaker: "Fab",
    startedAtMs: 1_000,
    text: "conjuntivite",
  },
] as const;

describe("estado do refinamento", () => {
  it("persiste o texto revisado com as tentativas", () => {
    const state = createRefinementState("meeting-1", "2026-08-17T10:00:00.000Z");
    expect(markRefinementCompleted(state, entries, 2, "2026-08-17T10:01:00.000Z")).toMatchObject({
      attempts: 2,
      entries,
      status: "completed",
    });
  });

  it("persiste o original no fallback sem resposta do provedor", () => {
    const state = createRefinementState("meeting-1", "2026-08-17T10:00:00.000Z");
    expect(markRefinementFallback(state, entries, 3, "2026-08-17T10:01:00.000Z")).toMatchObject({
      attempts: 3,
      entries,
      failureCode: "provider_failed",
      status: "fallback",
    });
  });
});
