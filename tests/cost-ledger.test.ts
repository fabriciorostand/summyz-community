import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  addDecimalAmounts,
  createCostAttempt,
  decimalAmountFromNumber,
  decimalAmountFromProviderText,
  divideDecimal,
  finishCostAttempt,
  multiplyDecimal,
} from "../src/cost/cost-ledger.js";
import { LocalCostLedgerStore } from "../src/cost/local-cost-ledger-store.js";
import { createManifest, markManifestCompleted } from "../src/recording/manifest.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

const completedManifest = markManifestCompleted(
  createManifest({
    guildId: "guild-1",
    meetingId: "meeting-1",
    notificationChannelId: "text-1",
    startedAt: "2026-08-24T10:00:00.000Z",
    voiceChannelId: "voice-1",
  }),
  "2026-08-24T11:30:00.000Z",
);

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
    const api = createCostAttempt({
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
      finishCostAttempt(api, {
        endedAt: "2026-08-24T11:31:01.000Z",
        financialStatus: "confirmed",
        outcome: "success",
      }),
    ).toThrow();
    expect(() =>
      finishCostAttempt(api, {
        cost: "1",
        currency: "USD",
        endedAt: "2026-08-24T11:31:01.000Z",
        financialStatus: "unattributed",
        outcome: "failure",
      }),
    ).toThrow();
    expect(() =>
      finishCostAttempt(api, {
        endedAt: "2026-08-24T11:31:01.000Z",
        financialStatus: "pending",
        outcome: "pending",
      }),
    ).toThrow();
    expect(() =>
      finishCostAttempt(api, {
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
  });

  it("relaciona tentativas à pasta permanente do servidor, reunião e fase", async () => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-costs-"));
    directories.push(directory);
    const store = new LocalCostLedgerStore(directory);
    await store.saveMeeting(completedManifest);
    const started = createCostAttempt({
      attemptId: "attempt-1",
      execution: "api",
      guildId: "guild-1",
      meetingId: "meeting-1",
      model: null,
      phase: "summary",
      provider: "openrouter",
      startedAt: "2026-08-24T11:31:00.000Z",
    });
    await store.saveAttempt(started);
    await store.saveAttempt(
      finishCostAttempt(started, {
        confirmationSource: "response",
        cost: "0.000000123456",
        currency: "USD",
        endedAt: "2026-08-24T11:31:01.000Z",
        financialStatus: "confirmed",
        generationId: "gen-1",
        model: "google/gemini-2.5-flash",
        outcome: "success",
      }),
    );

    await expect(store.getMeeting("guild-1", "meeting-1")).resolves.toMatchObject({
      attempts: [
        expect.objectContaining({
          cost: "0.000000123456",
          meetingId: "meeting-1",
          model: "google/gemini-2.5-flash",
          phase: "summary",
        }),
      ],
      meeting: expect.objectContaining({ guildId: "guild-1", meetingId: "meeting-1" }),
    });
    await expect(store.getMeeting("guild-2", "meeting-1")).resolves.toBeUndefined();

    const stored = await readFile(
      join(directory, "guilds", "guild-1", "meetings", "meeting-1", "summary", "attempt-1.json"),
      "utf8",
    );
    expect(stored).toContain('"generationId": "gen-1"');
  });

  it("seleciona reuniões pelo início e inclui todas as tentativas relacionadas", async () => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-cost-period-"));
    directories.push(directory);
    const store = new LocalCostLedgerStore(directory);
    await store.saveMeeting(completedManifest);
    const attempt = createCostAttempt({
      attemptId: "attempt-next-day",
      execution: "api",
      guildId: "guild-1",
      meetingId: "meeting-1",
      model: null,
      phase: "summary",
      provider: "openrouter",
      startedAt: "2026-08-25T02:00:00.000Z",
    });
    await store.saveAttempt(
      finishCostAttempt(attempt, {
        confirmationSource: "response",
        cost: "0.01",
        currency: "USD",
        endedAt: "2026-08-25T02:00:01.000Z",
        financialStatus: "confirmed",
        model: "model-effective",
        outcome: "success",
      }),
    );

    await expect(
      store.listMeetings("guild-1", {
        endedBefore: "2026-08-25T00:00:00.000Z",
        startedAtOrAfter: "2026-08-24T00:00:00.000Z",
      }),
    ).resolves.toHaveLength(1);
  });

  it("lista reconciliações pendentes globalmente e por servidor", async () => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-cost-reconcile-"));
    directories.push(directory);
    const store = new LocalCostLedgerStore(directory);
    await store.saveMeeting(completedManifest);
    const attempt = createCostAttempt({
      attemptId: "attempt-pending",
      execution: "api",
      guildId: "guild-1",
      meetingId: "meeting-1",
      model: null,
      phase: "summary",
      provider: "openrouter",
      startedAt: "2026-08-24T11:31:00.000Z",
    });
    await store.saveAttempt(
      finishCostAttempt(attempt, {
        endedAt: "2026-08-24T11:31:01.000Z",
        financialStatus: "pending",
        generationId: "gen-1",
        outcome: "failure",
      }),
    );

    await expect(store.listReconciliationCandidates()).resolves.toHaveLength(1);
    await expect(store.listReconciliationCandidates("guild-1")).resolves.toHaveLength(1);
    await expect(store.listReconciliationCandidates("guild-2")).resolves.toEqual([]);
    await expect(store.getMeeting("../guild", "meeting-1")).rejects.toThrow(/identificador/i);
  });

  it("serializa atualizações da reunião e rejeita lançamentos na hierarquia errada", async () => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-cost-integrity-"));
    directories.push(directory);
    const store = new LocalCostLedgerStore(directory);

    await Promise.all([store.saveMeeting(completedManifest), store.saveMeeting(completedManifest)]);
    const phaseDirectory = join(directory, "guilds", "guild-1", "meetings", "meeting-1", "summary");
    await mkdir(phaseDirectory, { recursive: true });
    await writeFile(join(phaseDirectory, "ignored.txt"), "not a ledger entry", "utf8");
    await writeFile(
      join(phaseDirectory, "wrong-meeting.json"),
      JSON.stringify({
        ...createCostAttempt({
          attemptId: "wrong-meeting",
          execution: "api",
          guildId: "guild-1",
          meetingId: "meeting-2",
          model: null,
          phase: "summary",
          provider: "openrouter",
          startedAt: "2026-08-24T11:31:00.000Z",
        }),
      }),
      "utf8",
    );

    await expect(store.getMeeting("guild-1", "meeting-1")).rejects.toThrow(
      /não pertence ao diretório/i,
    );
  });

  it("propaga arquivo de reunião corrompido em vez de ocultá-lo como ausente", async () => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-cost-corrupt-"));
    directories.push(directory);
    const meetingDirectory = join(directory, "guilds", "guild-1", "meetings", "meeting-1");
    await mkdir(meetingDirectory, { recursive: true });
    await writeFile(join(meetingDirectory, "meeting.json"), "not-json", "utf8");
    const store = new LocalCostLedgerStore(directory);

    await expect(store.getMeeting("guild-1", "meeting-1")).rejects.toBeInstanceOf(SyntaxError);
  });
});
