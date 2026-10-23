import { z } from "zod";

const basePublicationStateSchema = z.object({
  createdAt: z.iso.datetime(),
  failureNotifiedAt: z.iso.datetime().optional(),
  meetingId: z.string().min(1),
  mode: z.enum(["summary", "transcript_only"]),
  schemaVersion: z.literal(1),
  summaryMessageIds: z.array(z.string().min(1)),
  updatedAt: z.iso.datetime(),
});

const publishingPublicationStateSchema = basePublicationStateSchema.extend({
  rootMessageId: z.string().min(1).optional(),
  status: z.literal("publishing"),
  threadId: z.string().min(1).optional(),
  transcriptMessageId: z.string().min(1).optional(),
});

const completedPublicationStateSchema = basePublicationStateSchema.extend({
  completedAt: z.iso.datetime(),
  rootMessageId: z.string().min(1),
  status: z.literal("completed"),
  threadId: z.string().min(1),
  transcriptMessageId: z.string().min(1),
});

export const publicationStateSchema = z.discriminatedUnion("status", [
  publishingPublicationStateSchema,
  completedPublicationStateSchema,
]);
export type PublicationState = z.infer<typeof publicationStateSchema>;

export function createPublicationState(
  meetingId: string,
  mode: PublicationState["mode"],
  now: string,
): PublicationState {
  return publicationStateSchema.parse({
    createdAt: now,
    meetingId,
    mode,
    schemaVersion: 1,
    status: "publishing",
    summaryMessageIds: [],
    updatedAt: now,
  });
}
