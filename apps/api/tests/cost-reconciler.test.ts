import type { CostAttempt } from "summyz-community-shared/cost/cost-ledger";
import { describe, expect, it, vi } from "vitest";
import { CostReconciler } from "../src/cost/cost-reconciler.js";

const pending: CostAttempt = {
  attemptId: "attempt-1",
  confirmationSource: null,
  cost: null,
  currency: null,
  endedAt: "2026-08-24T11:31:01.000Z",
  execution: "api",
  financialStatus: "pending",
  generationId: "gen-1",
  guildId: "guild-1",
  meetingId: "meeting-1",
  model: null,
  outcome: "failure",
  phase: "summary",
  provider: "openrouter",
  startedAt: "2026-08-24T11:31:00.000Z",
};

describe("CostReconciler", () => {
  it("skips reconciliation without a configured credential", async () => {
    const listReconciliationCandidates = vi.fn(async () => []);
    const reconciler = new CostReconciler({
      apiKey: async () => undefined,
      store: { listReconciliationCandidates, saveAttempt: async () => undefined },
    });
    await reconciler.reconcile("guild-1");
    expect(listReconciliationCandidates).not.toHaveBeenCalled();
  });
  it("shares only concurrent work for the same guild and reads the current credential on the next run", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const apiKey = vi.fn(async () => "first-fixture-key");
    const request = vi.fn(async (_url: string, _init: RequestInit) => {
      await gate;
      return Response.json({ data: { id: "gen-1", model: "model", total_cost: 0.1 } });
    });
    const listReconciliationCandidates = vi.fn(async () => [pending]);
    const saveAttempt = vi.fn(async () => undefined);
    const reconciler = new CostReconciler({
      apiKey,
      fetch: request,
      store: { listReconciliationCandidates, saveAttempt },
    });
    const first = reconciler.reconcile("guild-1");
    const second = reconciler.reconcile("guild-1");
    const otherGuild = reconciler.reconcile("guild-2");
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    release?.();
    await Promise.all([first, second, otherGuild]);
    expect(listReconciliationCandidates).toHaveBeenCalledTimes(2);
    expect(saveAttempt).toHaveBeenCalledTimes(2);
    apiKey.mockResolvedValue("rotated-fixture-key");
    await reconciler.reconcile("guild-1");
    expect(apiKey).toHaveBeenCalledTimes(3);
    expect(request.mock.calls.at(-1)?.[1].headers).toEqual({
      Authorization: "Bearer rotated-fixture-key",
    });
  });

  it("releases a failed concurrent run so a later request can retry", async () => {
    const listReconciliationCandidates = vi
      .fn()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValue([]);
    const reconciler = new CostReconciler({
      apiKey: "fixture",
      store: { listReconciliationCandidates, saveAttempt: async () => undefined },
    });
    await expect(reconciler.reconcile("guild-1")).rejects.toThrow("database unavailable");
    await expect(reconciler.reconcile("guild-1")).resolves.toBeUndefined();
    expect(listReconciliationCandidates).toHaveBeenCalledTimes(2);
  });

  it("confirma candidatos pendentes e completa o modelo efetivo", async () => {
    const saveAttempt = vi.fn(async () => undefined);
    const reconciler = new CostReconciler({
      apiKey: "secret-key",
      fetch: async () =>
        Response.json({
          data: { id: "gen-1", model: "google/gemini-2.5-flash", total_cost: 0.0000008 },
        }),
      store: {
        listReconciliationCandidates: async () => [
          pending,
          {
            ...pending,
            attemptId: "attempt-2",
            confirmationSource: "response",
            cost: "0.1",
            currency: "USD",
            financialStatus: "confirmed",
          },
        ],
        saveAttempt,
      },
    });

    await reconciler.reconcile();

    expect(saveAttempt).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        cost: "0.0000008",
        financialStatus: "confirmed",
        model: "google/gemini-2.5-flash",
      }),
    );
    expect(saveAttempt).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        confirmationSource: "response",
        cost: "0.1",
        model: "google/gemini-2.5-flash",
      }),
    );
  });

  it("preserva o total_cost lexical durante a reconciliação", async () => {
    const saveAttempt = vi.fn(async () => undefined);
    const reconciler = new CostReconciler({
      apiKey: "secret-key",
      fetch: async () =>
        new Response(
          '{"data":{"id":"gen-1","model":"effective-model","total_cost":0.123456789012345678}}',
        ),
      store: {
        listReconciliationCandidates: async () => [pending],
        saveAttempt,
      },
    });

    await reconciler.reconcile();

    expect(saveAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ cost: "0.123456789012345678" }),
    );
  });

  it("mantém candidato pendente quando o provedor ainda não tem o registro", async () => {
    const saveAttempt = vi.fn(async () => undefined);
    const reconciler = new CostReconciler({
      apiKey: "secret-key",
      fetch: async () => new Response("", { status: 404 }),
      store: {
        listReconciliationCandidates: async () => [pending],
        saveAttempt,
      },
    });

    await reconciler.reconcile();

    expect(saveAttempt).not.toHaveBeenCalled();
  });

  it("ignora candidato sem generation id e protege logs de falhas externas", async () => {
    const saveAttempt = vi.fn(async () => undefined);
    const warn = vi.fn();
    const fetch = vi.fn(async () => {
      throw new Error("secret provider body");
    });
    const reconciler = new CostReconciler({
      apiKey: "secret-key",
      fetch,
      logger: { warn } as never,
      store: {
        listReconciliationCandidates: async () => [
          { ...pending, attemptId: "without-generation", generationId: null },
          pending,
        ],
        saveAttempt,
      },
    });

    await reconciler.reconcile("guild-1");

    expect(fetch).toHaveBeenCalledOnce();
    expect(saveAttempt).not.toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-key");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret provider body");
  });

  it("finaliza tentativa ainda aberta quando o provedor confirma a cobrança", async () => {
    const saveAttempt = vi.fn(async () => undefined);
    const reconciler = new CostReconciler({
      apiKey: "secret-key",
      fetch: async () =>
        Response.json({
          data: { id: "gen-open", model: "effective-model", total_cost: 0.03 },
        }),
      store: {
        listReconciliationCandidates: async () => [
          {
            ...pending,
            attemptId: "attempt-open",
            endedAt: null,
            generationId: "gen-open",
            outcome: "pending",
          },
        ],
        saveAttempt,
      },
    });

    await reconciler.reconcile();

    expect(saveAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        cost: "0.03",
        endedAt: expect.any(String),
        financialStatus: "confirmed",
        outcome: "failure",
      }),
    );
  });

  it("registra com segurança rejeições externas que não são objetos Error", async () => {
    const warn = vi.fn();
    const reconciler = new CostReconciler({
      apiKey: "secret-key",
      fetch: async () => Promise.reject("private provider response"),
      logger: { info: vi.fn(), warn } as never,
      store: {
        listReconciliationCandidates: async () => [pending],
        saveAttempt: async () => undefined,
      },
    });

    await reconciler.reconcile();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ errorType: "string" }),
      expect.any(String),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private provider response");
  });
});
