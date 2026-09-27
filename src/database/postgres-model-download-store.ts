import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  type DownloadPatch,
  type DownloadStore,
  downloadSchema,
  type ModelDownload,
} from "../models/model-download-manager.js";
import type { PostgresExecutor } from "./postgres-database.js";

export class PostgresModelDownloadStore implements DownloadStore {
  public constructor(private readonly database: PostgresExecutor) {}
  public async list(): Promise<ModelDownload[]> {
    const result = await this.database.query(
      `SELECT * FROM model_downloads ORDER BY
        CASE status WHEN 'cancelling' THEN 0 WHEN 'downloading' THEN 1 WHEN 'queued' THEN 2 ELSE 3 END,
        CASE WHEN status IN ('queued', 'downloading', 'cancelling') THEN created_at END ASC,
        created_at DESC LIMIT 1000`,
    );
    return result.rows.map(parseRow);
  }
  public async get(id: string): Promise<ModelDownload | undefined> {
    const result = await this.database.query(
      "SELECT * FROM model_downloads WHERE download_id = $1",
      [id],
    );
    return result.rows[0] === undefined ? undefined : parseRow(result.rows[0]);
  }
  public async create(provider: ModelDownload["provider"], model: string): Promise<ModelDownload> {
    const result = await this.database.query(
      `INSERT INTO model_downloads (download_id, provider, model, status)
      VALUES ($1, $2, $3, 'queued')
      ON CONFLICT (provider, model) WHERE status IN ('queued', 'downloading', 'cancelling')
      DO UPDATE SET model = EXCLUDED.model RETURNING *`,
      [randomUUID(), provider, model],
    );
    return parseRow(result.rows[0]);
  }
  public async update(id: string, patch: DownloadPatch): Promise<void> {
    await this.database.query(
      `UPDATE model_downloads SET
      status = CASE WHEN status = 'cancelling' AND $2::text IN ('downloading', 'completed') THEN status ELSE COALESCE($2, status) END,
      completed_bytes = COALESCE($3, completed_bytes), total_bytes = COALESCE($4, total_bytes),
      partial_digests = COALESCE($5::jsonb, partial_digests), failure_code = CASE WHEN $7 THEN $6 ELSE failure_code END, updated_at = now()
      WHERE download_id = $1`,
      [
        id,
        patch.status ?? null,
        patch.completedBytes ?? null,
        patch.totalBytes ?? null,
        patch.partialDigests === undefined ? null : JSON.stringify(patch.partialDigests),
        patch.failureCode ?? null,
        Object.hasOwn(patch, "failureCode"),
      ],
    );
  }
}
function parseRow(value: unknown): ModelDownload {
  const row = z.record(z.string(), z.unknown()).parse(value);
  return downloadSchema.parse({
    downloadId: row?.download_id,
    provider: row?.provider,
    model: row?.model,
    status: row?.status,
    completedBytes: Number(row?.completed_bytes),
    totalBytes: row?.total_bytes == null ? null : Number(row.total_bytes),
    partialDigests: row?.partial_digests,
    failureCode: row?.failure_code,
  });
}
