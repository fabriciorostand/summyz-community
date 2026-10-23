import {
  aiProfileSchema,
  createInitialAiProfile,
  resolveAiProfile,
} from "summyz-community-shared/ai-profile";
import { createDefaultAiPrompts } from "summyz-community-shared/ai-prompts";
import { describe, expect, it } from "vitest";
import { composeProtectedPrompt } from "../src/ai-system-prompt.js";

describe("profile prompt ownership", () => {
  it.each(["local", "external"] as const)(
    "applies the executive overview style only to default summary prompts in %s profiles",
    (kind) => {
      const initial = createInitialAiProfile(kind, "pt-BR");
      const profile = aiProfileSchema.parse({
        ...initial,
        transcription: { ...initial.transcription, model: "audio" },
        refinement: { ...initial.refinement, model: "review" },
        summary: { ...initial.summary, model: "summary" },
      });
      const defaults = resolveAiProfile(profile);
      for (const prompt of [
        defaults.summary.extractionPrompt,
        defaults.summary.consolidationPrompt,
      ]) {
        expect(prompt).toContain("For executiveSummary only");
        expect(prompt).toContain("one short paragraph");
        expect(prompt).toContain("length proportional to the conversation");
        expect(prompt).toContain("instead of listing individual assignments and deadlines");
        expect(prompt).toContain("names and dates only when essential");
      }

      const custom = "Include each owner and deadline in executiveSummary.";
      const customized = resolveAiProfile(
        aiProfileSchema.parse({
          ...profile,
          promptModes: {
            ...profile.promptModes,
            summaryExtraction: "custom",
            summaryConsolidation: "custom",
          },
          summary: { ...profile.summary, extractionPrompt: custom, consolidationPrompt: null },
        }),
      );
      expect(customized.summary.extractionPrompt).toBe(custom);
      expect(customized.summary.consolidationPrompt).toBeNull();
      expect(
        composeProtectedPrompt({
          editablePrompt: custom,
          phase: "summary",
          phaseLanguage: "pt-BR",
        }),
      ).not.toContain("For executiveSummary only");
      expect(defaults.refinement.prompt).not.toContain("executiveSummary");
    },
  );

  it("keeps contextual ownership and relative dates in the summary contract even with custom prompts", () => {
    const prompt = composeProtectedPrompt({
      phase: "summary",
      phaseLanguage: "pt-BR",
      editablePrompt: null,
    });
    expect(prompt).toContain("ownerNames");
    expect(prompt).toContain("first-person commitments");
    expect(prompt).toContain("speaker display name");
    expect(prompt).toContain("non-participants");
    expect(prompt).toContain("same-day");
    expect(prompt).toContain("conflicting");
    expect(prompt).toContain("today, tomorrow");
    expect(prompt).toContain("deadlineTime must be null");
    expect(prompt).toContain("all five deadline fields must be null");
    expect(createDefaultAiPrompts("pt-BR").summaryExtraction).not.toContain(
      "Owners and deadlines must reproduce exactly",
    );
  });
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
