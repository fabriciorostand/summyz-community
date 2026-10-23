import { describe, expect, it } from "vitest";

import { aiProfileSchema, createInitialAiProfile } from "../src/ai-profile.js";

describe("global AI profiles", () => {
  it("creates localized templates without a Discord owner", () => {
    const profiles = [
      createInitialAiProfile("external", "pt-BR"),
      createInitialAiProfile("local", "pt-BR"),
    ];

    expect(profiles.map(({ name, profileType }) => ({ name, profileType }))).toEqual([
      { name: "Perfil 1", profileType: "external" },
      { name: "Perfil 1", profileType: "local" },
    ]);
    expect(JSON.stringify(profiles)).not.toContain("userId");
  });

  it("rejects a legacy Discord owner field", () => {
    const profile = createInitialAiProfile("local", "en");

    expect(
      aiProfileSchema.safeParse({ ...profile, ownerDiscordUserId: "discord-user" }).success,
    ).toBe(false);
    expect(profile).not.toHaveProperty("userId");
  });
});
