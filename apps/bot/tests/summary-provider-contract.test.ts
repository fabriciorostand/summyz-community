import { generatedSummaryDraftSchema } from "summyz-community-shared/summary/summary-result";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OllamaSummaryProvider } from "../src/summary/ollama-summary-provider.js";
import { OpenRouterSummaryProvider } from "../src/summary/openrouter-summary-provider.js";

const summary = {
  decisions: [],
  discussedTopics: [],
  executiveSummary: "Planejamento",
  observations: [],
  labels: {
    assignee: "Responsável",
    assignees: "Responsáveis",
    deadline: "Prazo",
    decisions: "Decisões",
    discussedTopics: "Tópicos",
    executiveSummary: "Resumo executivo",
    meetingId: "ID",
    observations: "Observações",
    summary: "Resumo",
    tasks: "Tarefas",
    transcript: "Transcrição",
  },
  tasks: [
    { text: "Revisar juntos", ownerNames: ["Carla", "Diego"], sourceEntryIds: ["carla", "diego"] },
  ],
};
const entries = [
  { id: "carla", speaker: "Carla", text: "Eu reviso o layout.", startedAtMs: 0, endedAtMs: 1000 },
  {
    id: "diego",
    speaker: "Diego",
    text: "Eu reviso com você.",
    startedAtMs: 1000,
    endedAtMs: 2000,
  },
];

it("accepts explicit null deadline fields from the model without persisting invented metadata", () => {
  const parsed = generatedSummaryDraftSchema.parse({
    ...summary,
    tasks: [
      {
        ...summary.tasks[0],
        deadlineDate: null,
        deadlinePrecision: null,
        deadlineText: null,
        deadlineTime: null,
        deadlineTimeZone: null,
      },
    ],
  });
  expect(parsed.tasks).toEqual(summary.tasks);
});

it("preserves normalized dates while discarding an absent time", () => {
  const task = {
    ...summary.tasks[0],
    deadlineDate: "2026-10-19",
    deadlinePrecision: "date",
    deadlineText: "amanhã",
    deadlineTime: null,
    deadlineTimeZone: "America/Sao_Paulo",
  };
  const parsed = generatedSummaryDraftSchema.parse({ ...summary, tasks: [task] });
  const { deadlineTime: _absentTime, ...expected } = task;
  expect(parsed.tasks).toEqual([expected]);
});

it.each([
  null,
  "task",
  { ...summary.tasks[0], ownerNames: null },
  {
    ...summary.tasks[0],
    deadlineDate: "2026-10-19",
    deadlineText: null,
  },
])("rejects invalid tasks and incomplete deadlines without repairing evidence", (task) => {
  expect(generatedSummaryDraftSchema.safeParse({ ...summary, tasks: [task] }).success).toBe(false);
});

describe.each(["openrouter", "ollama"] as const)(
  "contrato de atribuições de %s",
  (providerName) => {
    it.each([
      ["pt-BR", undefined],
      ["en", undefined],
      ["auto", undefined],
      ["pt-BR", "List owners and deadlines in executiveSummary."],
      ["pt-BR", null],
    ] as const)(
      "keeps executive style editable with language %s and prompt %s",
      async (language, prompt) => {
        const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
          Response.json({
            choices: [{ message: { content: JSON.stringify(summary) } }],
            message: { content: JSON.stringify(summary) },
          }),
        );
        const options = {
          fetch,
          language,
          model: "model",
          timeoutMs: 1000,
          ...(prompt === undefined
            ? {}
            : { extractionPrompt: prompt, consolidationPrompt: prompt }),
        };
        const provider =
          providerName === "ollama"
            ? new OllamaSummaryProvider(options)
            : new OpenRouterSummaryProvider({
                ...options,
                apiKey: "test-secret",
                maxAttempts: 1,
                retryBaseMs: 1,
                retryMaxMs: 1,
              });
        expect((await provider.summarize(entries)).summary).toEqual(summary);
        expect((await provider.consolidate([summary], entries)).summary).toEqual(summary);
        for (const call of fetch.mock.calls) {
          const request = z
            .object({ messages: z.array(z.object({ content: z.string() })).min(1) })
            .parse(JSON.parse(String(call[1].body)));
          const instruction = request.messages[0]?.content;
          if (prompt === undefined) {
            expect(instruction).toContain("For executiveSummary only");
            expect(instruction).toContain("one short paragraph");
            expect(instruction).toContain("length proportional to the conversation");
            expect(instruction).toContain(
              "instead of listing individual assignments and deadlines",
            );
            expect(instruction).toContain("names and dates only when essential");
          } else {
            expect(instruction).not.toContain("For executiveSummary only");
            if (prompt === null) expect(instruction).not.toContain("<editable-profile-prompt>");
            else expect(instruction).toContain(prompt);
          }
          expect(instruction).toContain("Return every identified assignee in ownerNames");
          expect(instruction).toContain("Keep deadlineText exactly as spoken");
          expect(instruction).not.toContain("test-secret");
        }
      },
    );

    it("usa o novo contrato na extração e leva a conversa completa à consolidação", async () => {
      const datedEntries = entries.map((entry) => ({
        ...entry,
        spokenAt: { instant: "2026-10-18T17:41:46.000Z", timeZone: "America/Sao_Paulo" },
      }));
      const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
        Response.json({
          choices: [{ message: { content: JSON.stringify(summary) } }],
          message: { content: JSON.stringify(summary) },
        }),
      );
      const provider =
        providerName === "ollama"
          ? new OllamaSummaryProvider({ fetch, language: "pt-BR", model: "model", timeoutMs: 1000 })
          : new OpenRouterSummaryProvider({
              fetch,
              apiKey: "test-secret",
              language: "pt-BR",
              model: "model",
              timeoutMs: 1000,
              maxAttempts: 1,
              retryBaseMs: 1,
              retryMaxMs: 1,
            });
      expect((await provider.summarize(datedEntries)).summary.tasks).toEqual(summary.tasks);
      expect((await provider.consolidate([summary], datedEntries)).summary.tasks).toEqual(
        summary.tasks,
      );
      const requestSchema = z.object({ messages: z.array(z.object({ content: z.string() })) });
      const extraction = requestSchema.parse(JSON.parse(String(fetch.mock.calls[0]?.[1].body)));
      const consolidation = requestSchema.parse(JSON.parse(String(fetch.mock.calls[1]?.[1].body)));
      const consolidationInput: unknown = JSON.parse(consolidation.messages[1]?.content ?? "null");
      expect(consolidationInput).toMatchObject({
        partialSummaries: [summary],
        transcriptEntries: datedEntries,
        calendarReferences: [
          {
            referenceDate: "2026-10-18",
            timeZone: "America/Sao_Paulo",
            sourceEntryIds: ["carla", "diego"],
            dates: expect.arrayContaining([{ date: "2026-10-21", weekday: "Wednesday" }]),
          },
        ],
      });
      const calendarInputSchema = z.object({ calendarReferences: z.array(z.unknown()) });
      expect(
        calendarInputSchema.parse(JSON.parse(extraction.messages[1]?.content ?? "null")),
      ).toEqual(calendarInputSchema.parse(consolidationInput));
      expect(extraction.messages[0]?.content).toContain("first-person commitments");
      if (providerName === "ollama") {
        expect(extraction.messages[0]?.content).toContain('"deadlineTimeZone"');
        expect(extraction.messages[0]?.content).toContain('"required"');
      }
      expect(consolidation.messages[0]?.content).toContain("provided transcriptEntries");
      expect(String(fetch.mock.calls[0]?.[1].body)).toContain('"ownerNames"');
      for (const call of fetch.mock.calls) {
        expect(String(call[1].body)).not.toContain('"fullTranscript"');
        const request = z
          .object({
            format: z.unknown().optional(),
            response_format: z
              .object({ json_schema: z.object({ schema: z.unknown() }) })
              .optional(),
          })
          .parse(JSON.parse(String(call[1].body)));
        const wireSchema = z
          .object({
            properties: z.object({
              tasks: z.object({
                items: z.object({
                  required: z.array(z.string()),
                  properties: z.record(z.string(), z.unknown()),
                }),
              }),
            }),
          })
          .parse(request.format ?? request.response_format?.json_schema.schema);
        const taskSchema = wireSchema.properties.tasks.items;
        for (const field of [
          "deadlineDate",
          "deadlinePrecision",
          "deadlineText",
          "deadlineTime",
          "deadlineTimeZone",
        ]) {
          expect(taskSchema.required).toContain(field);
          expect(taskSchema.properties[field]).toMatchObject({ type: ["string", "null"] });
        }
      }
    });
  },
);
