import { describe, expect, it } from "vitest";

import {
  createPostTitle,
  formatSummary,
  resolvePublicationText,
} from "../src/discord/discord-meeting-presentation.js";

describe("Discord meeting presentation", () => {
  it("formats the localized post title and summary sections", () => {
    const text = resolvePublicationText("en");

    expect(createPostTitle("2026-08-17T15:30:00.000Z", "Lobby", "summary", "UTC", "en", text)).toBe(
      "Summary — 08/17/2026 15:30 — Lobby",
    );
    expect(
      formatSummary(
        "meeting-1",
        {
          decisions: ["Adopt the plan."],
          discussedTopics: ["The plan"],
          executiveSummary: "The team agreed.",
          observations: ["Review next week."],
          tasks: [{ text: "Send the file.", ownerName: "Ana", deadlineText: "Friday" }],
        },
        text,
      ).join("\n"),
    ).toContain("Assignee: Ana · Deadline: Friday");
  });
});
