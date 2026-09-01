import { z } from "zod";

import type { PublicSummary } from "../summary/summary-result.js";

const TOKEN_PREFIX = "⟦SUMMYZ_PROTECTED_";

export interface ProtectedTerm {
  count: number;
  occurrencesByPath: Readonly<Record<string, number>>;
  token: string;
  value: string;
}

export interface SummaryTranslator {
  translate(summary: PublicSummary, targetLanguage: string): Promise<PublicSummary>;
}

export class TranslationRequestError extends Error {
  public readonly retryable: boolean;

  public constructor(retryable: boolean) {
    super("The translation request failed");
    this.name = "TranslationRequestError";
    this.retryable = retryable;
  }
}

export class ProtectedTermMismatchError extends Error {
  public constructor() {
    super("The translated summary changed protected terms");
    this.name = "ProtectedTermMismatchError";
  }
}

export class SummaryTranslationError extends Error {
  public readonly attempts: number;

  public constructor(attempts: number, cause: unknown) {
    super("Summary translation failed after the configured attempts", { cause });
    this.name = "SummaryTranslationError";
    this.attempts = attempts;
  }
}

interface SummaryTranslationServiceOptions {
  maxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
  sleep?: (milliseconds: number) => Promise<void>;
  translator: SummaryTranslator;
}

export class SummaryTranslationService {
  readonly #maxAttempts: number;
  readonly #retryBaseMs: number;
  readonly #retryMaxMs: number;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #translator: SummaryTranslator;

  public constructor(options: SummaryTranslationServiceOptions) {
    this.#maxAttempts = z.number().int().min(1).max(10).parse(options.maxAttempts);
    this.#retryBaseMs = z.number().int().positive().parse(options.retryBaseMs);
    this.#retryMaxMs = z.number().int().positive().parse(options.retryMaxMs);
    this.#sleep = options.sleep ?? defaultSleep;
    this.#translator = options.translator;
  }

  public static shouldTranslate(configuredLanguage: string, predominantLanguage: string): boolean {
    return configuredLanguage !== "auto" && configuredLanguage !== predominantLanguage;
  }

  public async translate(
    summary: PublicSummary,
    targetLanguage: string,
    protectedTerms: readonly string[],
  ): Promise<{ attempts: number; summary: PublicSummary }> {
    const protectedSummary = protectSummaryTerms(summary, protectedTerms);
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      try {
        const translated = await this.#translator.translate(
          protectedSummary.summary,
          targetLanguage,
        );
        return {
          attempts: attempt,
          summary: restoreSummaryTerms(translated, protectedSummary.terms),
        };
      } catch (error) {
        lastError = error;
        const retryable = !(error instanceof TranslationRequestError) || error.retryable;
        if (!retryable || attempt === this.#maxAttempts) {
          throw new SummaryTranslationError(attempt, error);
        }
        await this.#sleep(Math.min(this.#retryBaseMs * 2 ** (attempt - 1), this.#retryMaxMs));
      }
    }
    throw new SummaryTranslationError(this.#maxAttempts, lastError);
  }
}

export function protectSummaryTerms(
  summary: PublicSummary,
  inputTerms: readonly string[],
): { summary: PublicSummary; terms: ProtectedTerm[] } {
  const uniqueTerms = [...new Set(inputTerms.map((term) => term.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length || a.localeCompare(b),
  );
  let protectedSummary = cloneSummary(summary);
  const terms: ProtectedTerm[] = [];
  for (const [index, value] of uniqueTerms.entries()) {
    const token = `${TOKEN_PREFIX}${String(index + 1).padStart(4, "0")}⟧`;
    let count = 0;
    const occurrencesByPath: Record<string, number> = {};
    protectedSummary = mapSummaryStrings(protectedSummary, (text, path) => {
      const occurrences = text.split(value).length - 1;
      count += occurrences;
      if (occurrences > 0) occurrencesByPath[path] = occurrences;
      return text.replaceAll(value, token);
    });
    if (count > 0) terms.push({ count, occurrencesByPath, token, value });
  }
  return { summary: protectedSummary, terms };
}

export function restoreSummaryTerms(
  summary: PublicSummary,
  terms: readonly ProtectedTerm[],
): PublicSummary {
  const serialized = JSON.stringify(summary);
  for (const term of terms) {
    if (serialized.split(term.token).length - 1 !== term.count) {
      throw new ProtectedTermMismatchError();
    }
    const actualByPath: Record<string, number> = {};
    mapSummaryStrings(summary, (text, path) => {
      const count = text.split(term.token).length - 1;
      if (count > 0) actualByPath[path] = count;
      return text;
    });
    if (JSON.stringify(actualByPath) !== JSON.stringify(term.occurrencesByPath)) {
      throw new ProtectedTermMismatchError();
    }
  }
  return mapSummaryStrings(cloneSummary(summary), (text) => {
    let restored = text;
    for (const term of terms) restored = restored.replaceAll(term.token, term.value);
    return restored;
  });
}

function mapSummaryStrings(
  summary: PublicSummary,
  map: (value: string, path: string) => string,
): PublicSummary {
  return {
    decisions: summary.decisions.map((value, index) => map(value, `decisions.${String(index)}`)),
    discussedTopics: summary.discussedTopics.map((value, index) =>
      map(value, `discussedTopics.${String(index)}`),
    ),
    executiveSummary: map(summary.executiveSummary, "executiveSummary"),
    ...(summary.labels === undefined
      ? {}
      : {
          labels: {
            assignee: map(summary.labels.assignee, "labels.assignee"),
            deadline: map(summary.labels.deadline, "labels.deadline"),
            decisions: map(summary.labels.decisions, "labels.decisions"),
            discussedTopics: map(summary.labels.discussedTopics, "labels.discussedTopics"),
            executiveSummary: map(summary.labels.executiveSummary, "labels.executiveSummary"),
            fullTranscript: map(summary.labels.fullTranscript, "labels.fullTranscript"),
            meetingId: map(summary.labels.meetingId, "labels.meetingId"),
            observations: map(summary.labels.observations, "labels.observations"),
            summary: map(summary.labels.summary, "labels.summary"),
            tasks: map(summary.labels.tasks, "labels.tasks"),
            transcript: map(summary.labels.transcript, "labels.transcript"),
          },
        }),
    observations: summary.observations.map((value, index) =>
      map(value, `observations.${String(index)}`),
    ),
    tasks: summary.tasks.map((task, index) => ({
      ...(task.deadlineText === undefined
        ? {}
        : { deadlineText: map(task.deadlineText, `tasks.${String(index)}.deadlineText`) }),
      ...(task.ownerName === undefined
        ? {}
        : { ownerName: map(task.ownerName, `tasks.${String(index)}.ownerName`) }),
      text: map(task.text, `tasks.${String(index)}.text`),
    })),
  };
}

function cloneSummary(summary: PublicSummary): PublicSummary {
  return mapSummaryStrings(summary, (value) => value);
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
