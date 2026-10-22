import { artifactLabelsJsonSchema } from "summyz-community-shared/summary/summary-result";

const generatedTaskDeadlineJsonSchema = {
  properties: {
    deadlineDate: { format: "date", type: ["string", "null"] },
    deadlinePrecision: { enum: ["date", "minute", null], type: ["string", "null"] },
    deadlineText: {
      description:
        "Exact deadline wording from the supporting entry; null only when no deadline was stated.",
      minLength: 1,
      type: ["string", "null"],
    },
    deadlineTime: { pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$", type: ["string", "null"] },
    deadlineTimeZone: { minLength: 1, type: ["string", "null"] },
  },
  required: [
    "deadlineDate",
    "deadlinePrecision",
    "deadlineText",
    "deadlineTime",
    "deadlineTimeZone",
  ],
} as const;

export const generatedSummaryDraftJsonSchema = {
  additionalProperties: false,
  properties: {
    decisions: { items: { $ref: "#/$defs/groundedItem" }, type: "array" },
    discussedTopics: { items: { minLength: 1, type: "string" }, type: "array" },
    executiveSummary: { minLength: 1, type: "string" },
    labels: artifactLabelsJsonSchema,
    observations: { items: { minLength: 1, type: "string" }, type: "array" },
    tasks: {
      items: {
        additionalProperties: false,
        properties: {
          ...generatedTaskDeadlineJsonSchema.properties,
          ownerNames: { items: { minLength: 1, type: "string" }, type: "array" },
          sourceEntryIds: {
            items: { minLength: 1, type: "string" },
            minItems: 1,
            type: "array",
          },
          text: { minLength: 1, type: "string" },
        },
        required: [
          "ownerNames",
          "sourceEntryIds",
          "text",
          ...generatedTaskDeadlineJsonSchema.required,
        ],
        type: "object",
      },
      type: "array",
    },
  },
  required: ["decisions", "discussedTopics", "executiveSummary", "labels", "observations", "tasks"],
  type: "object",
  $defs: {
    groundedItem: {
      additionalProperties: false,
      properties: {
        sourceEntryIds: {
          items: { minLength: 1, type: "string" },
          minItems: 1,
          type: "array",
        },
        text: { minLength: 1, type: "string" },
      },
      required: ["sourceEntryIds", "text"],
      type: "object",
    },
  },
} as const;
