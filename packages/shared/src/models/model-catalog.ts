import { z } from "zod";

export const modelPhaseSchema = z.enum(["transcription", "refinement", "summary"]);
export const modelProviderSchema = z.enum(["openrouter", "ollama", "faster-whisper"]);
export type ModelPhase = z.infer<typeof modelPhaseSchema>;
export type ModelProvider = z.infer<typeof modelProviderSchema>;
export const catalogItemSchema = z.object({
  model: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
  sizeBytes: z.number().nonnegative().nullable(),
  family: z.string().optional(),
  variantsAvailable: z.boolean().optional(),
  inputModalities: z.array(z.string()).optional(),
  outputModalities: z.array(z.string()).optional(),
  supportedParameters: z.array(z.string()).optional(),
});
export type CatalogItem = z.infer<typeof catalogItemSchema>;
export const catalogSnapshotSchema = z.object({
  fetchedAt: z.number().nonnegative(),
  items: z.array(catalogItemSchema).max(50_000),
});
export type CatalogSnapshot = z.infer<typeof catalogSnapshotSchema>;
export interface CatalogCacheStore {
  read(key: string): Promise<CatalogSnapshot | undefined>;
  write(key: string, snapshot: CatalogSnapshot): Promise<void>;
}
export interface CatalogResult extends CatalogSnapshot {
  status: "fresh" | "stale" | "unavailable";
}

export class CachedModelCatalog {
  readonly #pending = new Map<string, Promise<CatalogResult>>();
  public constructor(
    private readonly store: CatalogCacheStore,
    private readonly now = Date.now,
  ) {}

  public async get(key: string, source: () => Promise<CatalogItem[]>): Promise<CatalogResult> {
    const existing = this.#pending.get(key);
    if (existing !== undefined) return existing;
    const request = this.#load(key, source);
    this.#pending.set(key, request);
    try {
      return await request;
    } finally {
      this.#pending.delete(key);
    }
  }

  async #load(key: string, source: () => Promise<CatalogItem[]>): Promise<CatalogResult> {
    const previous = await this.store.read(key);
    const age = previous === undefined ? Infinity : this.now() - previous.fetchedAt;
    if (previous !== undefined && age >= 0 && age < 15 * 60_000)
      return { ...previous, status: "fresh" };
    try {
      const snapshot = catalogSnapshotSchema.parse({
        fetchedAt: this.now(),
        items: await source(),
      });
      await this.store.write(key, snapshot);
      return { ...snapshot, status: "fresh" };
    } catch {
      if (previous !== undefined && age >= 0 && age <= 24 * 60 * 60_000)
        return { ...previous, status: "stale" };
      return { fetchedAt: previous?.fetchedAt ?? 0, items: [], status: "unavailable" };
    }
  }
}

export class ModelOperationError extends Error {
  public constructor(
    public readonly code: string,
    public readonly statusCode = 409,
  ) {
    super(code);
    this.name = "ModelOperationError";
  }
}
