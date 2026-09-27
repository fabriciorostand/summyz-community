import { describe, expect, it } from "vitest";
import { aiProfileSchema, createInitialAiProfile, resolveAiProfile } from "../src/ai-profile.js";
import { profileBodySchema } from "../src/api/server-contracts.js";
import { meetingAiConfigurationSchema } from "../src/recording/manifest.js";

describe("stage provider selection", () => {
  it("calculates hybrid from providers and ignores the submitted profile type", () => {
    const external = createInitialAiProfile("external", "en");
    const local = createInitialAiProfile("local", "en");
    const profile = aiProfileSchema.parse({
      ...external,
      transcription: { ...local.transcription, model: "small" },
      refinement: { ...external.refinement, model: "vendor/text" },
      summary: { ...local.summary, model: "qwen3:8b" },
    });
    expect(profile.profileType).toBe("hybrid");
    expect(meetingAiConfigurationSchema.parse(resolveAiProfile(profile)).profileType).toBe(
      "hybrid",
    );
    const { profileId: _, ...body } = profile;
    expect(profileBodySchema.parse({ ...body, profileType: "ignored" }).profileType).toBe("hybrid");
  });

  it("allows an empty stored template but requires every provider and model on API writes", () => {
    const base = createInitialAiProfile("external", "en");
    const empty = aiProfileSchema.parse({
      ...base,
      transcription: { ...base.transcription, provider: null },
      refinement: { ...base.refinement, provider: null },
      summary: { ...base.summary, provider: null },
    });
    expect(empty.profileType).toBeNull();
    expect(() => resolveAiProfile(empty)).toThrow(/incomplete/i);
    const { profileId: _, ...body } = empty;
    expect(profileBodySchema.safeParse(body).success).toBe(false);
  });
});
