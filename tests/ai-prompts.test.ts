import { describe, expect, it } from "vitest";
import { aiProfileSchema, createInitialAiProfile, resolveAiProfile } from "../src/ai-profile.js";
import { createDefaultAiPrompts } from "../src/ai-prompts.js";

describe("profile prompt ownership", () => {
  it("uses the setup language only for the initial name and stores English defaults", () => {
    const profile = createInitialAiProfile("external", "pt-BR");
    expect(profile.name).toBe("Perfil 1");
    expect(profile.refinement.prompt).toContain("conservative transcript reviewer");
    expect(profile.promptModes).toEqual({
      transcription: "default",
      refinement: "default",
      summaryExtraction: "default",
      summaryConsolidation: "default",
    });
  });
  it("resolves English defaults for the effective summary language", () => {
    const base = completeProfile();
    const profile = aiProfileSchema.parse({
      ...base,
      transcription: { ...base.transcription, language: "es" },
    });
    expect(resolveAiProfile(profile).summary.extractionPrompt).toBe(
      createDefaultAiPrompts("es").summaryExtraction,
    );
    expect(aiProfileSchema.parse({ ...profile, language: "en" }).summary.extractionPrompt).toBe(
      createDefaultAiPrompts("en").summaryExtraction,
    );
  });
  it("preserves custom text exactly even when identical to a previous default", () => {
    const base = completeProfile();
    const originalDefault = createDefaultAiPrompts("auto").summaryExtraction;
    const custom = "  Revise com cuidado.\nPreserve esta instrução.  ";
    const profile = aiProfileSchema.parse({
      ...base,
      language: "en",
      promptModes: { ...base.promptModes, refinement: "custom", summaryExtraction: "custom" },
      refinement: { ...base.refinement, prompt: custom },
      summary: { ...base.summary, extractionPrompt: originalDefault },
    });
    expect(profile.refinement.prompt).toBe(custom);
    expect(resolveAiProfile(profile).refinement.prompt).toBe(custom);
    expect(resolveAiProfile(profile).summary.extractionPrompt).toBe(originalDefault);
  });
  it("restores defaults per field and preserves explicit null customization", () => {
    const base = completeProfile();
    const profile = aiProfileSchema.parse({
      ...base,
      promptModes: { ...base.promptModes, refinement: "custom" },
      refinement: { ...base.refinement, prompt: null },
      summary: { ...base.summary, extractionPrompt: "Texto exibido pelo front" },
    });
    expect(resolveAiProfile(profile).refinement.prompt).toBeNull();
    expect(profile.summary.extractionPrompt).toBe(createDefaultAiPrompts("auto").summaryExtraction);
    expect(resolveAiProfile(profile).transcription.prompt).toBeNull();
  });
  it("requires explicit modes and persisted prompt fields", () => {
    const base = completeProfile();
    const { promptModes: _modes, ...withoutModes } = base;
    expect(aiProfileSchema.safeParse(withoutModes).success).toBe(false);
    expect(
      aiProfileSchema.safeParse({ ...base, promptModes: { refinement: "default" } }).success,
    ).toBe(false);
    const { prompt: _prompt, ...withoutPrompt } = base.refinement;
    expect(aiProfileSchema.safeParse({ ...base, refinement: withoutPrompt }).success).toBe(false);
  });
});
function completeProfile() {
  const base = createInitialAiProfile("external", "en");
  return aiProfileSchema.parse({
    ...base,
    transcription: { ...base.transcription, model: "audio" },
    refinement: { ...base.refinement, model: "review" },
    summary: { ...base.summary, model: "summary" },
  });
}
