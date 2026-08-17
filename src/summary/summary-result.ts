import { z } from "zod";

export const summaryTranscriptEntrySchema = z.object({
  endedAtMs: z.number().int().positive(),
  id: z.string().min(1),
  speaker: z.string().trim().min(1),
  startedAtMs: z.number().int().nonnegative(),
  text: z.string().trim().min(1),
});
export type SummaryTranscriptEntry = z.infer<typeof summaryTranscriptEntrySchema>;

const groundedItemSchema = z.object({
  sourceEntryIds: z.array(z.string().min(1)).min(1),
  text: z.string().trim().min(1),
});

const groundedTaskSchema = groundedItemSchema.extend({
  deadlineText: z.string().trim().min(1).optional(),
  ownerName: z.string().trim().min(1).optional(),
});

export const summaryDraftSchema = z.object({
  decisions: z.array(groundedItemSchema),
  discussedTopics: z.array(z.string().trim().min(1)),
  executiveSummary: z.string().trim().min(1),
  observations: z.array(z.string().trim().min(1)),
  tasks: z.array(groundedTaskSchema),
});
export type SummaryDraft = z.infer<typeof summaryDraftSchema>;

export interface PublicSummaryTask {
  deadlineText?: string;
  ownerName?: string;
  text: string;
}

export interface PublicSummary {
  decisions: string[];
  discussedTopics: string[];
  executiveSummary: string;
  observations: string[];
  tasks: PublicSummaryTask[];
}

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
    return [
      {
        ...(task.deadlineText !== undefined && sourceText.includes(task.deadlineText)
          ? { deadlineText: task.deadlineText }
          : {}),
        ...(task.ownerName !== undefined && sourceText.includes(task.ownerName)
          ? { ownerName: task.ownerName }
          : {}),
        sourceEntryIds,
        text: task.text,
      },
    ];
  });

  return summaryDraftSchema.parse({ ...draft, decisions, tasks });
}

export function createPublicSummary(summary: SummaryDraft): PublicSummary {
  const validated = summaryDraftSchema.parse(summary);
  return {
    decisions: validated.decisions.map((decision) => decision.text),
    discussedTopics: [...validated.discussedTopics],
    executiveSummary: validated.executiveSummary,
    observations: [...validated.observations],
    tasks: validated.tasks.map((task) => ({
      ...(task.deadlineText === undefined ? {} : { deadlineText: task.deadlineText }),
      ...(task.ownerName === undefined ? {} : { ownerName: task.ownerName }),
      text: task.text,
    })),
  };
}

function validSourceIds(
  sourceEntryIds: readonly string[],
  entriesById: ReadonlyMap<string, SummaryTranscriptEntry>,
): string[] {
  return [...new Set(sourceEntryIds)].filter((entryId) => entriesById.has(entryId));
}
