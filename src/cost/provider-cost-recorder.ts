import { randomUUID } from "node:crypto";

import type { Logger } from "pino";
import { z } from "zod";

import {
  type CostAttempt,
  type CostLedgerStore,
  type CostPhase,
  createCostAttempt,
  decimalAmountFromNumber,
  decimalAmountFromProviderText,
  finishCostAttempt,
} from "./cost-ledger.js";
import { readOpenRouterResponse } from "./openrouter-response.js";

const OPENROUTER_GENERATION_URL = "https://openrouter.ai/api/v1/generation";

const openRouterResponseMetadataSchema = z
  .object({
    model: z.string().min(1).optional(),
    usage: z.object({ cost: z.number().nonnegative() }).passthrough().optional(),
  })
  .passthrough();

const generationResponseSchema = z.object({
  data: z.object({
    id: z.string().min(1),
    model: z.string().min(1),
    total_cost: z.union([z.number().nonnegative(), z.string()]),
  }),
});

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export interface ProviderCostContext {
  guildId: string;
  meetingId: string;
  phase: CostPhase;
}

interface ProviderCostRecorderOptions {
  context: ProviderCostContext;
  id?: () => string;
  logger?: Logger;
  now?: () => Date;
  openRouter?: { apiKey: string; fetch?: Fetch };
  store: CostLedgerStore;
}

interface OpenRouterResponseResult {
  body: unknown;
  exactCost?: string | undefined;
  generationId?: string;
  outcome: "success" | "failure";
}

export class ProviderCostRecorder {
  readonly #context: ProviderCostContext;
  readonly #id: () => string;
  readonly #logger: Logger | undefined;
  readonly #now: () => Date;
  readonly #openRouter: ProviderCostRecorderOptions["openRouter"];
  readonly #store: CostLedgerStore;

  public constructor(options: ProviderCostRecorderOptions) {
    this.#context = options.context;
    this.#id = options.id ?? randomUUID;
    this.#logger = options.logger;
    this.#now = options.now ?? (() => new Date());
    this.#openRouter = options.openRouter;
    this.#store = options.store;
  }

  public async beginApi(provider: string): Promise<CostAttempt> {
    return this.#begin("api", provider, null);
  }

  public async beginLocal(provider: string, model: string): Promise<CostAttempt> {
    return this.#begin("local", provider, model);
  }

  public async finishLocal(attempt: CostAttempt, outcome: "success" | "failure"): Promise<void> {
    await this.#saveFinished(
      finishCostAttempt(attempt, {
        endedAt: this.#now().toISOString(),
        financialStatus: "not_applicable",
        outcome,
      }),
    );
  }

  public async finishUnattributed(
    attempt: CostAttempt,
    outcome: "success" | "failure",
  ): Promise<void> {
    await this.#saveFinished(
      finishCostAttempt(attempt, {
        endedAt: this.#now().toISOString(),
        financialStatus: "unattributed",
        outcome,
      }),
    );
  }

  public async finishOpenRouterResponse(
    attempt: CostAttempt,
    input: OpenRouterResponseResult,
  ): Promise<void> {
    const direct = openRouterResponseMetadataSchema.safeParse(input.body);
    const generationId = input.generationId ?? null;
    let model = direct.success ? (direct.data.model ?? null) : null;
    const directCost = input.exactCost ?? (direct.success ? direct.data.usage?.cost : undefined);
    let generation: z.infer<typeof generationResponseSchema>["data"] | undefined;
    if (generationId !== null && (directCost === undefined || model === null)) {
      generation = await this.#getGeneration(generationId);
      model ??= generation?.model ?? null;
    }
    if (directCost !== undefined) {
      await this.#saveFinished(
        finishCostAttempt(attempt, {
          confirmationSource: "response",
          cost:
            typeof directCost === "string"
              ? decimalAmountFromProviderText(directCost)
              : decimalAmountFromNumber(directCost),
          currency: "USD",
          endedAt: this.#now().toISOString(),
          financialStatus: "confirmed",
          ...(generationId === null ? {} : { generationId }),
          ...(model === null ? {} : { model }),
          outcome: input.outcome,
        }),
      );
      return;
    }
    if (generation !== undefined) {
      await this.#saveFinished(
        finishCostAttempt(attempt, {
          confirmationSource: "generation",
          cost:
            typeof generation.total_cost === "string"
              ? decimalAmountFromProviderText(generation.total_cost)
              : decimalAmountFromNumber(generation.total_cost),
          currency: "USD",
          endedAt: this.#now().toISOString(),
          financialStatus: "confirmed",
          generationId: generation.id,
          model: generation.model,
          outcome: input.outcome,
        }),
      );
      return;
    }
    if (generationId !== null) {
      await this.#saveFinished(
        finishCostAttempt(attempt, {
          endedAt: this.#now().toISOString(),
          financialStatus: "pending",
          generationId,
          ...(model === null ? {} : { model }),
          outcome: input.outcome,
        }),
      );
      return;
    }
    await this.finishUnattributed(attempt, input.outcome);
  }

  async #begin(
    execution: CostAttempt["execution"],
    provider: string,
    model: string | null,
  ): Promise<CostAttempt> {
    const attempt = createCostAttempt({
      attemptId: this.#id(),
      execution,
      ...this.#context,
      model,
      provider,
      startedAt: this.#now().toISOString(),
    });
    await this.#store.saveAttempt(attempt);
    this.#logger?.info(
      {
        attemptId: attempt.attemptId,
        execution,
        guildId: attempt.guildId,
        meetingId: attempt.meetingId,
        phase: attempt.phase,
        provider,
      },
      "Provider cost attempt started",
    );
    return attempt;
  }

  async #saveFinished(attempt: CostAttempt): Promise<void> {
    await this.#store.saveAttempt(attempt);
    this.#logger?.info(
      {
        attemptId: attempt.attemptId,
        confirmationSource: attempt.confirmationSource ?? undefined,
        cost: attempt.cost ?? undefined,
        currency: attempt.currency ?? undefined,
        execution: attempt.execution,
        financialStatus: attempt.financialStatus,
        generationId: attempt.generationId ?? undefined,
        guildId: attempt.guildId,
        meetingId: attempt.meetingId,
        model: attempt.model ?? undefined,
        outcome: attempt.outcome,
        phase: attempt.phase,
        provider: attempt.provider,
      },
      "Provider cost attempt finished",
    );
  }

  async #getGeneration(
    generationId: string,
  ): Promise<z.infer<typeof generationResponseSchema>["data"] | undefined> {
    if (this.#openRouter === undefined) return undefined;
    const fetch_ = this.#openRouter.fetch ?? fetch;
    try {
      const response = await fetch_(
        `${OPENROUTER_GENERATION_URL}?id=${encodeURIComponent(generationId)}`,
        { headers: { Authorization: `Bearer ${this.#openRouter.apiKey}` }, method: "GET" },
      );
      if (!response.ok) return undefined;
      const parsed = await readOpenRouterResponse(response, "total_cost");
      const generation = generationResponseSchema.parse(parsed.body).data;
      return {
        ...generation,
        total_cost: parsed.exactCost ?? generation.total_cost,
      };
    } catch (error) {
      this.#logger?.warn(
        {
          errorType: error instanceof Error ? error.name : typeof error,
          generationId,
          meetingId: this.#context.meetingId,
          phase: this.#context.phase,
        },
        "OpenRouter cost reconciliation remains pending",
      );
      return undefined;
    }
  }
}
