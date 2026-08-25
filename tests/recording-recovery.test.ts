import { describe, expect, it } from "vitest";

import { createManifest } from "../src/recording/manifest.js";
import { decideRecovery, finalizeInterruptedRecovery } from "../src/recording/recovery.js";

describe("recuperação de gravação", () => {
  it("retoma uma call com pessoas e finaliza uma call vazia", () => {
    expect(decideRecovery({ humanCount: 2, manifestStatus: "recording" })).toBe("resume");
    expect(decideRecovery({ humanCount: 0, manifestStatus: "recording" })).toBe(
      "finalize_interrupted",
    );
  });

  it("preserva a interrupção e conclui a call parcial após reinício", () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-24T10:00:00.000Z",
      voiceChannelId: "voice-1",
    });

    const recovered = finalizeInterruptedRecovery(manifest, "2026-08-24T10:10:00.000Z");

    expect(recovered).toMatchObject({
      completedAt: "2026-08-24T10:10:00.000Z",
      interruptions: [{ at: "2026-08-24T10:10:00.000Z", reason: "process_restart" }],
      status: "completed",
    });
  });
});
