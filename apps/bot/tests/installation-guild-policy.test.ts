import { describe, expect, it } from "vitest";
import { evaluateGuildAccess } from "../src/discord/installation-guild-policy.js";

describe("installation guild policy", () => {
  it("rejects a guild whose owner is not the connected installation account", () => {
    expect(evaluateGuildAccess({ connectedUserId: "owner-a", guildOwnerId: "owner-b" })).toBe(
      "different_owner",
    );
  });

  it("rejects every guild when no Discord account is connected", () => {
    expect(evaluateGuildAccess({ connectedUserId: null, guildOwnerId: "owner-a" })).toBe(
      "account_not_connected",
    );
  });

  it("allows the connected owner to use an installed guild", () => {
    expect(evaluateGuildAccess({ connectedUserId: "owner-a", guildOwnerId: "owner-a" })).toBe(
      "allowed",
    );
  });
});
