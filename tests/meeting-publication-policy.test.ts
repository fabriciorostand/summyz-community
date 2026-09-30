import { describe, expect, it } from "vitest";
import { isProvenRecordedOwnerTransfer } from "../src/discord/meeting-publication-policy.js";
import { createManifest } from "../src/recording/manifest.js";

const manifest = createManifest({
  guildId: "guild-1",
  meetingId: "meeting-1",
  notificationChannelId: "text-1",
  startedAt: "2026-08-24T10:00:00.000Z",
  voiceChannelId: "voice-1",
});

describe("recorded owner transfer", () => {
  it("recognizes only a verified change from the owner pinned at recording start", () => {
    const pinned = { ...manifest, verifiedOwnerUserId: "owner-a" };
    expect(
      isProvenRecordedOwnerTransfer(pinned, {
        status: "denied",
        connectedUserId: "owner-a",
        reason: "different_owner",
      }),
    ).toBe(true);
    expect(
      isProvenRecordedOwnerTransfer(pinned, {
        status: "denied",
        connectedUserId: "owner-b",
        reason: "different_owner",
      }),
    ).toBe(false);
    expect(
      isProvenRecordedOwnerTransfer(manifest, {
        status: "denied",
        connectedUserId: "owner-a",
        reason: "different_owner",
      }),
    ).toBe(false);
    expect(isProvenRecordedOwnerTransfer(pinned, { status: "unknown" })).toBe(false);
  });
});
