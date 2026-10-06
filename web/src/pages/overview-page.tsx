import { ArrowUpRight, Mic2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Tabs } from "../components/disclosure";
import { ErrorState, LoadingPanel, NoServerState, secondaryLinkClass } from "../components/states";
import { Avatar, Badge, Card, InlineLink, Meter, RailLabel } from "../components/ui";
import { useBotInstallation } from "../hooks/use-bot-installation";
import { useI18n } from "../i18n/store";
import { type DashboardPeriod, useDashboard } from "../layout/dashboard-layout";
import { TopBar } from "../layout/top-bar";
import {
  api,
  type DashboardAnalytics,
  type DashboardTask,
  type MeetingHistoryPage,
} from "../lib/api";
import { confirmedAmount } from "../lib/costs";
import { formatDuration, formatElapsed, percentageOf, pipelineStatus } from "../lib/format";
import { stageColor } from "../lib/series";
import { groupByOwner } from "../lib/task-groups";
import { Screen } from "./screen";

export function OverviewPage() {
  const { controls, dashboard, dashboardError, guilds, period, setPeriod } = useDashboard();
  const { t } = useI18n();
  return (
    <>
      <TopBar actions={controls} title={t.overview.title} />
      <Screen>
        <OverviewBody
          dashboard={dashboard}
          error={dashboardError || guilds.error}
          guildCount={guilds.guilds?.length}
          guildId={guilds.selectedGuildId}
          onRetry={guilds.reload}
          period={period}
          setPeriod={setPeriod}
        />
      </Screen>
    </>
  );
}

function OverviewBody({
  dashboard,
  error,
  guildCount,
  guildId,
  onRetry,
  period,
  setPeriod,
}: {
  dashboard: DashboardAnalytics | undefined;
  error: boolean;
  guildCount: number | undefined;
  guildId: string;
  onRetry: () => void;
  period: DashboardPeriod;
  setPeriod: (value: DashboardPeriod) => void;
}) {
  const { t } = useI18n();
  if (error) {
    return (
      <ErrorState
        code="request_failed"
        onRetry={onRetry}
        secondaryAction={
          <Link className={secondaryLinkClass} to="/installation">
            {t.overview.viewInstallation}
          </Link>
        }
        title={t.overview.metricsErrorTitle}
      >
        {t.overview.metricsErrorBody}
      </ErrorState>
    );
  }
  if (guildCount === 0) return <NoGuildState />;
  if (guildCount === undefined || (guildId.length > 0 && dashboard === undefined)) {
    return <LoadingPanel label={t.overview.loadingMetrics} />;
  }
  if (dashboard === undefined) return null;
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-6">
        {dashboard.liveMeeting != null && (
          <LiveCard liveMeeting={dashboard.liveMeeting} timeZone={dashboard.timeZone} />
        )}
        <div>
          <div className="mb-3 flex items-center gap-3">
            <span className="label-mono text-ink-muted">{t.overview.period}</span>
            <span className="h-px flex-1 bg-line-soft" />
            {/* The period tabs keep their width. */}
            <div className="shrink-0">
              <Tabs
                ariaLabel={t.overview.period}
                onChange={setPeriod}
                options={[
                  { label: "30d", value: "30d" },
                  { label: "90d", value: "90d" },
                  { label: t.overview.all, value: "all" },
                ]}
                value={period}
              />
            </div>
          </div>
          <MetricsCard dashboard={dashboard} />
        </div>
        <OpenTasksCard dashboard={dashboard} guildId={guildId} />
      </div>
      <div className="flex flex-col gap-6">
        <TopSpeakersCard dashboard={dashboard} />
        <CostCard dashboard={dashboard} />
        <RecentCallsCard guildId={guildId} />
      </div>
    </div>
  );
}

function NoGuildState() {
  const { installUrl } = useBotInstallation();
  return <NoServerState installUrl={installUrl} />;
}

function LiveCard({
  liveMeeting,
  timeZone,
}: {
  liveMeeting: NonNullable<DashboardAnalytics["liveMeeting"]>;
  /** The zone the metrics were asked in, so the start time matches every other date. */
  timeZone: string;
}) {
  const { format, t } = useI18n();
  const elapsed = useElapsed(liveMeeting.startedAt);
  const speaking = new Set(liveMeeting.speakingUserIds);
  return (
    <div>
      <RailLabel>{t.overview.now}</RailLabel>
      <section className="flex flex-wrap items-start gap-6 rounded-xl border border-fail/30 bg-surface p-5">
        <div className="min-w-0 flex-1">
          <Badge tone="live">{t.overview.recording}</Badge>
          <h2 className="m-0 mt-2.5 text-[20px] font-semibold tracking-tight text-ink">
            {liveMeeting.voiceChannelName ?? t.overview.channelUnavailable}
          </h2>
          <p className="m-0 mt-1.5 text-[12.5px] text-ink-muted">
            {t.overview.startedAt(format.time(liveMeeting.startedAt, timeZone))}
            {liveMeeting.aiProfile !== null && (
              <>
                {` · ${t.overview.profile} `}
                <span className="text-ink-secondary">{liveMeeting.aiProfile.name}</span>
              </>
            )}
          </p>
          <div className="mt-3.5 flex flex-wrap gap-1.5">
            {liveMeeting.participants.map((participant) => (
              <span
                className={`flex items-center gap-1.5 rounded-lg py-1 pr-2.5 pl-1 text-[11.5px] ${
                  speaking.has(participant.userId)
                    ? "bg-action-soft text-accent"
                    : "bg-surface-inset text-ink-secondary"
                }`}
                key={participant.userId}
              >
                <Avatar
                  avatarUrl={participant.avatarUrl}
                  name={participant.displayName}
                  size={20}
                />
                {participant.displayName}
                {speaking.has(participant.userId) && (
                  <em className="label-mono not-italic">{t.overview.speaking}</em>
                )}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="font-mono text-[28px] leading-none font-medium tracking-tight text-ink">
            {elapsed}
          </div>
          <div className="label-mono text-ink-muted">{t.overview.elapsed}</div>
          <Link
            className="mt-2 inline-flex items-center gap-1 text-[12.5px] text-accent hover:text-accent-hover"
            to={`/history/${liveMeeting.meetingId}`}
          >
            {t.overview.follow} <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
      </section>
    </div>
  );
}

/** Ticks once per second so the live card behaves like the stopwatch in the design. */
function useElapsed(startedAt: string): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  return formatElapsed(now - new Date(startedAt).getTime());
}

function MetricsCard({ dashboard }: { dashboard: DashboardAnalytics }) {
  const { format, t } = useI18n();
  const maximum = Math.max(
    1,
    ...dashboard.statusSeries.map((bucket) => bucket.completed + bucket.failed),
  );
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid flex-1 grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-6">
          <Metric
            delta={dashboard.calls.deltaPercentage}
            label={t.overview.calls}
            value={format.number(dashboard.totalCalls)}
          />
          <Metric
            label={t.overview.hours}
            note={t.overview.averageDuration(formatDuration(dashboard.averageDurationMs))}
            value={format.number(dashboard.totalDurationMs / 3_600_000, 1)}
          />
          <Metric label={t.overview.cost} value={format.roundedCost(dashboard.cost.confirmed)} />
        </div>
        <div className="flex gap-3">
          <LegendItem className="bg-action" label={t.overview.completed} />
          <LegendItem className="bg-fail" label={t.overview.failures} />
        </div>
      </div>
      {dashboard.statusSeries.length > 0 && (
        <>
          <div className="mt-5 flex h-24 items-end gap-1.5">
            {dashboard.statusSeries.map((bucket) => (
              <div
                className="flex h-full flex-1 flex-col justify-end gap-0.5"
                key={bucket.bucketStart}
              >
                {bucket.failed > 0 && (
                  <div
                    className="min-h-0.5 rounded-t bg-fail"
                    style={{ height: `${String((bucket.failed / maximum) * 100)}%` }}
                    title={t.overview.failedCount(bucket.failed)}
                  />
                )}
                <div
                  className="min-h-0.5 rounded-t bg-action"
                  style={{ height: `${String((bucket.completed / maximum) * 100)}%` }}
                  title={t.overview.completedCount(bucket.completed)}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between">
            {dashboard.statusSeries.map((bucket) => (
              <span className="font-mono text-[9.5px] text-ink-dim" key={bucket.bucketStart}>
                {format.dayMonth(bucket.bucketStart)}
              </span>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function LegendItem({ className, label }: { className: string; label: string }) {
  return (
    <span className="label-mono flex items-center gap-1.5 text-ink-muted">
      <span className={`size-1.5 rounded-full ${className}`} />
      {label}
    </span>
  );
}

function Metric({
  delta,
  label,
  note,
  value,
}: {
  delta?: number | null | undefined;
  label: string;
  note?: string | undefined;
  value: string;
}) {
  return (
    <div>
      <div className="label-mono text-ink-muted">{label}</div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <strong className="font-mono text-[26px] leading-none font-medium tracking-tight whitespace-nowrap text-ink">
          {value}
        </strong>
        {delta !== undefined && delta !== null && (
          <span className={`text-[11.5px] ${delta >= 0 ? "text-ok" : "text-fail"}`}>
            {delta >= 0 ? "+" : ""}
            {String(delta)}%
          </span>
        )}
        {note !== undefined && <span className="text-[11.5px] text-ink-muted">{note}</span>}
      </div>
    </div>
  );
}

function TopSpeakersCard({ dashboard }: { dashboard: DashboardAnalytics }) {
  const { t } = useI18n();
  const maximum = dashboard.topSpeakers[0]?.talkTimeMs ?? 0;
  const total = dashboard.topSpeakers.reduce((sum, speaker) => sum + speaker.talkTimeMs, 0);
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="m-0 flex items-center gap-2 text-[15px] font-semibold tracking-tight text-ink">
          <Mic2 className="size-4 text-accent" />
          {t.overview.topSpeakers}
        </h2>
        <span className="label-mono text-ink-muted">{t.overview.talkTime}</span>
      </div>
      {dashboard.topSpeakers.length === 0 ? (
        <p className="m-0 text-[12.5px] text-ink-muted">{t.overview.talkTimeEmpty}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {dashboard.topSpeakers.map((speaker) => (
            <div className="flex items-center gap-2.5" key={speaker.userId}>
              <Avatar avatarUrl={speaker.avatarUrl} name={speaker.displayName} size={26} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[12.5px] text-ink">{speaker.displayName}</span>
                  <span className="font-mono text-[11px] text-ink-muted">
                    {String(percentageOf(speaker.talkTimeMs, total))}%
                  </span>
                </div>
                <div className="mt-1.5">
                  <Meter percentage={percentageOf(speaker.talkTimeMs, maximum)} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function CostCard({ dashboard }: { dashboard: DashboardAnalytics }) {
  const { format, t } = useI18n();
  const { stages } = dashboard.cost;
  const total = stages.reduce((sum, stage) => sum + confirmedAmount(stage.confirmed), 0);
  const paid = stages.filter((stage) => confirmedAmount(stage.confirmed) > 0);
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="m-0 text-[15px] font-semibold tracking-tight text-ink">
          {t.overview.costByStage}
        </h2>
        <InlineLink to="/costs">{t.overview.details}</InlineLink>
      </div>
      {stages.every((stage) => stage.executions.length === 0) ? (
        <p className="m-0 text-[12.5px] text-ink-muted">{t.overview.noCost}</p>
      ) : (
        <>
          {total > 0 && (
            <div
              aria-label={t.overview.costDistribution}
              className="mb-4 flex h-[9px] overflow-hidden rounded-[5px]"
              role="img"
            >
              {paid.map((stage) => (
                <div
                  className={stageColor(stage.phase)}
                  key={stage.phase}
                  style={{ width: `${String((confirmedAmount(stage.confirmed) / total) * 100)}%` }}
                />
              ))}
            </div>
          )}
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {stages.map((stage) => (
              <li className="flex items-center gap-2.5" key={stage.phase}>
                <span className={`size-2 shrink-0 rounded-sm ${stageColor(stage.phase)}`} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                  {t.stages.titles[stage.phase]}
                </span>
                <span className="shrink-0 font-mono text-[11.5px] text-ink-secondary">
                  {stageCost(stage)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );

  /** Same reading as the cost detail page: "—" for a stage that never ran, no charge when local. */
  function stageCost(stage: DashboardAnalytics["cost"]["stages"][number]): string {
    if (stage.executions.length === 0) return "—";
    return stage.executions.includes("api")
      ? format.roundedCost(stage.confirmed)
      : t.overview.noCharge;
  }
}

function OpenTasksCard({ dashboard, guildId }: { dashboard: DashboardAnalytics; guildId: string }) {
  const { t } = useI18n();
  if (dashboard.openTaskCount === 0) return null;
  return (
    <Card>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-[15px] font-semibold tracking-tight text-ink">
            {t.overview.openTasks}
          </h2>
          <p className="m-0 mt-1 text-[12.5px] text-ink-muted">{t.overview.openTasksHint}</p>
        </div>
        <Link className="shrink-0 text-[12.5px] text-accent hover:text-accent-hover" to="/tasks">
          {t.overview.viewAll(dashboard.openTaskCount)}
        </Link>
      </div>
      <TaskPreview guildId={guildId} />
    </Card>
  );
}

function TaskPreview({ guildId }: { guildId: string }) {
  const { format, t } = useI18n();
  const [tasks, setTasks] = useState<DashboardTask[]>();
  useEffect(() => {
    let active = true;
    void api
      .listTasks(guildId, { completed: false })
      .then((next) => {
        if (active) setTasks(next);
      })
      .catch(() => {
        if (active) setTasks([]);
      });
    return () => {
      active = false;
    };
  }, [guildId]);
  if (tasks === undefined) return <LoadingPanel label={t.overview.loadingTasks} />;
  const groups = groupByOwner(tasks, t.tasks.noOwner).slice(0, 3);
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {groups.map((group) => (
        <div className="rounded-lg border border-line bg-surface-raised p-3" key={group.key}>
          <div className="mb-2.5 flex items-center gap-2">
            <Avatar avatarUrl={group.avatarUrl} name={group.name} size={22} />
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
              {group.name}
            </span>
            <span className="font-mono text-[10.5px] text-ink-muted">{group.openCount}</span>
          </div>
          <div className="flex flex-col gap-2">
            {group.tasks.slice(0, 3).map((task) => {
              const deadline = format.deadline(task);
              return (
                <div className="flex items-start gap-2" key={task.taskId}>
                  <span
                    className={`mt-1.5 size-1.5 shrink-0 rounded-full ${task.overdue ? "bg-fail" : "bg-accent"}`}
                  />
                  <span className="min-w-0 text-[12px] leading-snug text-ink-secondary">
                    {task.text}
                    {deadline !== null && (
                      <em
                        className={`label-mono mt-1 block not-italic ${task.overdue ? "text-fail" : "text-ink-dim"}`}
                      >
                        {deadline}
                      </em>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function RecentCallsCard({ guildId }: { guildId: string }) {
  const { t, timeZone } = useI18n();
  const [history, setHistory] = useState<MeetingHistoryPage>();
  useEffect(() => {
    let active = true;
    void api
      .listMeetings(guildId, { page: 1 }, timeZone)
      .then((next) => {
        if (active) setHistory(next);
      })
      .catch(() => {
        if (active) setHistory(undefined);
      });
    return () => {
      active = false;
    };
  }, [guildId, timeZone]);
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="m-0 text-[15px] font-semibold tracking-tight text-ink">
          {t.overview.recentCalls}
        </h2>
        <Link
          className="touch-target text-[12.5px] text-accent hover:text-accent-hover"
          to="/history"
        >
          {t.overview.history}
        </Link>
      </div>
      {history === undefined || history.items.length === 0 ? (
        <p className="m-0 text-[12.5px] text-ink-muted">{t.overview.noCalls}</p>
      ) : (
        <div className="flex flex-col">
          {history.items.slice(0, 4).map((meeting) => {
            const status = pipelineStatus(meeting.pipelineStatus, t.pipeline);
            return (
              <Link
                className="flex items-center gap-2.5 border-b border-line-soft py-2.5 last:border-0 hover:text-ink"
                key={meeting.meetingId}
                to={`/history/${meeting.meetingId}`}
              >
                <span
                  className={`size-1.5 shrink-0 rounded-full ${
                    status.tone === "ok" ? "bg-ok" : status.tone === "fail" ? "bg-fail" : "bg-warn"
                  }`}
                />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-secondary">
                  {meeting.voiceChannelName ?? t.overview.channelUnavailable}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-ink-dim">
                  {formatDuration(meeting.durationMs)}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </Card>
  );
}
