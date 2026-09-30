import { describe, expect, it, vi } from "vitest";

import {
  createManifest,
  markManifestInterrupted,
  recordingManifestSchema,
} from "../src/recording/manifest.js";
import {
  completeRecordingAfterStop,
  decideRecovery,
  finalizeDeletedChannelRecovery,
  finalizeInterruptedRecovery,
  hasRecoveryWindowExpired,
  interruptAfterRestart,
  recoverRecording,
  shouldAttemptPendingRecovery,
} from "../src/recording/recovery.js";

describe("recuperação de gravação", () => {
  it("preserves the verified owner in new manifests and accepts older manifests without it", () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-24T09:00:00.000Z",
      verifiedOwnerUserId: "owner-1",
      voiceChannelId: "voice-1",
    });
    expect(
      recordingManifestSchema.parse(JSON.parse(JSON.stringify(manifest))).verifiedOwnerUserId,
    ).toBe("owner-1");
    expect(
      recordingManifestSchema.parse({ ...manifest, verifiedOwnerUserId: undefined }),
    ).toBeDefined();
  });

  it("expires recovery thirty minutes after suspension, not after meeting start", () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-24T09:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    const interrupted = markManifestInterrupted(
      manifest,
      "2026-08-24T10:00:00.000Z",
      "access_unverified",
    );

    expect(hasRecoveryWindowExpired(interrupted, "2026-08-24T10:29:59.000Z")).toBe(false);
    expect(hasRecoveryWindowExpired(interrupted, "2026-08-24T10:30:00.000Z")).toBe(true);
  });

  it("uses the prior bot heartbeat for an abrupt process restart", () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-24T09:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    const interrupted = interruptAfterRestart(manifest, "2026-08-24T10:00:00.000Z");

    expect(interrupted.interruptions.at(-1)).toMatchObject({
      at: "2026-08-24T10:00:00.000Z",
      reason: "process_restart",
    });
    expect(hasRecoveryWindowExpired(interrupted, "2026-08-24T10:31:00.000Z")).toBe(true);
  });

  it("does not count the full meeting duration when no prior heartbeat is available", () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-24T09:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    const interrupted = interruptAfterRestart(manifest, undefined, "2026-08-24T10:00:00.000Z");

    expect(interrupted.interruptions.at(-1)?.at).toBe("2026-08-24T10:00:00.000Z");
    expect(hasRecoveryWindowExpired(interrupted, "2026-08-24T10:00:01.000Z")).toBe(false);
  });

  it("marks a deleted-channel result for publication only when ownership is unavailable", () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-24T09:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    const interrupted = markManifestInterrupted(
      manifest,
      "2026-08-24T10:00:00.000Z",
      "access_unverified",
    );
    const completedAt = "2026-08-24T10:05:00.000Z";

    expect(finalizeDeletedChannelRecovery(interrupted, completedAt).interruptions.at(-1)).toEqual({
      at: completedAt,
      reason: "voice_channel_deleted_unverified",
    });
    expect(
      finalizeDeletedChannelRecovery(interrupted, completedAt, false).interruptions.at(-1),
    ).toEqual({
      at: completedAt,
      reason: "voice_channel_deleted",
    });
  });

  it("does not auto-resume a recording whose initial voice join failed", () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-24T09:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    expect(shouldAttemptPendingRecovery(manifest)).toBe(true);
    expect(
      shouldAttemptPendingRecovery(
        markManifestInterrupted(manifest, "2026-08-24T09:00:01.000Z", "voice_join_failed"),
      ),
    ).toBe(false);
  });
  it("records a proven ownership transfer on the completed meeting", () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-24T10:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    const completedAt = "2026-08-24T10:10:00.000Z";

    expect(completeRecordingAfterStop(manifest, completedAt, "owner_changed")).toMatchObject({
      completedAt,
      interruptions: [{ at: completedAt, reason: "owner_changed" }],
      status: "completed",
    });
    expect(completeRecordingAfterStop(manifest, completedAt, "command").interruptions).toEqual([]);
    expect(
      completeRecordingAfterStop(
        markManifestInterrupted(manifest, "2026-08-24T10:05:00.000Z", "access_unverified"),
        completedAt,
        "owner_changed",
      ).interruptions.at(-1),
    ).toEqual({ at: completedAt, reason: "owner_changed" });
  });
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

  it("concludes a recoverable recording without rejoining voice when owner access changed", async () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-24T10:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    const resume = vi.fn(async () => undefined);
    const finalize = vi.fn(async () => undefined);

    await recoverRecording(manifest, { checkAccess: async () => "denied", finalize, resume });

    expect(finalize).toHaveBeenCalledWith(manifest);
    expect(resume).not.toHaveBeenCalled();
  });

  it("resumes recording only after confirming current owner access", async () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-24T10:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    const resume = vi.fn(async () => undefined);
    const finalize = vi.fn(async () => undefined);

    await recoverRecording(manifest, { checkAccess: async () => "allowed", finalize, resume });

    expect(resume).toHaveBeenCalledWith(manifest);
    expect(finalize).not.toHaveBeenCalled();
  });

  it("keeps a recording recoverable when ownership cannot be checked", async () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-24T10:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    const resume = vi.fn(async () => undefined);
    const finalize = vi.fn(async () => undefined);

    await recoverRecording(manifest, { checkAccess: async () => "unknown", finalize, resume });

    expect(resume).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
    expect(manifest.status).toBe("recording");
  });
});
