import { ChevronLeft, ChevronRight, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Tabs } from "../components/disclosure";
import { EmptyState, ErrorState, LoadingPanel } from "../components/states";
import { Avatar, Badge, Button, Field, SelectField } from "../components/ui";
import { useDashboard } from "../layout/dashboard-layout";
import { TopBar } from "../layout/top-bar";
import {
  api,
  type HistoricalParticipantPage,
  type MeetingHistoryPage as HistoryPage,
} from "../lib/api";
import {
  formatDate,
  formatDuration,
  formatInteger,
  percentageOf,
  pipelineStatus,
} from "../lib/format";
import { Screen } from "./screen";

type StateFilter = "" | "completed" | "in_progress" | "failed";

export function CallsPage() {
  const { controls, guilds } = useDashboard();
  const guildId = guilds.selectedGuildId;
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [state, setState] = useState<StateFilter>("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [contentRetained, setContentRetained] = useState("");
  const [participantUserId, setParticipantUserId] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [history, setHistory] = useState<HistoryPage>();
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken is the explicit refetch trigger.
  useEffect(() => {
    if (guildId.length === 0) return;
    let active = true;
    setHistory(undefined);
    setLoadError(false);
    void api
      .listMeetings(guildId, {
        page,
        ...buildFilters({
          contentRetained,
          dateFrom,
          dateTo,
          participantUserId,
          search: submittedSearch,
          state,
        }),
      })
      .then((next) => {
        if (active) setHistory(next);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [
    contentRetained,
    dateFrom,
    dateTo,
    guildId,
    page,
    participantUserId,
    reloadToken,
    submittedSearch,
    state,
  ]);

  function resetToFirstPage<T>(setter: (value: T) => void) {
    return (value: T) => {
      setPage(1);
      setter(value);
    };
  }

  const totalPages =
    history === undefined ? 1 : Math.max(1, Math.ceil(history.total / history.pageSize));

  return (
    <>
      <TopBar
        actions={controls}
        meta={history === undefined ? undefined : `${formatInteger(history.total)} registros`}
        title="Calls"
      />
      <Screen>
        {guilds.guilds !== undefined && guilds.guilds.length > 0 && (
          <div className="flex flex-col gap-3">
            <form
              className="flex items-center gap-2 rounded-lg border border-line bg-surface-raised px-3 py-2"
              onSubmit={(event) => {
                event.preventDefault();
                setPage(1);
                setSubmittedSearch(search.trim());
              }}
            >
              <Search className="size-4 shrink-0 text-ink-muted" />
              <input
                aria-label="Buscar por canal ou ID da reunião"
                className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-ink-dim pointer-fine:text-[13.5px]"
                maxLength={128}
                onChange={(event) => setSearch(event.currentTarget.value)}
                placeholder="Buscar por canal ou ID da reunião"
                value={search}
              />
              {submittedSearch.length > 0 && (
                <Button
                  onClick={() => {
                    setSearch("");
                    setSubmittedSearch("");
                    setPage(1);
                  }}
                  type="button"
                  variant="ghost"
                >
                  Limpar
                </Button>
              )}
            </form>
            <div className="flex flex-wrap items-center gap-2">
              <Tabs
                ariaLabel="Estado da call"
                onChange={resetToFirstPage(setState)}
                options={[
                  { label: "Todas", value: "" },
                  { label: "Concluídas", value: "completed" },
                  { label: "Em andamento", value: "in_progress" },
                  { label: "Falhas", value: "failed" },
                ]}
                value={state}
              />
              <Button
                aria-expanded={advancedOpen}
                className="ml-auto"
                onClick={() => setAdvancedOpen((open) => !open)}
                type="button"
                variant="secondary"
              >
                <SlidersHorizontal className="size-3.5" />
                Avançado
              </Button>
            </div>
            {advancedOpen && (
              <div className="grid grid-cols-1 gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2 xl:grid-cols-4">
                <Field
                  label="De"
                  onChange={(event) => resetToFirstPage(setDateFrom)(event.currentTarget.value)}
                  type="date"
                  value={dateFrom}
                />
                <Field
                  label="Até"
                  onChange={(event) => resetToFirstPage(setDateTo)(event.currentTarget.value)}
                  type="date"
                  value={dateTo}
                />
                <SelectField
                  label="Conteúdo retido"
                  onChange={resetToFirstPage(setContentRetained)}
                  options={[
                    { label: "Qualquer", value: "" },
                    { label: "Somente com conteúdo", value: "true" },
                    { label: "Somente sem conteúdo", value: "false" },
                  ]}
                  value={contentRetained}
                />
                <ParticipantFilter
                  guildId={guildId}
                  onChange={resetToFirstPage(setParticipantUserId)}
                  value={participantUserId}
                />
              </div>
            )}
          </div>
        )}
        <CallsBody
          guildCount={guilds.guilds?.length}
          guildId={guildId}
          history={history}
          loadError={loadError || guilds.error}
          onRetry={() => setReloadToken((token) => token + 1)}
        />
        {history !== undefined && history.items.length > 0 && (
          <div className="flex items-center justify-between">
            <span className="label-mono text-ink-muted">
              {formatInteger((history.page - 1) * history.pageSize + 1)}–
              {formatInteger(Math.min(history.page * history.pageSize, history.total))} de{" "}
              {formatInteger(history.total)}
            </span>
            <div className="flex items-center gap-2">
              <Button
                disabled={page === 1}
                onClick={() => setPage((current) => current - 1)}
                type="button"
                variant="secondary"
              >
                <ChevronLeft className="size-3.5" />
                Anterior
              </Button>
              <Button
                disabled={page >= totalPages}
                onClick={() => setPage((current) => current + 1)}
                type="button"
                variant="secondary"
              >
                Próxima
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        )}
      </Screen>
    </>
  );
}

/**
 * A search term that looks like an identifier is sent as meetingId, which the API treats as an
 * exact lookup; anything else is a channel-name search.
 */
function buildFilters(input: {
  contentRetained: string;
  dateFrom: string;
  dateTo: string;
  participantUserId: string;
  search: string;
  state: StateFilter;
}) {
  if (input.search.length > 0) {
    return /\s/u.test(input.search) || input.search.startsWith("#")
      ? { channelName: input.search.replace(/^#/u, "") }
      : { meetingId: input.search };
  }
  return {
    ...(input.contentRetained === "" ? {} : { contentRetained: input.contentRetained === "true" }),
    ...(input.dateFrom === "" ? {} : { dateFrom: input.dateFrom }),
    ...(input.dateTo === "" ? {} : { dateTo: input.dateTo }),
    ...(input.participantUserId === "" ? {} : { participantUserId: input.participantUserId }),
    ...(input.state === "" ? {} : { state: input.state }),
  };
}

function ParticipantFilter({
  guildId,
  onChange,
  value,
}: {
  guildId: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const [participants, setParticipants] = useState<HistoricalParticipantPage>();
  useEffect(() => {
    if (guildId.length === 0) return;
    let active = true;
    void api
      .listHistoricalParticipants(guildId, 1)
      .then((next) => {
        if (active) setParticipants(next);
      })
      .catch(() => {
        if (active) setParticipants(undefined);
      });
    return () => {
      active = false;
    };
  }, [guildId]);
  return (
    <SelectField
      label="Participante"
      onChange={onChange}
      options={[
        { label: "Qualquer", value: "" },
        ...(participants?.items ?? []).map((participant) => ({
          label: participant.displayName,
          leading: (
            <Avatar
              avatarUrl={participant.avatarUrl}
              fallbackTone="action"
              name={participant.displayName}
              size={20}
            />
          ),
          value: participant.userId,
        })),
      ]}
      value={value}
    />
  );
}

function CallsBody({
  guildCount,
  guildId,
  history,
  loadError,
  onRetry,
}: {
  guildCount: number | undefined;
  guildId: string;
  history: HistoryPage | undefined;
  loadError: boolean;
  onRetry: () => void;
}) {
  if (loadError) {
    return (
      <ErrorState code="request_failed" onRetry={onRetry} title="Histórico indisponível">
        Não foi possível carregar as calls deste servidor.
      </ErrorState>
    );
  }
  if (guildCount === 0) {
    return (
      <EmptyState title="Nenhum servidor instalado">
        Instale o Summyz em um servidor para começar o histórico.
      </EmptyState>
    );
  }
  if (guildCount === undefined || (guildId.length > 0 && history === undefined)) {
    return <LoadingPanel label="Carregando calls…" />;
  }
  if (history === undefined || history.items.length === 0) {
    return (
      <EmptyState title="Nenhuma call encontrada">
        Ajuste os filtros ou aguarde a primeira reunião.
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-3 md:gap-0 md:overflow-hidden md:rounded-xl md:border md:border-line md:bg-surface">
      <div className="label-mono hidden grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)_90px_28px] gap-4 border-b border-line-soft px-4 py-3 text-ink-muted md:grid">
        <span>Quando</span>
        <span>Canal</span>
        <span>Participantes · tempo de fala</span>
        <span className="text-right">Duração</span>
        <span />
      </div>
      {history.items.map((meeting) => (
        <CallRow key={meeting.meetingId} meeting={meeting} timeZone={history.timeZone} />
      ))}
    </div>
  );
}

function CallRow({
  meeting,
  timeZone,
}: {
  meeting: HistoryPage["items"][number];
  timeZone: string;
}) {
  const status = pipelineStatus(meeting.pipelineStatus);
  const participants = meeting.participants ?? [];
  const withTalkTime = participants.filter((participant) => participant.percentage !== null);
  return (
    <Link
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 rounded-xl border border-line bg-surface p-4 transition-colors [grid-template-areas:'when_duration'_'channel_channel'_'people_people'] hover:bg-surface-raised md:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)_90px_28px] md:gap-y-4 md:rounded-none md:border-0 md:border-b md:border-line-soft md:bg-transparent md:px-4 md:py-3.5 md:[grid-template-areas:'when_channel_people_duration_chevron'] md:last:border-0"
      to={`/history/${meeting.meetingId}`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 [grid-area:when] md:flex-col md:items-start">
        <Badge tone={status.tone === "live" ? "live" : status.tone}>{status.label}</Badge>
        <span className="font-mono text-[10.5px] text-ink-dim">
          {formatDate(meeting.startedAt, timeZone)}
        </span>
      </div>
      <div className="min-w-0 [grid-area:channel]">
        <div className="truncate text-[13.5px] font-medium text-ink">
          {meeting.voiceChannelName ?? "Informação indisponível"}
        </div>
        <div className="mt-0.5 truncate text-[11.5px] text-ink-muted">
          {meeting.aiProfile === null
            ? retentionLabel(meeting)
            : `perfil ${meeting.aiProfile.name}`}
        </div>
      </div>
      <div className="min-w-0 [grid-area:people]">
        {withTalkTime.length === 0 ? (
          <span className="text-[11.5px] text-ink-dim">
            {participants.length === 0 ? "Informação indisponível" : "tempo de fala indisponível"}
          </span>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-2 gap-y-1 text-[11.5px] text-ink-secondary">
              {withTalkTime.slice(0, 2).map((participant) => (
                <span key={participant.userId}>
                  {participant.displayName} {String(participant.percentage)}%
                </span>
              ))}
              {withTalkTime.length > 2 && (
                <span className="text-ink-dim">+{String(withTalkTime.length - 2)}</span>
              )}
            </div>
            <div className="mt-1.5 flex h-1 gap-0.5 overflow-hidden rounded-full">
              {withTalkTime.slice(0, 4).map((participant) => (
                <span
                  className="bg-action first:rounded-l-full last:rounded-r-full"
                  key={participant.userId}
                  style={{
                    width: `${String(percentageOf(participant.percentage ?? 0, 100))}%`,
                  }}
                />
              ))}
            </div>
          </>
        )}
      </div>
      <span className="text-right font-mono text-[12px] text-ink-secondary [grid-area:duration]">
        {meeting.durationMs === null ? "—" : formatDuration(meeting.durationMs)}
      </span>
      <ChevronRight className="hidden size-4 text-ink-dim [grid-area:chevron] md:block" />
    </Link>
  );
}

function retentionLabel(meeting: HistoryPage["items"][number]): string {
  if (!meeting.contentRetained) return "conteúdo não retido";
  return meeting.pipelineStatus === "failed"
    ? "resumo não gerado · transcrição disponível"
    : "resumo e transcrição retidos";
}
