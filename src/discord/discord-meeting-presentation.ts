import type { AppConfig } from "../config.js";
import type { PublicationState } from "../summary/publication-state.js";
import type { PublicSummary } from "../summary/summary-result.js";

export interface PublicationText {
  assignee: string;
  auditReason: string;
  deadline: string;
  decisions: string;
  defaultVoiceChannel: string;
  discussedTopics: string;
  executiveSummary: string;
  failureMessage: string;
  fullTranscript: string;
  meetingId: string;
  openIssues: string;
  summary: string;
  summaryUnavailable: string;
  tasks: string;
  transcript: string;
}

export const publicationTexts = {
  en: {
    assignee: "Assignee",
    auditReason: "Publishing result for meeting",
    deadline: "Deadline",
    decisions: "Decisions",
    defaultVoiceChannel: "Voice channel",
    discussedTopics: "Discussed topics",
    executiveSummary: "Executive summary",
    failureMessage: "⚠️ Unable to publish the summary and transcript to the configured channel.",
    fullTranscript: "📎 Full voice call transcript:",
    meetingId: "Meeting ID",
    openIssues: "Open issues and notes",
    summary: "Summary",
    summaryUnavailable:
      "The summary could not be generated after the configured attempts. " +
      "The summary is unavailable, but the full transcript is attached.",
    tasks: "Tasks",
    transcript: "Transcript",
  },
  "pt-BR": {
    assignee: "Responsável",
    auditReason: "Publicação do resultado da reunião",
    deadline: "Prazo",
    decisions: "Decisões",
    defaultVoiceChannel: "Canal de voz",
    discussedTopics: "Tópicos discutidos",
    executiveSummary: "Resumo executivo",
    failureMessage: "⚠️ Não foi possível publicar o resumo e a transcrição no canal configurado.",
    fullTranscript: "📎 Transcrição completa da call:",
    meetingId: "ID da reunião",
    openIssues: "Pendências e observações",
    summary: "Resumo",
    summaryUnavailable:
      "Não foi possível gerar o resumo após as tentativas configuradas. " +
      "O resumo está indisponível, mas a transcrição completa está anexada.",
    tasks: "Tarefas",
    transcript: "Transcrição",
  },
} as const satisfies Record<AppConfig["botLanguage"], PublicationText>;

export const resolvePublicationText = (
  language: AppConfig["botLanguage"],
  summary?: PublicSummary,
): PublicationText => ({
  ...publicationTexts[language],
  ...(summary?.labels === undefined
    ? {}
    : {
        assignee: summary.labels.assignee,
        deadline: summary.labels.deadline,
        decisions: summary.labels.decisions,
        discussedTopics: summary.labels.discussedTopics,
        executiveSummary: summary.labels.executiveSummary,
        fullTranscript: summary.labels.fullTranscript,
        meetingId: summary.labels.meetingId,
        openIssues: summary.labels.observations,
        summary: summary.labels.summary,
        tasks: summary.labels.tasks,
        transcript: summary.labels.transcript,
      }),
});

export function createPostTitle(
  startedAt: string,
  voiceChannelName: string,
  mode: PublicationState["mode"],
  timeZone: string,
  language: AppConfig["botLanguage"],
  text: PublicationText,
): string {
  const parts = new Intl.DateTimeFormat(language === "en" ? "en-US" : "pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date(startedAt));
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  const date =
    language === "en"
      ? `${value("month")}/${value("day")}/${value("year")}`
      : `${value("day")}/${value("month")}/${value("year")}`;
  const prefix = mode === "summary" ? text.summary : text.transcript;
  return `${prefix} — ${date} ${value("hour")}:${value("minute")} — ${voiceChannelName}`.slice(
    0,
    100,
  );
}

export function formatSummary(
  meetingId: string,
  summary: PublicSummary,
  text: PublicationText,
): string[] {
  const sections = [
    `${text.meetingId}: \`${meetingId}\`\n\n## ${text.executiveSummary}\n${summary.executiveSummary}`,
  ];
  appendList(sections, text.discussedTopics, summary.discussedTopics);
  appendList(sections, text.decisions, summary.decisions);
  if (summary.tasks.length > 0) {
    sections.push(
      `## ${text.tasks}\n${summary.tasks
        .map((task) => {
          const details = [
            task.ownerName === undefined ? undefined : `${text.assignee}: ${task.ownerName}`,
            task.deadlineText === undefined ? undefined : `${text.deadline}: ${task.deadlineText}`,
          ].filter((item): item is string => item !== undefined);
          return `- ${task.text}${details.length === 0 ? "" : `\n  ${details.join(" · ")}`}`;
        })
        .join("\n")}`,
    );
  }
  appendList(sections, text.openIssues, summary.observations);
  return sections.flatMap((section) => splitDiscordContent(section, 1_900));
}

function appendList(sections: string[], title: string, items: readonly string[]): void {
  if (items.length > 0) {
    sections.push(`## ${title}\n${items.map((item) => `- ${item}`).join("\n")}`);
  }
}

function splitDiscordContent(content: string, maximumLength: number): string[] {
  const chunks: string[] = [];
  let remaining = content;
  while (remaining.length > maximumLength) {
    const candidate = remaining.slice(0, maximumLength);
    const boundary = Math.max(candidate.lastIndexOf("\n\n"), candidate.lastIndexOf("\n"));
    const end = boundary > 0 ? boundary : maximumLength;
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end).trimStart();
  }
  if (remaining.length > 0) {
    chunks.push(remaining);
  }
  return chunks;
}
