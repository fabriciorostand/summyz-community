import { z } from "zod";

import type { PostgresExecutor } from "./postgres-database.js";

const componentTypeSchema = z.enum([
  "bot",
  "database",
  "ffmpeg",
  "worker",
  "queue",
  "ollama",
  "faster_whisper",
  "openrouter",
]);
const componentStatusSchema = z.enum(["ready", "degraded", "unavailable", "not_configured"]);
const identifierSchema = z.string().min(1).max(128);
const jsonValueSchema = z.json();
type JsonValue = z.infer<typeof jsonValueSchema>;
const safeDetailsSchema = z
  .record(z.string().min(1).max(100), jsonValueSchema)
  .superRefine((details, context) => {
    const sensitive = Object.keys(details).find((key) =>
      /authorization|credential|password|secret|token/i.test(key),
    );
    if (sensitive !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Heartbeat details cannot contain secrets",
        path: [sensitive],
      });
    }
  });

export interface ComponentHeartbeatInput {
  componentId: string;
  componentType: z.infer<typeof componentTypeSchema>;
  details?: Record<string, JsonValue>;
  status: z.infer<typeof componentStatusSchema>;
}

export interface InstallationHealthStatus {
  checkedAt: string;
  components: {
    componentId: string;
    componentType: z.infer<typeof componentTypeSchema>;
    details: Record<string, JsonValue>;
    heartbeatAt: string | null;
    stale: boolean;
    status: z.infer<typeof componentStatusSchema>;
  }[];
  database: { status: "ready" };
  localAiRequired: boolean;
  queue: {
    active: number;
    failed: number;
    oldestPendingAt: string | null;
    scheduled: number;
  };
}

export class PostgresInstallationHealthStore {
  readonly #database: PostgresExecutor;
  readonly #now: () => Date;

  public constructor(database: PostgresExecutor, now: () => Date = () => new Date()) {
    this.#database = database;
    this.#now = now;
  }

  public async writeHeartbeat(input: ComponentHeartbeatInput): Promise<void> {
    const details = safeDetailsSchema.parse(input.details ?? {});
    await this.#database.query(
      `INSERT INTO runtime_component_heartbeats (
         component_id, component_type, status, details, heartbeat_at
       ) VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (component_id) DO UPDATE SET
         component_type = EXCLUDED.component_type,
         status = EXCLUDED.status,
         details = EXCLUDED.details,
         heartbeat_at = EXCLUDED.heartbeat_at,
         updated_at = now()`,
      [
        identifierSchema.parse(input.componentId),
        componentTypeSchema.parse(input.componentType),
        componentStatusSchema.parse(input.status),
        JSON.stringify(details),
        this.#now().toISOString(),
      ],
    );
  }

  public async getStatus(): Promise<InstallationHealthStatus> {
    const [queueResult, heartbeatResult, localProfiles] = await Promise.all([
      this.#database.query(
        `SELECT
           count(*) FILTER (WHERE status = 'scheduled')::int AS scheduled,
           count(*) FILTER (WHERE status = 'active')::int AS active,
           count(*) FILTER (WHERE status = 'failed')::int AS failed,
           min(available_at) FILTER (WHERE status IN ('scheduled', 'active')) AS oldest_pending_at
         FROM processing_jobs`,
      ),
      this.#database.query(
        `SELECT component_id, component_type, status, details, heartbeat_at
         FROM runtime_component_heartbeats ORDER BY component_type, component_id`,
      ),
      this.#database.query(
        `SELECT EXISTS(
           SELECT 1 FROM guild_configurations guild
           JOIN ai_profiles profile ON profile.profile_id = guild.active_ai_profile_id
           WHERE profile.transcription->>'provider' = 'faster-whisper'
             OR profile.refinement->>'provider' = 'ollama'
             OR profile.summary->>'provider' = 'ollama'
         ) AS local_profiles_active`,
      ),
    ]);
    const now = this.#now();
    const queue = z
      .object({
        active: z.coerce.number().int().nonnegative(),
        failed: z.coerce.number().int().nonnegative(),
        oldest_pending_at: z.union([z.string(), z.date()]).nullable(),
        scheduled: z.coerce.number().int().nonnegative(),
      })
      .parse(queueResult.rows[0]);
    const localAiRequired = z
      .object({ local_profiles_active: z.boolean() })
      .parse(localProfiles.rows[0]).local_profiles_active;
    const components: InstallationHealthStatus["components"] = heartbeatResult.rows.map((input) => {
      const row = z
        .object({
          component_id: identifierSchema,
          component_type: componentTypeSchema,
          details: safeDetailsSchema,
          heartbeat_at: z.union([z.string(), z.date()]),
          status: componentStatusSchema,
        })
        .parse(input);
      const heartbeatAt = new Date(row.heartbeat_at);
      const stale = now.getTime() - heartbeatAt.getTime() > 45_000;
      return {
        componentId: row.component_id,
        componentType: row.component_type,
        details: row.details,
        heartbeatAt: heartbeatAt.toISOString(),
        stale,
        status: stale ? ("unavailable" as const) : row.status,
      };
    });
    const expectedTypes: ComponentHeartbeatInput["componentType"][] = [
      "bot",
      "ffmpeg",
      "worker",
      ...(localAiRequired ? (["ollama", "faster_whisper"] as const) : []),
    ];
    for (const componentType of expectedTypes) {
      if (components.some((component) => component.componentType === componentType)) continue;
      components.push({
        componentId: `${componentType}-main`,
        componentType,
        details: {},
        heartbeatAt: null,
        stale: true,
        status: "unavailable",
      });
    }
    return {
      checkedAt: now.toISOString(),
      components,
      database: { status: "ready" },
      localAiRequired,
      queue: {
        active: queue.active,
        failed: queue.failed,
        oldestPendingAt:
          queue.oldest_pending_at === null ? null : new Date(queue.oldest_pending_at).toISOString(),
        scheduled: queue.scheduled,
      },
    };
  }
}
