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
      const generationId = attempt.generationId;
      if (generationId === null) continue;
      try {
        const response = await this.#fetch(
          `${OPENROUTER_GENERATION_URL}?id=${encodeURIComponent(generationId)}`,
          { headers: { Authorization: `Bearer ${this.#apiKey}` }, method: "GET" },
        );
        if (!response.ok) continue;
        const parsed = await readOpenRouterResponse(response, "total_cost");
        const generation = generationSchema.parse(parsed.body).data;
        const reconciled =
          attempt.financialStatus === "confirmed"
            ? { ...attempt, model: generation.model }
            : finishCostAttempt(attempt, {
                confirmationSource: "generation",
                cost:
                  parsed.exactCost === undefined
                    ? decimalAmountFromNumber(generation.total_cost)
                    : decimalAmountFromProviderText(parsed.exactCost),
                currency: "USD",
                endedAt: attempt.endedAt ?? new Date().toISOString(),
                financialStatus: "confirmed",
                generationId: generation.id,
                model: generation.model,
                outcome: attempt.outcome === "pending" ? "failure" : attempt.outcome,
              });
        await this.#store.saveAttempt(reconciled);
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
  }
}
