import { describe, expect, it } from "vitest";

import { presentPromptDefaults } from "./prompt-defaults";

const english = {
  refinement: "English refinement",
  summaryConsolidation: "English consolidation",
  summaryExtraction: "English extraction",
  transcription: null,
};

describe("presentPromptDefaults", () => {
  it("shows the server's English defaults as they are when the dashboard is in English", () => {
    expect(presentPromptDefaults("en", "pt-BR", english)).toEqual({
      refinement: { sent: "English refinement", shown: "English refinement" },
      summaryConsolidation: { sent: "English consolidation", shown: "English consolidation" },
      summaryExtraction: { sent: "English extraction", shown: "English extraction" },
    });
  });

  it("shows the Portuguese reading of the defaults while the server keeps sending English", () => {
    const presented = presentPromptDefaults("pt-BR", "auto", english);

    expect(presented?.refinement.sent).toBe("English refinement");
    expect(presented?.refinement.shown).toMatch(/^Você é um revisor conservador de transcrições\./);
    expect(presented?.summaryExtraction.shown).toMatch(
      /^Você extrai informações de reuniões no idioma predominante da reunião\./,
    );
    expect(presented?.summaryConsolidation.shown).toMatch(
      /^Você consolida resumos parciais de uma reunião no idioma predominante da reunião\./,
    );
  });

  it("names the summary language in the Portuguese reading", () => {
    expect(presentPromptDefaults("pt-BR", "en", english)?.summaryExtraction.shown).toContain(
      "reuniões em inglês.",
    );
    expect(presentPromptDefaults("pt-BR", "pt-BR", english)?.summaryExtraction.shown).toContain(
      "reuniões em português brasileiro.",
    );
    expect(presentPromptDefaults("pt-BR", "es-MX", english)?.summaryExtraction.shown).toContain(
      "no idioma identificado pelo código BCP 47 es-MX.",
    );
  });

  it("offers nothing to restore until the server defaults arrive", () => {
    expect(presentPromptDefaults("pt-BR", "auto", undefined)).toBeUndefined();
  });
});
