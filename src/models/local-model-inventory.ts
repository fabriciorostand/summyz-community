import { z } from "zod";
import { ModelOperationError, type ModelPhase } from "./model-catalog.js";

export type LocalProvider = "ollama" | "faster-whisper";
export interface ModelSelection {
  provider: string | null;
  model: string | null;
}
export type StageSelections = Record<ModelPhase, ModelSelection>;
export interface MissingModel {
  phase: ModelPhase;
  provider: LocalProvider;
  model: string;
}
export interface ProfileAvailability {
  status: "ready" | "incomplete" | "missing_models" | "unavailable";
  missingModels: MissingModel[];
  unavailableProviders: LocalProvider[];
}
export class LocalModelsUnavailableError extends ModelOperationError {
  public constructor(public readonly availability: ProfileAvailability) {
    super(
      availability.status === "missing_models"
        ? "local_models_missing"
        : "local_models_unavailable",
    );
    this.name = "LocalModelsUnavailableError";
  }
}
const inventorySchema = z.object({
  models: z
    .array(
      z.object({
        model: z.string().optional(),
        name: z.string().optional(),
        size: z.number().nonnegative().optional(),
      }),
    )
    .max(10_000),
});

export class LocalModelInventory {
  public constructor(private readonly request: typeof fetch = fetch) {}
  public async list(provider: LocalProvider) {
    try {
      const url =
        provider === "ollama"
          ? "http://ollama:11434/api/tags"
          : "http://faster-whisper:8000/models";
      const response = await this.request(url, {
        method: "GET",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("Inventory unavailable");
      const data = inventorySchema.parse(await response.json());
      return {
        status: "available" as const,
        models: data.models.map((entry) => ({
          model: entry.model ?? entry.name ?? "",
          sizeBytes: entry.size ?? null,
        })),
      };
    } catch {
      return { status: "unavailable" as const, models: [] };
    }
  }
  public async assess(configuration: StageSelections): Promise<ProfileAvailability> {
    const phases = ["transcription", "refinement", "summary"] as const;
    const result: ProfileAvailability = {
      status: "ready",
      missingModels: [],
      unavailableProviders: [],
    };
    if (
      phases.some(
        (phase) => configuration[phase].provider === null || configuration[phase].model === null,
      )
    ) {
      result.status = "incomplete";
    }
    for (const provider of ["ollama", "faster-whisper"] as const) {
      const selections = phases.filter(
        (phase) =>
          configuration[phase].provider === provider && configuration[phase].model !== null,
      );
      if (selections.length === 0) continue;
      const inventory = await this.list(provider);
      if (inventory.status === "unavailable") {
        result.unavailableProviders.push(provider);
        continue;
      }
      result.missingModels.push(
        ...findMissingModels(provider, selections, configuration, inventory.models),
      );
    }
    if (result.status !== "incomplete")
      result.status =
        result.unavailableProviders.length > 0
          ? "unavailable"
          : result.missingModels.length > 0
            ? "missing_models"
            : "ready";
    return result;
  }
  public async requireInstalled(configuration: StageSelections): Promise<void> {
    const availability = await this.assess(configuration);
    if (availability.status !== "ready") throw new LocalModelsUnavailableError(availability);
  }
}

function findMissingModels(
  provider: LocalProvider,
  phases: readonly ModelPhase[],
  configuration: StageSelections,
  installed: readonly { model: string }[],
): MissingModel[] {
  return phases.flatMap((phase) => {
    const model = configuration[phase].model;
    if (
      model === null ||
      installed.some(
        (entry) => normalizeModel(provider, entry.model) === normalizeModel(provider, model),
      )
    )
      return [];
    return [{ phase, provider, model }];
  });
}

export function normalizeModel(provider: LocalProvider, model: string): string {
  return provider === "ollama" && !model.includes(":") ? `${model}:latest` : model;
}
