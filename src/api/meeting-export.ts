import type { MeetingHistorySummary } from "../analytics/meeting-history-summary.js";
import type { MeetingHistoryDetail } from "../database/postgres-analytics-store.js";
import { formatClockDuration } from "../duration-format.js";

export class MeetingExportUnavailableError extends Error {
  public constructor() {
    super("meeting_export_unavailable");
    this.name = "MeetingExportUnavailableError";
  }
}

export function createMeetingTextExport(meeting: MeetingHistoryDetail, timeZone: string): string {
  if (
    meeting.summary === null ||
    meeting.summary.status !== "completed" ||
    meeting.transcript === null
  ) {
    throw new MeetingExportUnavailableError();
  }
  const summary = meeting.summary;
  const labels = summary.labels ?? fallbackLabels(summary.language);
  const lines = [
    `Voice channel: ${meeting.voiceChannelName ?? "-"}`,
    `Started at: ${formatStartedAt(meeting.startedAt, summary.language, timeZone)}`,
    `Duration: ${meeting.durationMs === null ? "-" : formatClockDuration(meeting.durationMs)}`,
    `${labels.meetingId}: ${meeting.meetingId}`,
    "",
    labels.summary,
    "",
    labels.executiveSummary,
    summary.executiveSummary,
    "",
    labels.decisions,
    ...formatList(summary.decisions),
    "",
    labels.discussedTopics,
    ...formatList(summary.discussedTopics),
    "",
    labels.tasks,
    ...formatTasks(summary),
    "",
    labels.observations,
    ...formatList(summary.observations),
    "",
    labels.transcript,
    meeting.transcript,
    "",
  ];
  return lines.join("\n");
}

function formatStartedAt(value: string, language: string, timeZone: string): string {
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

function formatList(items: readonly string[]): string[] {
  return items.length === 0 ? ["-"] : items.map((item) => `- ${item}`);
}

function formatTasks(summary: Extract<MeetingHistorySummary, { status: "completed" }>): string[] {
  if (summary.tasks.length === 0) return ["-"];
  const labels = summary.labels ?? fallbackLabels(summary.language);
  return summary.tasks.map((task) => {
    const metadata = [
      task.ownerName === undefined ? undefined : `${labels.assignee}: ${task.ownerName}`,
      task.deadlineText === undefined ? undefined : `${labels.deadline}: ${task.deadlineText}`,
    ].filter((value): value is string => value !== undefined);
    return `- ${task.text}${metadata.length === 0 ? "" : ` (${metadata.join("; ")})`}`;
  });
}

function fallbackLabels(language: string) {
  const portuguese = language.toLowerCase().startsWith("pt");
  return portuguese
    ? {
        assignee: "Responsável",
        deadline: "Prazo",
        decisions: "Decisões",
        discussedTopics: "Tópicos discutidos",
        executiveSummary: "Resumo executivo",
        meetingId: "ID da reunião",
        observations: "Pendências e observações",
        summary: "Resumo",
        tasks: "Tarefas",
        transcript: "Transcrição",
      }
    : {
        assignee: "Assignee",
        deadline: "Deadline",
        decisions: "Decisions",
        discussedTopics: "Discussed topics",
        executiveSummary: "Executive summary",
        meetingId: "Meeting ID",
        observations: "Open issues and notes",
        summary: "Summary",
        tasks: "Tasks",
        transcript: "Transcript",
      };
}
