import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  formatDate,
  formatDuration,
  formatStatusClass,
  formatStatusLabel,
} from "./analytics-format";
import { api, type MeetingHistoryPage as MeetingHistoryPageData } from "./api";
import { Button, EmptyState, Field, Loading, SelectField } from "./components";
import { ServerSelector, useServerSelection } from "./dashboard-layout";
import { Page } from "./dashboard-shared";

export function MeetingHistoryPage() {
  const selection = useServerSelection();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [state, setState] = useState("");
  const [meetingIdInput, setMeetingIdInput] = useState("");
  const [meetingIdSearch, setMeetingIdSearch] = useState("");
  const [page, setPage] = useState(1);
  const [history, setHistory] = useState<MeetingHistoryPageData>();
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    if (selection.selectedGuildId.length === 0) return;
    setHistory(undefined);
    setLoadError(false);
    void api
      .listMeetings(selection.selectedGuildId, {
        page,
        ...(meetingIdSearch.length > 0
          ? { meetingId: meetingIdSearch }
          : {
              ...(dateFrom.length === 0 ? {} : { dateFrom }),
              ...(dateTo.length === 0 ? {} : { dateTo }),
              ...(state.length === 0 ? {} : { state }),
            }),
      })
      .then(setHistory)
      .catch(() => setLoadError(true));
  }, [dateFrom, dateTo, meetingIdSearch, page, selection.selectedGuildId, state]);
  return (
    <Page
      title="Histórico de calls"
      eyebrow="Reuniões"
      description="Consulte o andamento, os participantes e os conteúdos retidos de cada call."
    >
      {selection.guilds !== undefined && selection.guilds.length > 0 && (
        <ServerSelector
          guilds={selection.guilds}
          onChange={(value) => {
            setPage(1);
            selection.setSelectedGuildId(value);
          }}
          value={selection.selectedGuildId}
        />
      )}
      {selection.guilds !== undefined && selection.guilds.length > 0 && (
        <form
          className="meeting-id-search panel"
          onSubmit={(event) => {
            event.preventDefault();
            const meetingId = meetingIdInput.trim();
            if (meetingId.length === 0) return;
            setPage(1);
            setMeetingIdSearch(meetingId);
          }}
        >
          <Field
            label="ID da reunião"
            maxLength={128}
            value={meetingIdInput}
            onChange={(event) => setMeetingIdInput(event.currentTarget.value)}
          />
          <div className="meeting-id-search-actions">
            <Button disabled={meetingIdInput.trim().length === 0} type="submit">
              Pesquisar
            </Button>
            {meetingIdSearch.length > 0 && (
              <Button
                className="secondary"
                onClick={() => {
                  setMeetingIdInput("");
                  setMeetingIdSearch("");
                  setPage(1);
                }}
                type="button"
              >
                Limpar
              </Button>
            )}
          </div>
        </form>
      )}
      {selection.guilds !== undefined && selection.guilds.length > 0 && (
        <div className="history-filters panel">
          <Field
            disabled={meetingIdSearch.length > 0}
            label="De"
            type="date"
            value={dateFrom}
            onChange={(event) => {
              setPage(1);
              setDateFrom(event.currentTarget.value);
            }}
          />
          <Field
            disabled={meetingIdSearch.length > 0}
            label="Até"
            type="date"
            value={dateTo}
            onChange={(event) => {
              setPage(1);
              setDateTo(event.currentTarget.value);
            }}
          />
          <SelectField
            disabled={meetingIdSearch.length > 0}
            label="Estado"
            value={state}
            onChange={(event) => {
              setPage(1);
              setState(event.currentTarget.value);
            }}
          >
            <option value="">Todos</option>
            <option value="in_progress">Em andamento</option>
            <option value="completed">Concluída</option>
            <option value="failed">Falhou</option>
          </SelectField>
        </div>
      )}
      {selection.error || loadError ? (
        <EmptyState title="Histórico indisponível">Não foi possível carregar as calls.</EmptyState>
      ) : selection.guilds === undefined ||
        (selection.selectedGuildId.length > 0 && history === undefined) ? (
        <Loading />
      ) : selection.guilds.length === 0 ? (
        <EmptyState title="Nenhum servidor instalado">
          Instale o Summyz para começar o histórico.
        </EmptyState>
      ) : history === undefined || history.items.length === 0 ? (
        <EmptyState title="Nenhuma call encontrada">
          Ajuste os filtros ou aguarde a primeira reunião.
        </EmptyState>
      ) : (
        <>
          <div className="history-list">
            {history.items.map((meeting) => (
              <article className="history-card" key={meeting.meetingId}>
                <div className="history-card-main">
                  <span className={`meeting-status ${formatStatusClass(meeting.pipelineStatus)}`}>
                    {formatStatusLabel(meeting.pipelineStatus)}
                  </span>
                  <h2>{meeting.voiceChannelName ?? "Informação indisponível"}</h2>
                  <p>
                    {formatDate(meeting.startedAt, history.timeZone)} ·{" "}
                    {meeting.durationMs === null
                      ? "Em andamento"
                      : formatDuration(meeting.durationMs)}
                  </p>
                </div>
                <div className="participant-preview">
                  {meeting.participants === null ? (
                    <span>Participantes: Informação indisponível</span>
                  ) : (
                    <span>
                      Participantes:{" "}
                      {meeting.participants
                        .slice(0, 3)
                        .map((participant) => participant.displayName)
                        .join(", ")}
                      {meeting.participants.length > 3
                        ? ` +${String(meeting.participants.length - 3)}`
                        : ""}
                    </span>
                  )}
                  <div className="talk-time-preview">
                    <strong>Talk time</strong>
                    {meeting.participants?.some(
                      (participant) => participant.percentage !== null,
                    ) ? (
                      meeting.participants.slice(0, 3).map((participant) => (
                        <span key={participant.userId}>
                          {participant.displayName} — {String(participant.percentage)}%
                        </span>
                      ))
                    ) : (
                      <span>Informação indisponível</span>
                    )}
                  </div>
                </div>
                <Link className="card-action" to={`/history/${meeting.meetingId}`}>
                  Ver detalhes <ChevronRight />
                </Link>
              </article>
            ))}
          </div>
          <div className="pagination">
            <Button
              className="secondary"
              disabled={page === 1}
              onClick={() => setPage((current) => current - 1)}
            >
              Anterior
            </Button>
            <span>
              Página {page} de {Math.max(1, Math.ceil(history.total / history.pageSize))}
            </span>
            <Button
              className="secondary"
              disabled={page * history.pageSize >= history.total}
              onClick={() => setPage((current) => current + 1)}
            >
              Próxima
            </Button>
          </div>
          <p className="timezone-note">Datas e filtros usam o fuso {history.timeZone}.</p>
        </>
      )}
    </Page>
  );
}
