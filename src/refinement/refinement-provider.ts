import type { RefinementEntry } from "./refinement-result.js";

export interface RefinementProviderResult {
  attempts: number;
  entries: RefinementEntry[];
}

export interface RefinementProvider {
  refine(entries: readonly RefinementEntry[]): Promise<RefinementProviderResult>;
}

export class RefinementRequestError extends Error {
  public readonly retryAfterMs: number | undefined;
  public readonly retryable: boolean;
  public readonly status: number | undefined;

  public constructor(input: { retryAfterMs?: number; retryable: boolean; status?: number }) {
    super("The refinement request failed");
    this.name = "RefinementRequestError";
    this.retryAfterMs = input.retryAfterMs;
    this.retryable = input.retryable;
    this.status = input.status;
  }
}

export class IncompatibleRefinementResponseError extends Error {
  public constructor() {
    super("The model returned an incompatible refinement response");
    this.name = "IncompatibleRefinementResponseError";
  }
}

export class RefinementProviderFailureError extends Error {
  public readonly attempts: number;

  public constructor(attempts: number, cause: unknown) {
    super("Refinement failed after the configured attempts", { cause });
    this.name = "RefinementProviderFailureError";
    this.attempts = attempts;
  }
}
