import { z } from "zod";

import { recordingManifestSchema } from "../recording/manifest.js";
import { publicationStateSchema } from "../summary/publication-state.js";
import type { PostgresExecutor } from "./postgres-database.js";

const contentInputSchema = z.object({
  manifest: recordingManifestSchema,
  meetingId: z.string().min(1).max(128),
  publication: publicationStateSchema,
  rawTranscript: z.string(),
  summary: z.unknown(),
  transcript: z.string(),
});

export interface MeetingContentInput {
  manifest: z.infer<typeof recordingManifestSchema>;
  meetingId: string;
  publication: z.infer<typeof publicationStateSchema>;
  rawTranscript: string;
  summary: unknown;
  transcript: string;
}

export class PostgresMeetingContentStore {
  readonly #database: PostgresExecutor;

  public constructor(database: PostgresExecutor) {
    this.#database = database;
  }

  public async persist(input: MeetingContentInput): Promise<boolean> {
    const validated = contentInputSchema.parse(input);
    const serializedSummary = serializeJson(validated.summary);
    const serializedPublication = serializeJson(validated.publication);
    const serializedManifest = serializeJson(validated.manifest);
    await this.#database.query(
      `
INSERT INTO meeting_contents (
  meeting_id, raw_transcript, transcript, summary, publication, meeting_manifest
) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)
ON CONFLICT (meeting_id) DO UPDATE SET
  raw_transcript = EXCLUDED.raw_transcript,
  transcript = EXCLUDED.transcript,
  summary = EXCLUDED.summary,
  publication = EXCLUDED.publication,
  meeting_manifest = EXCLUDED.meeting_manifest,
  persisted_at = now()
`,
      [
        validated.meetingId,
        validated.rawTranscript,
        validated.transcript,
        serializedSummary,
        serializedPublication,
        serializedManifest,
      ],
    );
    return true;
  }
}

function serializeJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("O resumo não pode ser serializado como JSON");
  }
  return serialized;
}
