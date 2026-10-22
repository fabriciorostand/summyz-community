import { ChevronLeft, ChevronRight, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Tabs } from "../components/disclosure";
import { EmptyState, ErrorState, LoadingPanel } from "../components/states";
import { Avatar, Badge, Button, Field, SelectField } from "../components/ui";
import type { Messages } from "../i18n/messages/pt-BR";
import { useI18n } from "../i18n/store";
import { useDashboard } from "../layout/dashboard-layout";
import { TopBar } from "../layout/top-bar";
import {
  api,
  type HistoricalParticipantPage,
  type MeetingHistoryPage as HistoryPage,
} from "../lib/api";
import { formatDuration, pipelineStatus } from "../lib/format";
import { seriesColor } from "../lib/series";
import { Screen } from "./screen";

type StateFilter = "" | "completed" | "in_progress" | "failed";

export function CallsPage() {
  const { controls, guilds } = useDashboard();
  const { format, t, timeZone } = useI18n();
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
      .listMeetings(
        guildId,
        {
          page,
          ...buildFilters({
            contentRetained,
            dateFrom,
            dateTo,
            participantUserId,
            search: submittedSearch,
            state,
          }),
        },
        timeZone,
      )
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
    timeZone,
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
      <TopBar actions={controls} title={t.calls.title} />
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
                aria-label={t.calls.search}
                className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-ink-dim pointer-fine:text-[13.5px]"
                maxLength={128}
                onChange={(event) => setSearch(event.currentTarget.value)}
                placeholder={t.calls.search}
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
                  {t.calls.clear}
                </Button>
              )}
            </form>
            <div className="flex flex-wrap items-center gap-2">
              {/* The tabs grow to fill the row, so the button sits at the right edge while it
                  fits beside them and at the start once it wraps below. */}
              <div className="min-w-0 flex-auto">
                <Tabs
                  ariaLabel={t.calls.stateLabel}
                  onChange={resetToFirstPage(setState)}
                  options={[
                    { label: t.calls.all, value: "" },
                    { label: t.calls.completed, value: "completed" },
                    { label: t.calls.inProgress, value: "in_progress" },
                    { label: t.calls.failed, value: "failed" },
                  ]}
                  value={state}
                />
              </div>
              <Button
                aria-expanded={advancedOpen}
                onClick={() => setAdvancedOpen((open) => !open)}
                type="button"
                variant="secondary"
              >
                <SlidersHorizontal className="size-3.5" />
                {t.calls.advanced}
              </Button>
            </div>
            {advancedOpen && (
              <div className="grid grid-cols-1 gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2 xl:grid-cols-4">
                <Field
                  label={t.calls.from}
                  onChange={(event) => resetToFirstPage(setDateFrom)(event.currentTarget.value)}
                  type="date"
                  value={dateFrom}
                />
                <Field
                  label={t.calls.to}
                  onChange={(event) => resetToFirstPage(setDateTo)(event.currentTarget.value)}
                  type="date"
                  value={dateTo}
                />
                <SelectField
                  label={t.calls.contentRetained}
                  onChange={resetToFirstPage(setContentRetained)}
                  options={[
                    { label: t.calls.any, value: "" },
                    { label: t.calls.onlyWithContent, value: "true" },
                    { label: t.calls.onlyWithoutContent, value: "false" },
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
              {t.calls.range(
                format.number((history.page - 1) * history.pageSize + 1),
                format.number(Math.min(history.page * history.pageSize, history.total)),
                format.number(history.total),
              )}
            </span>
            <div className="flex items-center gap-2">
              <Button
                disabled={page === 1}
                onClick={() => setPage((current) => current - 1)}
                type="button"
                variant="secondary"
              >
                <ChevronLeft className="size-3.5" />
                {t.calls.previous}
              </Button>
              <Button
                disabled={page >= totalPages}
                onClick={() => setPage((current) => current + 1)}
                type="button"
                variant="secondary"
              >
                {t.calls.next}
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
  const { t } = useI18n();
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
      label={t.calls.participant}
      onChange={onChange}
      options={[
        { label: t.calls.any, value: "" },
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
  const { t } = useI18n();
  if (loadError) {
    return (
      <ErrorState code="request_failed" onRetry={onRetry} title={t.calls.historyUnavailableTitle}>
        {t.calls.historyUnavailableBody}
      </ErrorState>
    );
  }
  if (guildCount === 0) {
    return <EmptyState title={t.calls.noGuildTitle}>{t.calls.noGuildBody}</EmptyState>;
  }
  if (guildCount === undefined || (guildId.length > 0 && history === undefined)) {
    return <LoadingPanel label={t.calls.loading} />;
  }
  if (history === undefined || history.items.length === 0) {
    return <EmptyState title={t.calls.emptyTitle}>{t.calls.emptyBody}</EmptyState>;
  }
  return (
    <div className="flex flex-col gap-3 md:gap-0 md:overflow-hidden md:rounded-xl md:border md:border-line md:bg-surface">
      <div className="label-mono hidden grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)_90px_28px] gap-4 border-b border-line-soft px-4 py-3 text-ink-muted md:grid">
        <span>{t.calls.when}</span>
        <span>{t.calls.channel}</span>
        <span>{t.calls.participants}</span>
        <span className="text-right">{t.calls.duration}</span>
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
  const { format, t } = useI18n();
  const status = pipelineStatus(meeting.pipelineStatus, t.pipeline);
  const participants = meeting.participants ?? [];
  return (
    <Link
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 rounded-xl border border-line bg-surface p-4 transition-colors [grid-template-areas:'when_duration'_'channel_channel'_'people_people'] hover:bg-surface-raised md:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)_90px_28px] md:gap-y-4 md:rounded-none md:border-0 md:border-b md:border-line-soft md:bg-transparent md:px-4 md:py-3.5 md:[grid-template-areas:'when_channel_people_duration_chevron'] md:last:border-0"
      to={`/history/${meeting.meetingId}`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 [grid-area:when] md:flex-col md:items-start">
        <Badge tone={status.tone === "live" ? "live" : status.tone}>{status.label}</Badge>
        <span className="font-mono text-[10.5px] text-ink-dim">
          {format.shortDateTime(meeting.startedAt, timeZone)}
        </span>
      </div>
      <div className="min-w-0 [grid-area:channel]">
        <div className="truncate text-[13.5px] font-medium text-ink">
          {meeting.voiceChannelName ?? t.calls.unavailable}
        </div>
        <div className="mt-0.5 truncate text-[11.5px] text-ink-muted">
          {meeting.aiProfile === null
            ? retentionLabel(meeting, t.calls)
            : t.calls.profile(meeting.aiProfile.name)}
        </div>
      </div>
      <div className="min-w-0 [grid-area:people]">
        <TalkTime participants={participants} />
      </div>
      <span className="text-right font-mono text-[12px] text-ink-secondary [grid-area:duration]">
        {meeting.durationMs === null ? "—" : formatDuration(meeting.durationMs)}
      </span>
      <ChevronRight className="hidden size-4 text-ink-dim [grid-area:chevron] md:block" />
    </Link>
  );
}

/** Speakers named on each row; quieter ones fold into one neutral slice. */
const namedSpeakers = 3;

type Participant = NonNullable<HistoryPage["items"][number]["participants"]>[number];

function TalkTime({ participants }: { participants: readonly Participant[] }) {
  const { t } = useI18n();
  const ranked = participants
    .flatMap((participant) =>
      participant.percentage === null
        ? []
        : [{ ...participant, percentage: participant.percentage }],
    )
    .sort((left, right) => right.percentage - left.percentage);
  if (ranked.length === 0) {
    return (
      <span className="text-[11.5px] text-ink-dim">
        {participants.length === 0 ? t.calls.unavailable : t.calls.talkTimeUnavailable}
      </span>
    );
  }
  const named = ranked.slice(0, namedSpeakers);
  const rest = ranked.slice(namedSpeakers);
  const slices = [
    ...named.map((participant, index) => ({
      fill: seriesColor(index),
      key: participant.userId,
      percentage: participant.percentage,
    })),
    {
      fill: "bg-series-other",
      key: "rest",
      percentage: rest.reduce((sum, participant) => sum + participant.percentage, 0),
    },
  ].filter((slice) => slice.percentage > 0);
  return (
    <>
      <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[11.5px] text-ink-secondary">
        {named.map((participant, index) => (
          <span className="inline-flex items-center gap-1.5" key={participant.userId}>
            <span className={`size-1.5 shrink-0 rounded-full ${seriesColor(index)}`} />
            {participant.displayName} {String(participant.percentage)}%
          </span>
        ))}
        {rest.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-ink-dim">
            <span className="size-1.5 shrink-0 rounded-full bg-series-other" />+
            {String(rest.length)}
          </span>
        )}
      </div>
      <div
        aria-label={t.calls.talkTimeDistribution}
        className="mt-1.5 flex h-1 gap-0.5 overflow-hidden rounded-full"
        role="img"
      >
        {slices.map((slice) => (
          <span
            className={`${slice.fill} first:rounded-l-full last:rounded-r-full`}
            key={slice.key}
            style={{ width: `${String(slice.percentage)}%` }}
          />
        ))}
      </div>
    </>
  );
}

function retentionLabel(meeting: HistoryPage["items"][number], labels: Messages["calls"]): string {
  if (!meeting.contentRetained) return labels.contentNotRetained;
  return meeting.pipelineStatus === "failed" ? labels.summaryFailed : labels.retained;
}
