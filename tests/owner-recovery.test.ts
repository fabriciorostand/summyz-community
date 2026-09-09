import { describe, expect, it, vi } from "vitest";

import { createOwnerRecoveryAuthorization } from "../src/auth/owner-recovery.js";

describe("createOwnerRecoveryAuthorization", () => {
  it("creates a host-initiated recovery OAuth flow", async () => {
    const discord = {
      createAuthorizationUrl: vi.fn(
        async () => "https://discord.com/oauth2/authorize?state=one-time",
      ),
    };

    await expect(createOwnerRecoveryAuthorization(discord)).resolves.toContain("discord.com");
    expect(discord.createAuthorizationUrl).toHaveBeenCalledWith({ intent: "recovery" });
  });
});
