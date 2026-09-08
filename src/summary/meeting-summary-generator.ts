import {
  type SummaryProvider,
  SummaryProviderFailureError,
  type SummaryProviderResult,
} from "./summary-provider.js";
import {
  type SummaryDraft,
  type SummaryTranscriptEntry,
  summaryTranscriptEntrySchema,
  validateGroundedSummary,
} from "./summary-result.js";

interface MeetingSummaryGeneratorOptions {
  maxChunkCharacters: number;
  provider: SummaryProvider;
}

export interface MeetingSummaryGenerationResult {
  attempts: number;
  summary: SummaryDraft;
}

export class MeetingSummaryGenerator {
  readonly #maxChunkCharacters: number;
  readonly #provider: SummaryProvider;

  public constructor(options: MeetingSummaryGeneratorOptions) {
    if (!Number.isInteger(options.maxChunkCharacters) || options.maxChunkCharacters < 1) {
      throw new Error("O limite de caracteres do resumo é inválido");
    }
    this.#maxChunkCharacters = options.maxChunkCharacters;
    this.#provider = options.provider;
  }

  public async generate(
    input: readonly SummaryTranscriptEntry[],
  ): Promise<MeetingSummaryGenerationResult> {
    const entries = input.map((entry) => summaryTranscriptEntrySchema.parse(entry));
    const chunks = createChunks(entries, this.#maxChunkCharacters);
    const partials: SummaryDraft[] = [];
    let attempts = 0;
    for (const chunk of chunks) {
      let result: SummaryProviderResult;
      try {
        result = await this.#provider.summarize(chunk);
      } catch (error) {
        if (error instanceof SummaryProviderFailureError) {
          throw new SummaryProviderFailureError(attempts + error.attempts, error);
        }
        throw error;
      }
      attempts += result.attempts;
      partials.push(validateGroundedSummary(result.summary, chunk));
    }

    const first = partials[0];
    if (first === undefined) {
      throw new Error("O gerador não produziu nenhum resumo");
    }
    if (partials.length === 1) {
      return { attempts, summary: first };
    }

    let consolidated: SummaryProviderResult;
    try {
      consolidated = await this.#provider.consolidate(partials);
    } catch (error) {
      if (error instanceof SummaryProviderFailureError) {
        throw new SummaryProviderFailureError(attempts + error.attempts, error);
      }
      throw error;
    }
    return {
      attempts: attempts + consolidated.attempts,
      summary: validateGroundedSummary(consolidated.summary, entries),
    };
  }
}

function createChunks(
  entries: readonly SummaryTranscriptEntry[],
  maxCharacters: number,
): SummaryTranscriptEntry[][] {
  if (entries.length === 0) {
    return [[]];
  }
  const chunks: SummaryTranscriptEntry[][] = [];
  let current: SummaryTranscriptEntry[] = [];
  let currentSize = 0;
  for (const entry of entries) {
    const size = JSON.stringify(entry).length;
    if (current.length > 0 && currentSize + size > maxCharacters) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(entry);
    currentSize += size;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}
