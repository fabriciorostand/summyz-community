import { describe, expect, it, vi } from "vitest";
import { GuildMembershipVerifier } from "../src/discord/guild-membership-verifier.js";

describe("GuildMembershipVerifier", () => {
  it("distinguishes confirmed removal from a temporary Discord failure", async () => {
    const fetchGuild = vi
      .fn<(_guildId: string) => Promise<void>>()
      .mockRejectedValueOnce({ code: 10004 })
      .mockRejectedValueOnce({ code: 50001 })
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(undefined);
    const warn = vi.fn();
    const verifier = new GuildMembershipVerifier(fetchGuild, { warn });

    await expect(verifier.check("guild-1")).resolves.toBe("absent");
    await expect(verifier.check("guild-1")).resolves.toBe("absent");
    await expect(verifier.check("guild-1")).resolves.toBe("unknown");
    await expect(verifier.check("guild-1")).resolves.toBe("present");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("keeps processing when Discord rejects with an unrecognized error shape", async () => {
    const warn = vi.fn();
    const fetchGuild = vi
      .fn<(_guildId: string) => Promise<void>>()
      .mockRejectedValueOnce(null)
      .mockRejectedValueOnce({ detail: "rate limited" })
      .mockRejectedValueOnce({ code: 50013 })
      .mockRejectedValueOnce("network disconnected");
    const verifier = new GuildMembershipVerifier(fetchGuild, { warn });

    await expect(verifier.check("guild-1")).resolves.toBe("unknown");
    await expect(verifier.check("guild-1")).resolves.toBe("unknown");
    await expect(verifier.check("guild-1")).resolves.toBe("unknown");
    await expect(verifier.check("guild-1")).resolves.toBe("unknown");
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it("returns unknown when a Discord membership lookup never settles", async () => {
    const warn = vi.fn();
    const verifier = new GuildMembershipVerifier(
      () => new Promise<unknown>(() => undefined),
      { warn },
      1,
    );

    await expect(verifier.check("guild-1")).resolves.toBe("unknown");
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: "guild-1" }),
      "Unable to verify bot guild membership",
    );
  });
});
