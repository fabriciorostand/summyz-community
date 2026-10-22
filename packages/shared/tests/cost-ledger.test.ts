import { describe, expect, it } from "vitest";

import {
  addDecimalAmounts,
  createCostAttempt,
  decimalAmountFromNumber,
  decimalAmountFromProviderText,
  divideDecimal,
  finishCostAttempt,
  multiplyDecimal,
  toCostMeetingRecord,
} from "../src/cost/cost-ledger.js";
import { createManifest } from "../src/recording/manifest.js";

describe("cost ledger", () => {
  it("preserva valores decimais sem arredondamento binário", () => {
    expect(addDecimalAmounts(["0.0000001", "0.0000002", "1.2300"])).toBe("1.2300003");
    expect(() => decimalAmountFromNumber(Number.NaN)).toThrow(/invalid provider cost/i);
    expect(() => decimalAmountFromNumber(-1)).toThrow(/invalid provider cost/i);
    expect(decimalAmountFromProviderText("4.2815e-2")).toBe("0.042815");
    expect(decimalAmountFromProviderText("1.230000000000000001")).toBe("1.230000000000000001");
    expect(decimalAmountFromProviderText("1e3")).toBe("1000");
    expect(() => decimalAmountFromProviderText("-1")).toThrow(/invalid provider cost/i);
    expect(() => decimalAmountFromProviderText(`1e${"9".repeat(300)}`)).toThrow(
      /invalid provider cost/i,
    );
  });

  it("opera decimais pequenos, médias finitas e periódicas sem arredondar", () => {
    expect(decimalAmountFromNumber(1e-7)).toBe("0.0000001");
    expect(decimalAmountFromNumber(1e3)).toBe("1000");
    expect(multiplyDecimal("0.25", 4)).toBe("1");
    expect(divideDecimal("1", 4)).toBe("0.25");
    expect(divideDecimal("1", 3, 4)).toBe("0.3333…");
    expect(divideDecimal("0", 2)).toBe("0");
    expect(() => divideDecimal("1", 0)).toThrow(/divisor/i);
    expect(() => multiplyDecimal("1", -1)).toThrow(/multiplicador/i);
  });

  it("rejeita combinações financeiras contraditórias", () => {
    const attempt = createCostAttempt({
      attemptId: "attempt-invalid",
      execution: "api",
      guildId: "guild-1",
      meetingId: "meeting-1",
      model: null,
      phase: "summary",
      provider: "openrouter",
      startedAt: "2026-08-24T11:31:00.000Z",
    });

    expect(() =>
      finishCostAttempt(attempt, {
        endedAt: "2026-08-24T11:31:01.000Z",
        financialStatus: "confirmed",
        outcome: "success",
      }),
    ).toThrow();
    expect(() =>
      finishCostAttempt(attempt, {
        cost: "1",
        currency: "USD",
        endedAt: "2026-08-24T11:31:01.000Z",
        financialStatus: "unattributed",
        outcome: "failure",
      }),
    ).toThrow();
    expect(() =>
      finishCostAttempt(attempt, {
        endedAt: "2026-08-24T11:31:01.000Z",
        financialStatus: "pending",
        outcome: "pending",
      }),
    ).toThrow();
    expect(() =>
      finishCostAttempt(attempt, {
        endedAt: null,
        financialStatus: "unattributed",
        outcome: "failure",
      }),
    ).toThrow();
  });

  it("modela custo local como não aplicável e sem moeda", () => {
    const attempt = createCostAttempt({
      attemptId: "attempt-1",
      execution: "local",
      guildId: "guild-1",
      meetingId: "meeting-1",
      model: "small",
      phase: "transcription",
      provider: "faster-whisper",
      startedAt: "2026-08-24T11:31:00.000Z",
    });

    expect(
      finishCostAttempt(attempt, {
        endedAt: "2026-08-24T11:31:01.000Z",
        financialStatus: "not_applicable",
        outcome: "success",
      }),
    ).toMatchObject({ cost: null, currency: null, financialStatus: "not_applicable" });
    expect(() =>
      finishCostAttempt(attempt, {
        endedAt: "2026-08-24T11:31:01.000Z",
        financialStatus: "pending",
        outcome: "failure",
      }),
    ).toThrow();
  });

  it("representa como nulo o término de uma reunião ainda aberta", () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-open",
      notificationChannelId: "text-1",
      startedAt: "2026-08-24T11:31:00.000Z",
      voiceChannelId: "voice-1",
    });

    expect(toCostMeetingRecord(manifest).completedAt).toBeNull();
  });
});
