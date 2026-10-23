import {
  IncompatibleRefinementResponseError,
  type RefinementProvider,
  RefinementProviderFailureError,
  RefinementRequestError,
} from "./refinement-provider.js";
import { type RefinementEntry, refinementEntrySchema } from "./refinement-result.js";

interface MeetingRefinementGeneratorOptions {
  maxChunkCharacters: number;
  provider: RefinementProvider;
}

export interface MeetingRefinementGenerationResult {
  attempts: number;
  entries: RefinementEntry[];
}

export class MeetingRefinementGenerator {
  readonly #maxChunkCharacters: number;
  readonly #provider: RefinementProvider;

  public constructor(options: MeetingRefinementGeneratorOptions) {
    if (!Number.isInteger(options.maxChunkCharacters) || options.maxChunkCharacters < 1) {
      throw new Error("O limite de caracteres do refinamento é inválido");
    }
    this.#maxChunkCharacters = options.maxChunkCharacters;
    this.#provider = options.provider;
  }

  public async generate(
    input: readonly RefinementEntry[],
  ): Promise<MeetingRefinementGenerationResult> {
    const entries = input.map((entry) => refinementEntrySchema.parse(entry));
    if (entries.length === 0) {
      return { attempts: 0, entries: [] };
    }
    const refined: RefinementEntry[] = [];
    let attempts = 0;
    for (const chunk of createChunks(entries, this.#maxChunkCharacters)) {
      try {
        const result = await this.#refineChunk(chunk);
        attempts += result.attempts;
        refined.push(...result.entries);
      } catch (error) {
        if (error instanceof RefinementProviderFailureError) {
          throw new RefinementProviderFailureError(attempts + error.attempts, error);
        }
        throw error;
      }
    }
    return { attempts, entries: refined };
  }

  async #refineChunk(
    chunk: readonly RefinementEntry[],
  ): Promise<MeetingRefinementGenerationResult> {
    try {
      return await this.#provider.refine(chunk);
    } catch (error) {
      if (
        !(error instanceof RefinementProviderFailureError) ||
        chunk.length < 2 ||
        !isCausedBySplittableFailure(error)
      ) {
        throw error;
      }

      const middle = Math.ceil(chunk.length / 2);
      const parts = [chunk.slice(0, middle), chunk.slice(middle)];
      const entries: RefinementEntry[] = [];
      let attempts = error.attempts;
      for (const part of parts) {
        try {
          const result = await this.#refineChunk(part);
          attempts += result.attempts;
          entries.push(...result.entries);
        } catch (partError) {
          if (partError instanceof RefinementProviderFailureError) {
            throw new RefinementProviderFailureError(attempts + partError.attempts, partError);
          }
          throw partError;
        }
      }
      return { attempts, entries };
    }
  }
}

function isCausedBySplittableFailure(error: unknown): boolean {
  const visited = new Set<Error>();
  let current = error;
  while (current instanceof Error && !visited.has(current)) {
    if (current instanceof IncompatibleRefinementResponseError) return true;
    if (current instanceof RefinementRequestError && current.timedOut) return true;
    visited.add(current);
    current = current.cause;
  }
  return false;
}

function createChunks(
  entries: readonly RefinementEntry[],
  maxCharacters: number,
): RefinementEntry[][] {
  const chunks: RefinementEntry[][] = [];
  let current: RefinementEntry[] = [];
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
  if (current.length > 0) chunks.push(current);
  return chunks;
}
