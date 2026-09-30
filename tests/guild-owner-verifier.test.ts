import { describe, expect, it, vi } from "vitest";
import { GuildOwnerVerifier } from "../src/discord/guild-owner-verifier.js";

describe("GuildOwnerVerifier", () => {
  it("distinguishes confirmed denial from a temporary lookup failure", async () => {
    const logger = { warn: vi.fn() };
    const verifier = new GuildOwnerVerifier(
      async () => "owner-a",
      async () => true,
      logger,
      5_000,
    );
    expect(await verifier.check("guild-1", "owner-a")).toEqual({
      status: "allowed",
      connectedUserId: "owner-a",
    });
    expect(await verifier.check("guild-1", "owner-b")).toEqual({
      status: "denied",
      connectedUserId: "owner-b",
      reason: "different_owner",
    });

    const failing = new GuildOwnerVerifier(
      async () => {
        throw new Error("temporary Discord failure");
      },
      async () => true,
      logger,
      5_000,
    );
    expect(await failing.check("guild-1", "owner-a")).toEqual({
      status: "unknown",
      connectedUserId: "owner-a",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: "guild-1", errorType: "Error" }),
      "Unable to verify guild ownership",
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("temporary Discord failure");
  });

  it("requires confirmation even when the linked account owns the guild", async () => {
    const verifier = new GuildOwnerVerifier(
      async () => "owner-a",
      async () => false,
      { warn: vi.fn() },
      5_000,
    );

    await expect(verifier.check("guild-1", "owner-a")).resolves.toEqual({
      status: "denied",
      connectedUserId: "owner-a",
      reason: "approval_missing",
    });
  });

  it("times out a stalled Discord lookup without multiplying requests", async () => {
    vi.useFakeTimers();
    try {
      let resolveOwner: ((ownerId: string) => void) | undefined;
      const fetchOwnerId = vi.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveOwner = resolve;
          }),
      );
      const verifier = new GuildOwnerVerifier(
        fetchOwnerId,
        vi.fn(async () => true),
        { warn: vi.fn() },
        5_000,
      );

      const first = verifier.check("guild-1", "owner-a");
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await first).toEqual({ status: "unknown", connectedUserId: "owner-a" });

      const second = verifier.check("guild-1", "owner-b");
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await second).toEqual({ status: "unknown", connectedUserId: "owner-b" });
      expect(fetchOwnerId).toHaveBeenCalledTimes(1);

      const third = verifier.check("guild-1", "owner-b");
      resolveOwner?.("owner-a");
      expect(await third).toEqual({
        status: "denied",
        connectedUserId: "owner-b",
        reason: "different_owner",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
