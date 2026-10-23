import type { PostgresDatabase } from "summyz-community-shared/database/postgres-database";
import {
  type LocalProvider,
  normalizeModel,
} from "summyz-community-shared/models/local-model-inventory";
import { ModelOperationError, type ModelPhase } from "summyz-community-shared/models/model-catalog";
import type { ModelDownloadManager } from "summyz-community-shared/models/model-download-manager";
import { lockModelLifecycle } from "summyz-community-shared/models/model-lifecycle-lock";
import type { ModelCatalogService } from "./model-catalog-service.js";

export class ModelManagement {
  public constructor(
    private readonly database: PostgresDatabase,
    private readonly catalog: ModelCatalogService,
    public readonly downloads: ModelDownloadManager,
    private readonly request: typeof fetch = fetch,
  ) {}
  public async download(phase: ModelPhase, provider: LocalProvider, model: string) {
    await this.catalog.requireSelection(phase, provider, model);
    return this.database.transaction(async (database) => {
      await lockModelLifecycle(database);
      const active = (await this.downloads.store.list({ activeOnly: true })).filter((job) =>
        ["queued", "downloading", "cancelling"].includes(job.status),
      );
      if (
        active.length >= 20 &&
        !active.some(
          (job) => job.provider === provider && job.model === normalizeModel(provider, model),
        )
      ) {
        throw new ModelOperationError("download_queue_full", 429);
      }
      return this.downloads.store.create(provider, normalizeModel(provider, model));
    });
  }
  public async remove(provider: LocalProvider, inputModel: string): Promise<void> {
    const model = normalizeModel(provider, inputModel);
    await this.database.transaction(async (database) => {
      await lockModelLifecycle(database);
      const usage = await database.query(
        `SELECT EXISTS (
        SELECT 1 FROM meetings meeting,
          LATERAL jsonb_each(COALESCE(meeting.manifest->'aiConfiguration', '{}'::jsonb)) selection
        WHERE (meeting.pipeline_status NOT IN ('completed', 'failed') OR meeting.artifacts_delete_after > now())
          AND selection.key IN ('transcription', 'refinement', 'summary')
          AND selection.value->>'provider' = $1
          AND (selection.value->>'model' = $2 OR ($1 = 'ollama' AND selection.value->>'model' || ':latest' = $2))
      ) AS in_use`,
        [provider, model],
      );
      if (usage.rows[0]?.in_use !== false) throw new ModelOperationError("model_in_use");
      if (
        (await this.downloads.store.list({ activeOnly: true })).some(
          (job) =>
            job.provider === provider &&
            job.model === model &&
            ["queued", "downloading", "cancelling"].includes(job.status),
        )
      )
        throw new ModelOperationError("model_download_active");
      const response = await this.request(
        provider === "ollama"
          ? "http://ollama:11434/api/delete"
          : "http://faster-whisper:8000/models/delete",
        {
          method: provider === "ollama" ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model }),
          signal: AbortSignal.timeout(60_000),
        },
      );
      if (!response.ok && response.status !== 404)
        throw new ModelOperationError("model_delete_failed", 503);
    });
  }
}
