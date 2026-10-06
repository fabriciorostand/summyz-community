import { z } from "zod";

import type { PostgresExecutor } from "../database/postgres-database.js";
import type { RecordingManifest } from "../recording/manifest.js";
import {
  type CostAttempt,
  type CostLedgerStore,
  costAttemptSchema,
  toCostMeetingRecord,
} from "./cost-ledger.js";

const identifierSchema = z.string().min(1).max(128);

export class PostgresCostLedgerStore implements CostLedgerStore {
  readonly #database: PostgresExecutor;

  public constructor(database: PostgresExecutor) {
    this.#database = database;
  }

  public async saveMeeting(manifest: RecordingManifest): Promise<void> {
    toCostMeetingRecord(manifest);
  }

  public async saveAttempt(attempt: CostAttempt): Promise<void> {
    const value = costAttemptSchema.parse(attempt);
    await this.#database.query(
      `
INSERT INTO provider_cost_attempts (
  attempt_id, meeting_id, guild_id, phase, execution, provider, model,
  started_at, ended_at, outcome, financial_status, cost, currency,
  generation_id, confirmation_source
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::numeric, $13, $14, $15
)
ON CONFLICT (attempt_id) DO UPDATE SET
  model = EXCLUDED.model,
  ended_at = EXCLUDED.ended_at,
  outcome = EXCLUDED.outcome,
  financial_status = EXCLUDED.financial_status,
  cost = EXCLUDED.cost,
  currency = EXCLUDED.currency,
  generation_id = EXCLUDED.generation_id,
  confirmation_source = EXCLUDED.confirmation_source,
  updated_at = now()
`,
      [
        value.attemptId,
        value.meetingId,
        value.guildId,
        value.phase,
        value.execution,
        value.provider,
        value.model,
        value.startedAt,
        value.endedAt,
        value.outcome,
        value.financialStatus,
        value.cost,
        value.currency,
        value.generationId,
        value.confirmationSource,
      ],
    );
  }

  public async listReconciliationCandidates(guildId?: string): Promise<CostAttempt[]> {
    const result = await this.#database.query(
      `
SELECT
  attempt_id,
  meeting_id,
  guild_id,
  phase,
  execution,
  provider,
  model,
  started_at AS attempt_started_at,
  ended_at,
  outcome,
  financial_status,
  cost::text AS cost,
  currency,
  generation_id,
  confirmation_source
FROM provider_cost_attempts
WHERE provider = 'openrouter'
  AND generation_id IS NOT NULL
  AND (financial_status = 'pending' OR model IS NULL)
  ${guildId === undefined ? "" : "AND guild_id = $1"}
ORDER BY started_at
`,
      guildId === undefined ? [] : [identifierSchema.parse(guildId)],
    );
    return result.rows.map(parseAttempt);
  }
}

function parseAttempt(row: Record<string, unknown>): CostAttempt {
  return costAttemptSchema.parse({
    attemptId: row.attempt_id,
    confirmationSource: nullable(row.confirmation_source),
    cost: nullable(row.cost),
    currency: nullable(row.currency),
    endedAt: toIsoOrNull(row.ended_at),
    execution: row.execution,
    financialStatus: row.financial_status,
    generationId: nullable(row.generation_id),
    guildId: row.guild_id,
    meetingId: row.meeting_id,
    model: nullable(row.model),
    outcome: row.outcome,
    phase: row.phase,
    provider: row.provider,
    startedAt: toIso(row.attempt_started_at),
  });
}

function nullable(value: unknown): unknown {
  return value ?? null;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return z.iso.datetime().parse(value);
}

function toIsoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : toIso(value);
}
