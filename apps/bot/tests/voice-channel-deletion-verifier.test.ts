import { ChannelType } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { VoiceChannelDeletionVerifier } from "../src/discord/voice-channel-deletion-verifier.js";

describe("VoiceChannelDeletionVerifier", () => {
  const startedAt = "2026-08-24T10:00:00.000Z";

  it("requires explicit deletion evidence when the HTTP API returns unknown channel", async () => {
    const logger = { warn: vi.fn() };
    const noEvidence = new VoiceChannelDeletionVerifier(
      async () => {
        throw { code: 10003, status: 404, message: "sensitive detail" };
      },
      async () => false,
      logger,
      5_000,
    );
    const audited = new VoiceChannelDeletionVerifier(
      async () => {
        throw { code: 10003, status: 404 };
      },
      async () => true,
      logger,
      5_000,
    );
    const unavailable = new VoiceChannelDeletionVerifier(
      async () => {
        throw { code: 10003, status: 503 };
      },
      async () => true,
      logger,
      5_000,
    );
    const active = new VoiceChannelDeletionVerifier(
      async () => ({ type: ChannelType.GuildVoice }),
      async () => true,
      logger,
      5_000,
    );

    expect(await noEvidence.check("guild-1", "voice-1", startedAt)).toBe("unknown");
    expect(await audited.check("guild-1", "voice-1", startedAt)).toBe("deleted");
    expect(await unavailable.check("guild-1", "voice-1", startedAt)).toBe("unknown");
    expect(await active.check("guild-1", "voice-1", startedAt)).toBe("exists");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("sensitive detail");
  });

  it("accepts a channel deletion event only for a meeting already underway", async () => {
    const verifier = new VoiceChannelDeletionVerifier(
      async () => {
        throw { code: 10003, status: 404 };
      },
      async () => false,
      { warn: vi.fn() },
      5_000,
    );
    verifier.noteDeletion("guild-1", "voice-1", Date.parse("2026-08-24T09:59:00.000Z"));
    expect(await verifier.check("guild-1", "voice-1", startedAt)).toBe("unknown");
    verifier.noteDeletion("guild-2", "voice-1", Date.parse("2026-08-24T10:05:00.000Z"));
    expect(await verifier.check("guild-1", "voice-1", startedAt)).toBe("unknown");
    verifier.noteDeletion("guild-1", "voice-1", Date.parse("2026-08-24T10:05:00.000Z"));
    expect(await verifier.check("guild-1", "voice-1", startedAt)).toBe("deleted");
  });

  it("keeps deletion unverified when audit lookup fails without logging credentials", async () => {
    const logger = { warn: vi.fn() };
    const verifier = new VoiceChannelDeletionVerifier(
      async () => {
        throw { code: 10003, status: 404 };
      },
      async () => {
        throw new Error("authorization: sensitive-token");
      },
      logger,
      5_000,
    );

    expect(await verifier.check("guild-1", "voice-1", startedAt)).toBe("unknown");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("sensitive-token");
  });

  it("times out a stalled lookup without starting another request", async () => {
    vi.useFakeTimers();
    try {
      const fetchChannel = vi.fn(() => new Promise<unknown>(() => undefined));
      const verifier = new VoiceChannelDeletionVerifier(
        fetchChannel,
        async () => false,
        { warn: vi.fn() },
        5_000,
      );
      const first = verifier.check("guild-1", "voice-1", startedAt);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await first).toBe("unknown");
      const second = verifier.check("guild-1", "voice-1", startedAt);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await second).toBe("unknown");
      expect(fetchChannel).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
