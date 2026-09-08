import { z } from "zod";

export const summaryTranscriptEntrySchema = z.object({
  endedAtMs: z.number().int().positive(),
  id: z.string().min(1),
  speaker: z.string().trim().min(1),
  startedAtMs: z.number().int().nonnegative(),
  spokenAt: z
    .object({
      instant: z.iso.datetime(),
      timeZone: z.string().trim().min(1).max(100),
    })
    .optional(),
  text: z.string().trim().min(1),
});
export type SummaryTranscriptEntry = z.infer<typeof summaryTranscriptEntrySchema>;

const groundedItemSchema = z.object({
  sourceEntryIds: z.array(z.string().min(1)).min(1),
  text: z.string().trim().min(1),
});

const normalizedDeadlineShape = {
  deadlineDate: z.iso.date().optional(),
  deadlinePrecision: z.enum(["date", "minute"]).optional(),
  deadlineText: z.string().trim().min(1).optional(),
  deadlineTime: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  deadlineTimeZone: z.string().trim().min(1).max(100).optional(),
};

const groundedTaskSchema = groundedItemSchema
  .extend({
    ...normalizedDeadlineShape,
    ownerName: z.string().trim().min(1).optional(),
  })
  .superRefine(validateNormalizedDeadline);

export const artifactLabelsSchema = z.object({
  assignee: z.string().trim().min(1),
  deadline: z.string().trim().min(1),
  decisions: z.string().trim().min(1),
  discussedTopics: z.string().trim().min(1),
  executiveSummary: z.string().trim().min(1),
  fullTranscript: z.string().trim().min(1),
  meetingId: z.string().trim().min(1),
  observations: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  tasks: z.string().trim().min(1),
  transcript: z.string().trim().min(1),
});
export const artifactLabelsJsonSchema = {
  additionalProperties: false,
  properties: {
    assignee: { minLength: 1, type: "string" },
    deadline: { minLength: 1, type: "string" },
    decisions: { minLength: 1, type: "string" },
    discussedTopics: { minLength: 1, type: "string" },
    executiveSummary: { minLength: 1, type: "string" },
    fullTranscript: { minLength: 1, type: "string" },
    meetingId: { minLength: 1, type: "string" },
    observations: { minLength: 1, type: "string" },
    summary: { minLength: 1, type: "string" },
    tasks: { minLength: 1, type: "string" },
    transcript: { minLength: 1, type: "string" },
  },
  required: [
    "assignee",
    "deadline",
    "decisions",
    "discussedTopics",
    "executiveSummary",
    "fullTranscript",
    "meetingId",
    "observations",
    "summary",
    "tasks",
    "transcript",
  ],
  type: "object",
} as const;

export const summaryDraftSchema = z.object({
  decisions: z.array(groundedItemSchema),
  discussedTopics: z.array(z.string().trim().min(1)),
  executiveSummary: z.string().trim().min(1),
  labels: artifactLabelsSchema.optional(),
  observations: z.array(z.string().trim().min(1)),
  protectedTerms: z.array(z.string().trim().min(1)).optional(),
  tasks: z.array(groundedTaskSchema),
});
export type SummaryDraft = z.infer<typeof summaryDraftSchema>;
export const generatedSummaryDraftSchema = summaryDraftSchema.extend({
  labels: artifactLabelsSchema,
  protectedTerms: z.array(z.string().trim().min(1)),
});

export const publicSummarySchema = z.object({
  decisions: z.array(z.string().trim().min(1)),
  discussedTopics: z.array(z.string().trim().min(1)),
  executiveSummary: z.string().trim().min(1),
  labels: artifactLabelsSchema.optional(),
  observations: z.array(z.string().trim().min(1)),
  tasks: z.array(
    z
      .object({
        ...normalizedDeadlineShape,
        ownerName: z.string().trim().min(1).optional(),
        text: z.string().trim().min(1),
      })
      .superRefine(validateNormalizedDeadline),
  ),
});
export type PublicSummary = z.infer<typeof publicSummarySchema>;
export const translatedPublicSummarySchema = publicSummarySchema.extend({
  labels: artifactLabelsSchema,
});
export type PublicSummaryTask = PublicSummary["tasks"][number];

export function validateGroundedSummary(
  input: SummaryDraft,
  transcript: readonly SummaryTranscriptEntry[],
): SummaryDraft {
  const draft = summaryDraftSchema.parse(input);
  const entriesById = new Map(
    transcript.map((entry) => {
      const validated = summaryTranscriptEntrySchema.parse(entry);
      return [validated.id, validated] as const;
    }),
  );

  const decisions = draft.decisions.flatMap((decision) => {
    const sourceEntryIds = validSourceIds(decision.sourceEntryIds, entriesById);
    return sourceEntryIds.length === 0 ? [] : [{ ...decision, sourceEntryIds }];
  });
  const tasks = draft.tasks.flatMap((task) => {
    const sourceEntryIds = validSourceIds(task.sourceEntryIds, entriesById);
    if (sourceEntryIds.length === 0) {
      return [];
    }
    const sourceText = sourceEntryIds
      .map((entryId) => entriesById.get(entryId)?.text ?? "")
      .join("\n");
    const hasGroundedDeadline =
      task.deadlineText !== undefined && sourceText.includes(task.deadlineText);
    const hasGroundedDeadlineNormalization =
      task.deadlineTimeZone !== undefined &&
      sourceEntryIds.some(
        (entryId) => entriesById.get(entryId)?.spokenAt?.timeZone === task.deadlineTimeZone,
      );
    return [
      {
        ...(hasGroundedDeadline
          ? {
              deadlineText: task.deadlineText,
              ...(hasGroundedDeadlineNormalization
                ? {
                    deadlineDate: task.deadlineDate,
                    deadlinePrecision: task.deadlinePrecision,
                    ...(task.deadlineTime === undefined ? {} : { deadlineTime: task.deadlineTime }),
                    deadlineTimeZone: task.deadlineTimeZone,
                  }
                : {}),
            }
          : {}),
        ...(task.ownerName !== undefined && sourceText.includes(task.ownerName)
          ? { ownerName: task.ownerName }
          : {}),
        sourceEntryIds,
        text: task.text,
      },
    ];
  });

  const transcriptText = [...entriesById.values()].map((entry) => entry.text).join("\n");
  const protectedTerms = [...new Set(draft.protectedTerms ?? [])].filter((term) =>
    transcriptText.includes(term),
  );

  return summaryDraftSchema.parse({
    ...draft,
    decisions,
    ...(draft.protectedTerms === undefined && protectedTerms.length === 0
      ? {}
      : { protectedTerms }),
    tasks,
  });
}

export function createPublicSummary(summary: SummaryDraft): PublicSummary {
  const validated = summaryDraftSchema.parse(summary);
  return publicSummarySchema.parse({
    decisions: validated.decisions.map((decision) => decision.text),
    discussedTopics: [...validated.discussedTopics],
    executiveSummary: validated.executiveSummary,
    ...(validated.labels === undefined ? {} : { labels: validated.labels }),
    observations: [...validated.observations],
    tasks: validated.tasks.map((task) => ({
      ...(task.deadlineDate === undefined ? {} : { deadlineDate: task.deadlineDate }),
      ...(task.deadlinePrecision === undefined
        ? {}
        : { deadlinePrecision: task.deadlinePrecision }),
      ...(task.deadlineText === undefined ? {} : { deadlineText: task.deadlineText }),
      ...(task.deadlineTime === undefined ? {} : { deadlineTime: task.deadlineTime }),
      ...(task.deadlineTimeZone === undefined ? {} : { deadlineTimeZone: task.deadlineTimeZone }),
      ...(task.ownerName === undefined ? {} : { ownerName: task.ownerName }),
      text: task.text,
    })),
  });
}

function validateNormalizedDeadline(
  task: {
    deadlineDate?: string | undefined;
    deadlinePrecision?: "date" | "minute" | undefined;
    deadlineText?: string | undefined;
    deadlineTime?: string | undefined;
    deadlineTimeZone?: string | undefined;
  },
  context: z.RefinementCtx,
): void {
  const normalizedFields = [
    task.deadlineDate,
    task.deadlinePrecision,
    task.deadlineTime,
    task.deadlineTimeZone,
  ];
  if (normalizedFields.every((value) => value === undefined)) return;
  const valid =
    task.deadlineText !== undefined &&
    task.deadlineDate !== undefined &&
    task.deadlinePrecision !== undefined &&
    task.deadlineTimeZone !== undefined &&
    (task.deadlinePrecision === "minute"
      ? task.deadlineTime !== undefined
      : task.deadlineTime === undefined);
  if (!valid) {
    context.addIssue({
      code: "custom",
      message: "Normalized deadline fields must form a complete date or minute deadline",
      path: ["deadlineDate"],
    });
  }
}

function validSourceIds(
  sourceEntryIds: readonly string[],
  entriesById: ReadonlyMap<string, SummaryTranscriptEntry>,
): string[] {
  return [...new Set(sourceEntryIds)].filter((entryId) => entriesById.has(entryId));
}
