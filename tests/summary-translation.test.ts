import { describe, expect, it, vi } from "vitest";

import type { PublicSummary } from "../src/summary/summary-result.js";
import {
  ProtectedTermMismatchError,
  SummaryTranslationService,
  TranslationRequestError,
  protectSummaryTerms,
  restoreSummaryTerms,
} from "../src/translation/summary-translation.js";

const base: PublicSummary = {
  decisions: ["Ana aprovou o plano Nimbus."],
  discussedTopics: ["Projeto Nimbus"],
  executiveSummary: "Ana liderará o Projeto Nimbus.",
  observations: [],
  tasks: [{ deadlineText: "sexta-feira", ownerName: "Ana", text: "Enviar até sexta-feira." }],
};

describe("tradução do resumo", () => {
  it("tokeniza e restaura deterministicamente responsáveis, prazos e nomes próprios", () => {
    const protectedSummary = protectSummaryTerms(base, [
      "Ana",
      "sexta-feira",
      "Projeto Nimbus",
      "Termo ausente",
    ]);
    expect(JSON.stringify(protectedSummary.summary)).not.toContain("Ana");
    expect(restoreSummaryTerms(protectedSummary.summary, protectedSummary.terms)).toEqual(base);
  });

  it("protege termos em todos os rótulos traduzíveis e preserva campos opcionais ausentes", () => {
    const labeled: PublicSummary = {
      decisions: [],
      discussedTopics: [],
      executiveSummary: "Resumo Atlas",
      labels: {
        assignee: "Atlas responsável",
        deadline: "Atlas prazo",
        decisions: "Atlas decisões",
        discussedTopics: "Atlas tópicos",
        executiveSummary: "Atlas resumo",
        fullTranscript: "Atlas transcrição completa",
        meetingId: "Atlas ID",
        observations: "Atlas observações",
        summary: "Atlas",
        tasks: "Atlas tarefas",
        transcript: "Atlas transcrição",
      },
      observations: ["Atlas observado"],
      tasks: [{ text: "Atlas tarefa" }],
    };

    const protectedSummary = protectSummaryTerms(labeled, ["", " Atlas ", "Atlas"]);
    expect(restoreSummaryTerms(protectedSummary.summary, protectedSummary.terms)).toEqual(labeled);
    expect(protectedSummary.terms).toHaveLength(1);
  });

  it("rejeita remoção ou duplicação de qualquer token protegido", () => {
    const protectedSummary = protectSummaryTerms(base, ["Ana"]);
    const tampered = {
      ...protectedSummary.summary,
      executiveSummary: protectedSummary.summary.executiveSummary.replaceAll("⟦", ""),
    };
    expect(() => restoreSummaryTerms(tampered, protectedSummary.terms)).toThrow(
      ProtectedTermMismatchError,
    );
  });

  it("rejeita mover um termo protegido para outro campo mantendo a contagem total", () => {
    const protectedSummary = protectSummaryTerms(base, ["Ana"]);
    const term = protectedSummary.terms[0];
    if (term === undefined) throw new Error("O teste exige um termo protegido");
    const moved = {
      ...protectedSummary.summary,
      observations: [term.token],
      tasks: protectedSummary.summary.tasks.map((task) => ({ ...task, ownerName: "Responsable" })),
    };

    expect(() => restoreSummaryTerms(moved, protectedSummary.terms)).toThrow(
      ProtectedTermMismatchError,
    );
  });

  it("aplica retries limitados apenas para falhas transitórias", async () => {
    const translate = vi
      .fn()
      .mockRejectedValueOnce(new TranslationRequestError(true))
      .mockImplementationOnce(async (summary: PublicSummary) => summary);
    const sleep = vi.fn(async () => undefined);
    const service = new SummaryTranslationService({
      maxAttempts: 3,
      retryBaseMs: 1_000,
      retryMaxMs: 30_000,
      sleep,
      translator: { translate },
    });

    await expect(service.translate(base, "es", ["Ana"])).resolves.toMatchObject({
      attempts: 2,
      summary: base,
    });
    expect(sleep).toHaveBeenCalledWith(1_000);

    translate.mockReset().mockRejectedValue(new TranslationRequestError(false));
    await expect(service.translate(base, "es", [])).rejects.toMatchObject({ attempts: 1 });
  });

  it("encapsula falhas desconhecidas ao atingir o limite configurado", async () => {
    const service = new SummaryTranslationService({
      maxAttempts: 1,
      retryBaseMs: 1,
      retryMaxMs: 1,
      translator: {
        translate: vi.fn(async () => {
          throw new Error("provider response");
        }),
      },
    });

    await expect(service.translate(base, "de", [])).rejects.toMatchObject({ attempts: 1 });
  });

  it("ignora tradução quando as tags configurada e predominante são idênticas", () => {
    expect(SummaryTranslationService.shouldTranslate("pt", "pt")).toBe(false);
    expect(SummaryTranslationService.shouldTranslate("pt-BR", "pt")).toBe(true);
  });
});
