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

type OpenRouterGeneration = z.infer<typeof generationResponseSchema>["data"];
type OpenRouterMetadataResult = ReturnType<typeof openRouterResponseMetadataSchema.safeParse>;

interface ResolvedOpenRouterCost {
  directCost: number | string | undefined;
  generation: OpenRouterGeneration | undefined;
  generationId: string | null;
  model: string | null;
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
    const resolved = await this.#resolveOpenRouterCost(input);
    if (resolved.directCost !== undefined) {
      await this.#finishDirectCost(attempt, input, resolved, resolved.directCost);
      return;
    }
    if (resolved.generation !== undefined) {
      await this.#finishGenerationCost(attempt, input, resolved.generation);
      return;
    }
    if (resolved.generationId !== null) {
      await this.#finishPending(attempt, input, resolved, resolved.generationId);
      return;
    }
    await this.finishUnattributed(attempt, input.outcome);
  }

  async #resolveOpenRouterCost(input: OpenRouterResponseResult): Promise<ResolvedOpenRouterCost> {
    const direct = openRouterResponseMetadataSchema.safeParse(input.body);
    const generationId = input.generationId ?? null;
    let model = directModel(direct);
    const directCost = input.exactCost ?? directResponseCost(direct);
    let generation: OpenRouterGeneration | undefined;
    if (shouldLoadGeneration(generationId, directCost, model)) {
      generation = await this.#getGeneration(generationId);
      model = resolvedModel(model, generation);
    }
    return { directCost, generation, generationId, model };
  }

  async #finishDirectCost(
    attempt: CostAttempt,
    input: OpenRouterResponseResult,
    resolved: ResolvedOpenRouterCost,
    directCost: number | string,
  ): Promise<void> {
    await this.#saveFinished(
      finishCostAttempt(attempt, {
        confirmationSource: "response",
        cost: providerCost(directCost),
        currency: "USD",
        endedAt: this.#now().toISOString(),
        financialStatus: "confirmed",
        ...trackingFields(resolved.generationId, resolved.model),
        outcome: input.outcome,
      }),
    );
  }

  async #finishGenerationCost(
    attempt: CostAttempt,
    input: OpenRouterResponseResult,
    generation: OpenRouterGeneration,
  ): Promise<void> {
    await this.#saveFinished(
      finishCostAttempt(attempt, {
        confirmationSource: "generation",
        cost: providerCost(generation.total_cost),
        currency: "USD",
        endedAt: this.#now().toISOString(),
        financialStatus: "confirmed",
        generationId: generation.id,
        model: generation.model,
        outcome: input.outcome,
      }),
    );
  }

  async #finishPending(
    attempt: CostAttempt,
    input: OpenRouterResponseResult,
    resolved: ResolvedOpenRouterCost,
    generationId: string,
  ): Promise<void> {
    await this.#saveFinished(
      finishCostAttempt(attempt, {
        endedAt: this.#now().toISOString(),
        financialStatus: "pending",
        generationId,
        ...trackingFields(null, resolved.model),
        outcome: input.outcome,
      }),
    );
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
    this.#logger?.info(finishedAttemptLog(attempt), "Provider cost attempt finished");
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

function providerCost(value: number | string): string {
  return typeof value === "string"
    ? decimalAmountFromProviderText(value)
    : decimalAmountFromNumber(value);
}

function trackingFields(
  generationId: string | null,
  model: string | null,
): Partial<Pick<CostAttempt, "generationId" | "model">> {
  return {
    ...(generationId === null ? {} : { generationId }),
    ...(model === null ? {} : { model }),
  };
}

function finishedAttemptLog(attempt: CostAttempt) {
  return {
    attemptId: attempt.attemptId,
    confirmationSource: nullAsUndefined(attempt.confirmationSource),
    cost: nullAsUndefined(attempt.cost),
    currency: nullAsUndefined(attempt.currency),
    execution: attempt.execution,
    financialStatus: attempt.financialStatus,
    generationId: nullAsUndefined(attempt.generationId),
    guildId: attempt.guildId,
    meetingId: attempt.meetingId,
    model: nullAsUndefined(attempt.model),
    outcome: attempt.outcome,
    phase: attempt.phase,
    provider: attempt.provider,
  };
}

function directModel(metadata: OpenRouterMetadataResult): string | null {
  if (!metadata.success) return null;
  return metadata.data.model ?? null;
}

function directResponseCost(metadata: OpenRouterMetadataResult): number | undefined {
  if (!metadata.success) return undefined;
  return metadata.data.usage?.cost;
}

function shouldLoadGeneration(
  generationId: string | null,
  directCost: number | string | undefined,
  model: string | null,
): generationId is string {
  if (generationId === null) return false;
  return directCost === undefined || model === null;
}

function resolvedModel(
  model: string | null,
  generation: OpenRouterGeneration | undefined,
): string | null {
  if (model !== null) return model;
  return generation?.model ?? null;
}

function nullAsUndefined<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}
