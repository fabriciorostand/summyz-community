import type { Logger } from "pino";
import { z } from "zod";

import {
  type CostAttempt,
  decimalAmountFromNumber,
  decimalAmountFromProviderText,
  finishCostAttempt,
} from "./cost-ledger.js";
import { readOpenRouterResponse } from "./openrouter-response.js";

const OPENROUTER_GENERATION_URL = "https://openrouter.ai/api/v1/generation";
const generationSchema = z.object({
  data: z.object({
    id: z.string().min(1),
    model: z.string().min(1),
    total_cost: z.number().nonnegative(),
  }),
});

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export interface CostReconciliationStore {
  listReconciliationCandidates(guildId?: string): Promise<CostAttempt[]>;
  saveAttempt(attempt: CostAttempt): Promise<void>;
}

interface CostReconcilerOptions {
  apiKey: string;
  fetch?: Fetch;
  logger?: Logger;
  store: CostReconciliationStore;
}

export class CostReconciler {
  readonly #apiKey: string;
  readonly #fetch: Fetch;
  readonly #logger: Logger | undefined;
  readonly #store: CostReconciliationStore;

  public constructor(options: CostReconcilerOptions) {
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? fetch;
    this.#logger = options.logger;
    this.#store = options.store;
  }

  public async reconcile(guildId?: string): Promise<void> {
    for (const attempt of await this.#store.listReconciliationCandidates(guildId)) {
      await this.#reconcileAttempt(attempt);
    }
  }

  async #reconcileAttempt(attempt: CostAttempt): Promise<void> {
    const generationId = attempt.generationId;
    if (generationId === null) return;
    try {
      const generation = await this.#fetchGeneration(generationId);
      if (generation === undefined) return;
      await this.#store.saveAttempt(reconcileCostAttempt(attempt, generation));
    } catch (error) {
      this.#logger?.warn(
        {
          attemptId: attempt.attemptId,
          errorType: error instanceof Error ? error.name : typeof error,
          generationId,
          meetingId: attempt.meetingId,
        },
        "OpenRouter cost reconciliation remains pending",
      );
    }
  }

  async #fetchGeneration(generationId: string): Promise<ReconciledGeneration | undefined> {
    const response = await this.#fetch(
      `${OPENROUTER_GENERATION_URL}?id=${encodeURIComponent(generationId)}`,
      { headers: { Authorization: `Bearer ${this.#apiKey}` }, method: "GET" },
    );
    if (!response.ok) return undefined;
    const parsed = await readOpenRouterResponse(response, "total_cost");
    return { exactCost: parsed.exactCost, generation: generationSchema.parse(parsed.body).data };
  }
}

interface ReconciledGeneration {
  exactCost: string | undefined;
  generation: z.infer<typeof generationSchema>["data"];
}

function reconcileCostAttempt(attempt: CostAttempt, result: ReconciledGeneration): CostAttempt {
  if (attempt.financialStatus === "confirmed") {
    return { ...attempt, model: result.generation.model };
  }
  return finishCostAttempt(attempt, {
    confirmationSource: "generation",
    cost: resolvedGenerationCost(result),
    currency: "USD",
    endedAt: attempt.endedAt ?? new Date().toISOString(),
    financialStatus: "confirmed",
    generationId: result.generation.id,
    model: result.generation.model,
    outcome: attempt.outcome === "pending" ? "failure" : attempt.outcome,
  });
}

function resolvedGenerationCost(result: ReconciledGeneration): string {
  return result.exactCost === undefined
    ? decimalAmountFromNumber(result.generation.total_cost)
    : decimalAmountFromProviderText(result.exactCost);
}
