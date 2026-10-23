import { describe, expect, it } from "vitest";

import { presentPromptDefaults } from "../../src/i18n/prompt-defaults";

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
    expect(presented?.summaryExtraction.shown).toContain("compromissos em primeira pessoa");
    expect(presented?.summaryExtraction.shown).not.toContain(
      "Responsável e prazo devem reproduzir exatamente",
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

  it("shows the executive overview guidance in both editable summary defaults", () => {
    const presented = presentPromptDefaults("pt-BR", "pt-BR", english);
    for (const prompt of [presented?.summaryExtraction, presented?.summaryConsolidation]) {
      expect(prompt?.shown).toContain("Somente em executiveSummary");
      expect(prompt?.shown).toContain("um parágrafo curto");
      expect(prompt?.shown).toContain("extensão proporcional à conversa");
      expect(prompt?.shown).toContain("em vez de listar atribuições individuais e prazos");
      expect(prompt?.shown).toContain("nomes e datas apenas quando essenciais");
    }
    expect(presented?.summaryExtraction.sent).toBe(english.summaryExtraction);
    expect(presented?.summaryConsolidation.sent).toBe(english.summaryConsolidation);
    expect(presented?.refinement.shown).not.toContain("executiveSummary");
  });

  it("offers nothing to restore until the server defaults arrive", () => {
    expect(presentPromptDefaults("pt-BR", "auto", undefined)).toBeUndefined();
  });
});
