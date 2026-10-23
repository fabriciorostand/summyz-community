import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { ModelCatalogService } from "summyz-community-api/models/model-catalog-service";
import { ModelManagement } from "summyz-community-api/models/model-management";
import { DurableJobQueue } from "summyz-community-bot/processing/durable-job-queue";
import {
  aiProfileSchema,
  createEmptyInitialAiProfile,
  createInitialAiProfile,
} from "summyz-community-shared/ai-profile";
import { PostgresAiProfileStore } from "summyz-community-shared/database/postgres-ai-profile-store";
import { createPostgresDatabase } from "summyz-community-shared/database/postgres-database";
import { PostgresMeetingStore } from "summyz-community-shared/database/postgres-meeting-store";
import { PostgresModelDownloadStore } from "summyz-community-shared/database/postgres-model-download-store";
import { createLogger } from "summyz-community-shared/logger";
import { LocalModelInventory } from "summyz-community-shared/models/local-model-inventory";
import { CachedModelCatalog } from "summyz-community-shared/models/model-catalog";
import { ModelDownloadManager } from "summyz-community-shared/models/model-download-manager";
import { createManifest, markManifestCompleted } from "summyz-community-shared/recording/manifest";
import { describe, expect, it, vi } from "vitest";

describe.skipIf(process.env.POSTGRES_TEST_URL === undefined)(
  "contratos de modelos no PostgreSQL",
  () => {
    it("enforces case-sensitive global names and protects pinned meeting models", async () => {
      const url = process.env.POSTGRES_TEST_URL;
      if (url === undefined) throw new Error("POSTGRES_TEST_URL required");
      const admin = new Pool({ connectionString: url });
      const schema = `models_${randomUUID().replaceAll("-", "")}`;
      await admin.query(`CREATE SCHEMA "${schema}"`);
      const scoped = new URL(url);
      scoped.searchParams.set("options", `-c search_path=${schema}`);
      const database = createPostgresDatabase(scoped.toString());
      try {
        await database.initialize();
        const profiles = new PostgresAiProfileStore(database);
        await profiles.createProfile(createEmptyInitialAiProfile("pt-BR"));
        expect((await profiles.listProfiles())[0]?.profileType).toBeNull();
        const base = createInitialAiProfile("external", "pt-BR");
        const one = aiProfileSchema.parse({ ...base, profileId: "one", name: " Mesmo " });
        const two = aiProfileSchema.parse({
          ...createInitialAiProfile("local", "pt-BR"),
          profileId: "two",
          name: "Mesmo",
        });
        const results = await Promise.allSettled([
          profiles.createProfile(one),
          profiles.createProfile(two),
        ]);
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
        await profiles.createProfile(
          aiProfileSchema.parse({ ...base, profileId: "case", name: "mesmo" }),
        );
        const manifest = createManifest({
          guildId: "guild",
          meetingId: randomUUID(),
          notificationChannelId: "text",
          voiceChannelId: "voice",
          startedAt: new Date().toISOString(),
          storageMode: "postgres",
          aiConfiguration: {
            profileType: "hybrid",
            language: "auto",
            transcription: { provider: "openrouter", model: "vendor/audio", vad: {} },
            refinement: { provider: "openrouter", model: "vendor/text" },
            summary: { provider: "ollama", model: "qwen3:8b" },
          },
        });
        await new PostgresMeetingStore(database).save(manifest);
        const completed = markManifestCompleted(manifest, new Date().toISOString());
        await new PostgresMeetingStore(database).save(completed);
        await database.query(
          "UPDATE processing_jobs SET attempt_count = max_attempts - 1 WHERE meeting_id = $1",
          [manifest.meetingId],
        );
        const queue = new DurableJobQueue(database);
        const claimed = await queue.claim("model-contract-worker");
        if (claimed === undefined) throw new Error("Expected a processing job");
        expect(claimed.finalAttempt).toBe(true);
        await queue.fail(claimed, "local_models_missing", "model-contract-worker");
        const waiting = await database.query(
          "SELECT status, attempt_count, max_attempts, last_failure_code FROM processing_jobs WHERE job_id = $1",
          [claimed.jobId],
        );
        expect(waiting.rows[0]).toMatchObject({
          status: "scheduled",
          attempt_count: claimed.maxAttempts - 1,
          last_failure_code: "local_models_missing",
        });
        expect(
          (await new PostgresMeetingStore(database).load(manifest.meetingId)).aiConfiguration,
        ).toEqual(completed.aiConfiguration);
        const store = new PostgresModelDownloadStore(database);
        const downloads = new ModelDownloadManager(
          store,
          { run: async () => {}, cleanup: async () => {} },
          createLogger("silent"),
        );
        const catalog = new ModelCatalogService(
          new CachedModelCatalog({ read: async () => undefined, write: async () => {} }),
          new LocalModelInventory(),
          { cpuCores: 1, memoryBytes: 1 },
          async () => undefined,
        );
        const request = vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response(null, { status: 204 }));
        const management = new ModelManagement(database, catalog, downloads, request);
        await expect(management.remove("ollama", "qwen3:8b")).rejects.toMatchObject({
          code: "model_in_use",
        });
        await database.query(
          "UPDATE meetings SET pipeline_status = 'failed', artifacts_delete_after = now() + interval '1 hour' WHERE meeting_id = $1",
          [manifest.meetingId],
        );
        await expect(management.remove("ollama", "qwen3:8b")).rejects.toMatchObject({
          code: "model_in_use",
        });
        expect(request).not.toHaveBeenCalled();
        await database.query(
          "UPDATE meetings SET artifacts_delete_after = now() - interval '1 hour' WHERE meeting_id = $1",
          [manifest.meetingId],
        );
        await management.remove("ollama", "qwen3:8b");
        expect(request).toHaveBeenCalledOnce();
        const job = await store.create("ollama", "qwen3:8b");
        await store.update(job.downloadId, {
          status: "cancelling",
          failureCode: "download_failed",
        });
        await store.update(job.downloadId, { status: "completed", completedBytes: 10 });
        expect(await store.get(job.downloadId)).toMatchObject({
          status: "cancelling",
          failureCode: "download_failed",
        });
      } finally {
        await database.close();
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
        await admin.end();
      }
    });
  },
);
