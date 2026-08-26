import { describe, expect, it } from "vitest";

import { createCostReportService } from "../src/cost/cost-report.js";
import type { CostMeetingRecord, CostMeetingWithAttempts } from "../src/cost/cost-ledger.js";

const meeting: CostMeetingRecord = {
  completedAt: "2026-08-24T11:30:00.000Z",
  guildId: "guild-1",
  meetingId: "meeting-1",
  startedAt: "2026-08-24T10:00:00.000Z",
};

const data: CostMeetingWithAttempts = {
  attempts: [
    {
      attemptId: "attempt-1",
      confirmationSource: "response",
      cost: "0.000000123456",
      currency: "USD",
      endedAt: "2026-08-24T11:31:01.000Z",
      execution: "api",
      financialStatus: "confirmed",
      generationId: "gen-1",
      guildId: "guild-1",
      meetingId: "meeting-1",
      model: "openai/whisper-1",
      outcome: "success",
      phase: "transcription",
      provider: "openrouter",
      startedAt: "2026-08-24T11:31:00.000Z",
    },
    {
      attemptId: "attempt-2",
      confirmationSource: null,
      cost: null,
      currency: null,
      endedAt: "2026-08-24T11:31:03.000Z",
      execution: "local",
      financialStatus: "not_applicable",
      generationId: null,
      guildId: "guild-1",
      meetingId: "meeting-1",
      model: "qwen2.5:3b",
      outcome: "success",
      phase: "refinement",
      provider: "ollama",
      startedAt: "2026-08-24T11:31:02.000Z",
    },
    {
      attemptId: "attempt-3",
      confirmationSource: null,
      cost: null,
      currency: null,
      endedAt: "2026-08-24T11:31:05.000Z",
      execution: "api",
      financialStatus: "unattributed",
      generationId: null,
      guildId: "guild-1",
      meetingId: "meeting-1",
      model: null,
      outcome: "failure",
      phase: "summary",
      provider: "openrouter",
      startedAt: "2026-08-24T11:31:04.000Z",
    },
  ],
  meeting,
};

function attemptAt(index: number): CostMeetingWithAttempts["attempts"][number] {
  const attempt = data.attempts[index];
  if (attempt === undefined) throw new Error(`Missing test attempt at index ${String(index)}`);
  return attempt;
}

describe("cost reports", () => {
  it("formata reunião concluída sem arredondar e omite custo de execução local", async () => {
    const service = createCostReportService({
      language: "pt-BR",
      store: {
        getMeeting: async () => data,
        listMeetings: async () => [data],
      },
      timeZone: "America/Sao_Paulo",
    });

    const report = await service.meeting("guild-1", "meeting-1");

    expect(report).toContain("Reunião: `meeting-1`");
    expect(report).toContain("Data: 24/08/2026 07:00");
    expect(report).toContain("Duração: 01:30:00");
    expect(report).toContain("Modelo: openai/whisper-1");
    expect(report).toContain("Modelo: qwen2.5:3b");
    expect(report).toContain("USD 0.000000123456");
    expect(report).not.toMatch(/qwen2\.5:3b[\s\S]{0,80}USD/);
    expect(report).toContain("Não foi possível confirmar automaticamente: 1");
  });

  it("rejeita reunião de outro servidor e reunião ainda em andamento", async () => {
    const foreign = createCostReportService({
      language: "pt-BR",
      store: { getMeeting: async () => undefined, listMeetings: async () => [] },
      timeZone: "America/Sao_Paulo",
    });
    await expect(foreign.meeting("guild-2", "meeting-1")).rejects.toMatchObject({
      code: "meeting_not_found",
    });

    const active = createCostReportService({
      language: "pt-BR",
      store: {
        getMeeting: async () => ({ ...data, meeting: { ...meeting, completedAt: null } }),
        listMeetings: async () => [],
      },
      timeZone: "America/Sao_Paulo",
    });
    await expect(active.meeting("guild-1", "meeting-1")).rejects.toMatchObject({
      code: "meeting_in_progress",
    });
  });

  it("consulta período pela data inicial da reunião e mostra métricas distintas", async () => {
    let reconciledGuildId: string | undefined;
    const service = createCostReportService({
      language: "pt-BR",
      reconcile: async (guildId) => {
        reconciledGuildId = guildId;
      },
      store: {
        getMeeting: async () => data,
        listMeetings: async (_guildId, range) => {
          expect(range).toEqual({
            endedBefore: "2026-09-01T03:00:00.000Z",
            startedAtOrAfter: "2026-08-01T03:00:00.000Z",
          });
          return [data];
        },
      },
      timeZone: "America/Sao_Paulo",
    });

    const report = await service.period("guild-1", "2026-08-01", "2026-08-31");

    expect(reconciledGuildId).toBe("guild-1");
    expect(report).toContain("Período: 01/08/2026–31/08/2026");
    expect(report).not.toContain("Servidor:");
    expect(report).not.toContain("Fuso horário:");
    expect(report).toContain("Reuniões: 1");
    expect(report).toContain("Requisições aos provedores: 2");
    expect(report).toContain("Execuções locais: 1");
    expect(report).toContain("Custo externo médio confirmado");
    expect(report).toContain("por hora de reunião com uso de API");
  });

  it("formata relatórios vazios e em inglês", async () => {
    const service = createCostReportService({
      language: "en",
      store: {
        getMeeting: async () => ({ ...data, attempts: [attemptAt(0)] }),
        listMeetings: async () => [],
      },
      timeZone: "UTC",
    });

    const meetingReport = await service.meeting("guild-1", "meeting-1");
    const periodReport = await service.period("guild-1", "2026-08-01", "2026-08-31");

    expect(meetingReport).toContain("Meeting:");
    expect(meetingReport).toContain("No recorded executions");
    expect(periodReport).toContain("Meetings: 0");
    expect(periodReport).toContain("USD 0");

    const unresolvedService = createCostReportService({
      language: "en",
      store: {
        getMeeting: async () => data,
        listMeetings: async () => [data],
      },
      timeZone: "UTC",
    });
    const unresolvedMeetingReport = await unresolvedService.meeting("guild-1", "meeting-1");
    const unresolvedPeriodReport = await unresolvedService.period(
      "guild-1",
      "2026-08-01",
      "2026-08-31",
    );

    expect(unresolvedMeetingReport).toContain("Execution: Local");
    expect(unresolvedMeetingReport).toContain("Execution: API — openrouter");
    expect(unresolvedMeetingReport).toContain("Some attempts do not yet have a cost confirmed");
    expect(unresolvedPeriodReport).toContain("Some attempts do not yet have a cost confirmed");
  });

  it("contabiliza falhas cobradas e ignora reuniões ativas nas médias de duração", async () => {
    const chargedFailure: CostMeetingWithAttempts["attempts"][number] = {
      ...attemptAt(0),
      attemptId: "charged-failure",
      cost: "0.000000000001",
      generationId: "gen-failure",
      outcome: "failure",
      phase: "summary",
    };
    const pendingAttempt: CostMeetingWithAttempts["attempts"][number] = {
      ...attemptAt(0),
      attemptId: "pending-attempt",
      confirmationSource: null,
      cost: null,
      currency: null,
      financialStatus: "pending",
      generationId: "gen-pending",
      outcome: "failure",
      phase: "refinement",
    };
    const completed = { ...data, attempts: [chargedFailure, pendingAttempt] };
    const active = {
      ...data,
      attempts: [attemptAt(0)],
      meeting: { ...meeting, completedAt: null, meetingId: "meeting-active" },
    };
    const service = createCostReportService({
      language: "pt-BR",
      store: {
        getMeeting: async () => completed,
        listMeetings: async () => [completed, active],
      },
      timeZone: "America/Sao_Paulo",
    });

    const meetingReport = await service.meeting("guild-1", "meeting-1");
    const periodReport = await service.period("guild-1", "2026-08-01", "2026-08-31");

    expect(meetingReport).toContain("Tentativas cobradas com falha: 1 — USD 0.000000000001");
    expect(meetingReport).toContain("Reconciliações pendentes: 1");
    expect(periodReport).toContain("Reuniões: 1");
    expect(periodReport).toContain("Requisições cobradas com falha: 1");
    expect(periodReport).toContain("Duração total: 01:30:00");
    expect(periodReport).toContain("⚠️ Algumas tentativas ainda não têm o custo confirmado");
  });

  it("agrupa requisições do mesmo modelo efetivo", async () => {
    const repeatedAttempt = {
      ...attemptAt(0),
      attemptId: "attempt-repeated",
      cost: "0.000000000004",
      generationId: "gen-repeated",
    };
    const service = createCostReportService({
      language: "pt-BR",
      store: {
        getMeeting: async () => ({ ...data, attempts: [attemptAt(0), repeatedAttempt] }),
        listMeetings: async () => [],
      },
      timeZone: "America/Sao_Paulo",
    });

    const report = await service.meeting("guild-1", "meeting-1");

    expect(report).toContain("Requisições: 2");
    expect(report).toContain("Custo confirmado: USD 0.00000012346");
  });

  it("valida o calendário e a ordem do período", async () => {
    const service = createCostReportService({
      language: "pt-BR",
      store: { getMeeting: async () => data, listMeetings: async () => [] },
      timeZone: "America/Sao_Paulo",
    });

    await expect(service.period("guild-1", "2026-02-30", "2026-03-01")).rejects.toMatchObject({
      code: "invalid_period",
    });
    await expect(service.period("guild-1", "2026-09-01", "2026-08-01")).rejects.toMatchObject({
      code: "invalid_period",
    });
    await expect(service.period("guild-1", "01/08/2026", "2026-08-31")).rejects.toMatchObject({
      code: "invalid_period",
    });
  });
});
