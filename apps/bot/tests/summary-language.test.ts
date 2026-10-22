import { describe, expect, it } from "vitest";

import { resolveSummaryLanguage } from "../src/summary/summary-language.js";

describe("resolveSummaryLanguage", () => {
  it("uses the explicit summary language independently of transcription", () => {
    expect(
      resolveSummaryLanguage({
        detectedLanguage: "fr",
        summaryLanguage: "en",
        transcriptionLanguage: "pt-BR",
      }),
    ).toBe("en");
  });

  it("uses the configured transcription language when summary is automatic", () => {
    expect(
      resolveSummaryLanguage({
        detectedLanguage: "fr",
        summaryLanguage: "auto",
        transcriptionLanguage: "pt-BR",
      }),
    ).toBe("pt-BR");
  });

  it("uses the detected predominant language when both are automatic", () => {
    expect(
      resolveSummaryLanguage({
        detectedLanguage: "fr",
        summaryLanguage: "auto",
        transcriptionLanguage: "auto",
      }),
    ).toBe("fr");
  });
});
