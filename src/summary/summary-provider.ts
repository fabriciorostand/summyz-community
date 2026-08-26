import type { SummaryDraft, SummaryTranscriptEntry } from "./summary-result.js";

export interface SummaryProviderResult {
  attempts: number;
  summary: SummaryDraft;
}

export interface SummaryProvider {
  consolidate(summaries: readonly SummaryDraft[]): Promise<SummaryProviderResult>;
  summarize(entries: readonly SummaryTranscriptEntry[]): Promise<SummaryProviderResult>;
}

export class SummaryRequestError extends Error {
  public readonly retryAfterMs: number | undefined;
  public readonly retryable: boolean;
  public readonly status: number | undefined;

  public constructor(input: { retryAfterMs?: number; retryable: boolean; status?: number }) {
    super("The summary request failed");
    this.name = "SummaryRequestError";
    this.retryAfterMs = input.retryAfterMs;
    this.retryable = input.retryable;
    this.status = input.status;
  }
}

export class IncompatibleSummaryResponseError extends Error {
  public constructor() {
    super("The model returned an incompatible summary response");
    this.name = "IncompatibleSummaryResponseError";
  }
}

export class SummaryProviderFailureError extends Error {
  public readonly attempts: number;

  public constructor(attempts: number, cause: unknown) {
    super("Summary generation failed after the configured attempts", { cause });
    this.name = "SummaryProviderFailureError";
    this.attempts = attempts;
  }
}
