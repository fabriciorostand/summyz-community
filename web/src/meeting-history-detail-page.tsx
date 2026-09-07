import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  formatDate,
  formatDuration,
  formatStatusClass,
  formatStatusLabel,
} from "./analytics-format";
import { api, type MeetingHistoryDetail, type MeetingHistorySummary } from "./api";
import { EmptyState, Loading } from "./components";
import { ServerSelector, useServerSelection } from "./dashboard-layout";
import { Page } from "./dashboard-shared";

export function MeetingHistoryDetailPage() {
  const { meetingId = "" } = useParams();
  const navigate = useNavigate();
  const selection = useServerSelection();
  const [meeting, setMeeting] = useState<MeetingHistoryDetail>();
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    if (selection.selectedGuildId.length === 0) return;
    setMeeting(undefined);
    void api
      .getMeeting(selection.selectedGuildId, meetingId)
      .then(setMeeting)
      .catch(() => setLoadError(true));
  }, [meetingId, selection.selectedGuildId]);
  return (
    <Page
      title="Detalhes da call"
      eyebrow="Histórico"
      description="Participação, estado e conteúdo preservado desta reunião."
    >
      <MeetingDetailContent
        loadError={loadError}
        meeting={meeting}
        onGuildChange={(value) => {
          selection.setSelectedGuildId(value);
          navigate("/history");
        }}
        selection={selection}
      />
    </Page>
  );
}

function MeetingDetailContent({
  loadError,
  meeting,
  onGuildChange,
  selection,
}: {
  loadError: boolean;
  meeting: MeetingHistoryDetail | undefined;
  onGuildChange(value: string): void;
  selection: ReturnType<typeof useServerSelection>;
}) {
  if (selection.error || loadError)
    return (
      <EmptyState title="Call indisponível">
        <Link to="/history">Voltar ao histórico</Link>
      </EmptyState>
    );
  if (selection.guilds !== undefined && selection.guilds.length === 0)
    return (
      <EmptyState title="Nenhum servidor instalado">
        Instale o Summyz para consultar calls.
      </EmptyState>
    );
  if (meeting === undefined || selection.guilds === undefined) return <Loading />;
  return (
    <>
      <ServerSelector
        guilds={selection.guilds}
        onChange={onGuildChange}
        value={selection.selectedGuildId}
      />
      <MeetingOverview meeting={meeting} />
      <ParticipantsPanel meeting={meeting} />
      <RetainedContent meeting={meeting} />
    </>
  );
}

function MeetingOverview({ meeting }: { meeting: MeetingHistoryDetail }) {
  return (
    <section className="panel meeting-overview">
      <span className={`meeting-status ${formatStatusClass(meeting.pipelineStatus)}`}>
        {formatStatusLabel(meeting.pipelineStatus)}
      </span>
      <h2>{meeting.voiceChannelName ?? "Informação indisponível"}</h2>
      <p>
        {formatDate(meeting.startedAt, meeting.timeZone)} ·{" "}
        {meeting.durationMs === null ? "Em andamento" : formatDuration(meeting.durationMs)}
      </p>
    </section>
  );
}

function ParticipantsPanel({ meeting }: { meeting: MeetingHistoryDetail }) {
  if (meeting.participants === null)
    return (
      <section className="panel">
        <h2>Participantes e talk time</h2>
        <p className="muted">Informação indisponível</p>
      </section>
    );
  const noSpeech = meeting.participants.every((participant) => participant.percentage === 0);
  return (
    <section className="panel">
      <h2>Participantes e talk time</h2>
      {noSpeech && <p className="muted">Nenhuma fala detectada.</p>}
      <div className="talk-time-list">
        {meeting.participants.map((participant) => (
          <div key={participant.userId}>
            <strong>{participant.displayName}</strong>
            <span>
              {participant.percentage === null
                ? "Informação indisponível"
                : `${String(participant.percentage)}%`}
            </span>
            {participant.percentage !== null && (
              <i style={{ width: `${String(participant.percentage)}%` }} />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function RetainedContent({ meeting }: { meeting: MeetingHistoryDetail }) {
  return (
    <>
      <section className="panel retained-content">
        <h2>Resumo</h2>
        {meeting.summary === null ? (
          <p className="muted">Conteúdo não retido.</p>
        ) : (
          <MeetingSummaryContent summary={meeting.summary} />
        )}
      </section>
      <section className="panel retained-content">
        <h2>Transcrição</h2>
        {meeting.transcript === null ? (
          <p className="muted">Conteúdo não retido.</p>
        ) : (
          <pre>{meeting.transcript}</pre>
        )}
      </section>
    </>
  );
}

const meetingSummaryTexts = {
  en: {
    assignee: "Assignee",
    deadline: "Deadline",
    decisions: "Decisions",
    discussedTopics: "Discussed topics",
    executiveSummary: "Executive summary",
    failure:
      "The summary could not be generated after the configured attempts. The summary is unavailable, but the full transcript is available below.",
    observations: "Open issues and notes",
    tasks: "Tasks",
  },
  "pt-BR": {
    assignee: "Responsável",
    deadline: "Prazo",
    decisions: "Decisões",
    discussedTopics: "Tópicos discutidos",
    executiveSummary: "Resumo executivo",
    failure:
      "Não foi possível gerar o resumo após as tentativas configuradas. O resumo está indisponível, mas a transcrição completa está disponível abaixo.",
    observations: "Pendências e observações",
    tasks: "Tarefas",
  },
} as const;

function MeetingSummaryContent({ summary }: { summary: MeetingHistorySummary }) {
  const fallbackText = meetingSummaryTexts[summary.language === "en" ? "en" : "pt-BR"];
  if (summary.status === "failed") return <p className="muted">{fallbackText.failure}</p>;
  const text =
    summary.labels === undefined
      ? fallbackText
      : {
          ...fallbackText,
          assignee: summary.labels.assignee,
          deadline: summary.labels.deadline,
          decisions: summary.labels.decisions,
          discussedTopics: summary.labels.discussedTopics,
          executiveSummary: summary.labels.executiveSummary,
          observations: summary.labels.observations,
          tasks: summary.labels.tasks,
        };
  return (
    <div className="meeting-summary-content">
      <section>
        <h3>{text.executiveSummary}</h3>
        <p>{summary.executiveSummary}</p>
      </section>
      <SummaryList title={text.discussedTopics} items={summary.discussedTopics} />
      <SummaryList title={text.decisions} items={summary.decisions} />
      {summary.tasks.length > 0 && (
        <section>
          <h3>{text.tasks}</h3>
          <ul>
            {summary.tasks.map((task, index) => {
              const details = [
                task.ownerName === undefined ? undefined : `${text.assignee}: ${task.ownerName}`,
                task.deadlineText === undefined
                  ? undefined
                  : `${text.deadline}: ${task.deadlineText}`,
              ].filter((item): item is string => item !== undefined);
              return (
                <li key={`${String(index)}:${task.text}`}>
                  <span>{task.text}</span>
                  {details.length > 0 && <small>{details.join(" · ")}</small>}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <SummaryList title={text.observations} items={summary.observations} />
    </div>
  );
}

function SummaryList({ items, title }: { items: readonly string[]; title: string }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h3>{title}</h3>
      <ul>
        {items.map((item, index) => (
          <li key={`${String(index)}:${item}`}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
