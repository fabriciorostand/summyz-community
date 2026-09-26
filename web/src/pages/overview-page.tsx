import { ArrowUpRight, Mic2, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Tabs } from "../components/disclosure";
import { ErrorState, LoadingPanel, NoServerState, secondaryLinkClass } from "../components/states";
import { Avatar, Badge, Card, InlineLink, Meter, RailLabel } from "../components/ui";
import { useBotInstallation } from "../hooks/use-bot-installation";
import { type DashboardPeriod, useDashboard } from "../layout/dashboard-layout";
import { TopBar } from "../layout/top-bar";
import {
  api,
  type DashboardAnalytics,
  type DashboardTask,
  type MeetingHistoryPage,
} from "../lib/api";
import {
  formatDate,
  formatDeadline,
  formatDuration,
  formatElapsed,
  formatInteger,
  formatRoundedCost,
  formatShortDate,
  percentageOf,
  pipelineStatus,
} from "../lib/format";
import { groupByOwner } from "../lib/task-groups";
import { Screen } from "./screen";

const periodLabels: Record<DashboardPeriod, string> = {
  "30d": "Últimos 30 dias",
  "90d": "Últimos 90 dias",
  all: "Todo o histórico",
};

export function OverviewPage() {
  const { controls, dashboard, dashboardError, guilds, period, setPeriod } = useDashboard();
  return (
    <>
      <TopBar actions={controls} title="Visão geral" />
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
  if (error) {
    return (
      <ErrorState
        code="request_failed"
        onRetry={onRetry}
        secondaryAction={
          <Link className={secondaryLinkClass} to="/installation">
            Ver instalação
          </Link>
        }
        title="Não foi possível carregar as métricas"
      >
        A consulta falhou. As gravações em andamento não são afetadas — o bot roda separado do
        dashboard.
      </ErrorState>
    );
  }
  if (guildCount === 0) return <NoGuildState />;
  if (guildCount === undefined || (guildId.length > 0 && dashboard === undefined)) {
    return <LoadingPanel label="Carregando métricas do servidor…" />;
  }
  if (dashboard === undefined) return null;
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-6">
        {dashboard.liveMeeting != null && <LiveCard liveMeeting={dashboard.liveMeeting} />}
        <div>
          <div className="mb-3 flex items-center gap-3">
            <span className="label-mono text-ink-muted">Período · {periodLabels[period]}</span>
            <span className="h-px flex-1 bg-line-soft" />
            {/* The period tabs keep their width; the label wraps instead. */}
            <div className="shrink-0">
              <Tabs
                ariaLabel="Período"
                onChange={setPeriod}
                options={[
                  { label: "30d", value: "30d" },
                  { label: "90d", value: "90d" },
                  { label: "Tudo", value: "all" },
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
}: {
  liveMeeting: NonNullable<DashboardAnalytics["liveMeeting"]>;
}) {
  const elapsed = useElapsed(liveMeeting.startedAt);
  const speaking = new Set(liveMeeting.speakingUserIds);
  return (
    <div>
      <RailLabel>Agora</RailLabel>
      <section className="flex flex-wrap items-start gap-6 rounded-xl border border-fail/30 bg-surface p-5">
        <div className="min-w-0 flex-1">
          <Badge tone="live">Gravando</Badge>
          <h2 className="m-0 mt-2.5 text-[20px] font-semibold tracking-tight text-ink">
            {liveMeeting.voiceChannelName ?? "Canal indisponível"}
          </h2>
          <p className="m-0 mt-1.5 text-[12.5px] text-ink-muted">
            Iniciada às {formatDate(liveMeeting.startedAt, "America/Sao_Paulo").split(" ")[1]}
            {liveMeeting.aiProfile !== null && (
              <>
                {" · perfil "}
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
                  <em className="label-mono not-italic">falando</em>
                )}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="font-mono text-[28px] leading-none font-medium tracking-tight text-ink">
            {elapsed}
          </div>
          <div className="label-mono text-ink-muted">Decorridos</div>
          <Link
            className="mt-2 inline-flex items-center gap-1 text-[12.5px] text-accent hover:text-accent-hover"
            to={`/history/${liveMeeting.meetingId}`}
          >
            Acompanhar <ArrowUpRight className="size-3.5" />
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
  const maximum = Math.max(
    1,
    ...dashboard.statusSeries.map((bucket) => bucket.completed + bucket.failed),
  );
  const pending = dashboard.cost.attemptCounts.pending + dashboard.cost.attemptCounts.unattributed;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid flex-1 grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-6">
          <Metric
            delta={dashboard.calls.deltaPercentage}
            label="Calls"
            value={formatInteger(dashboard.totalCalls)}
          />
          <Metric
            label="Horas"
            note={`${formatDuration(dashboard.averageDurationMs)} médios`}
            value={formatInteger(dashboard.totalDurationMs / 3_600_000, 1)}
          />
          <Metric
            label="Custo"
            note={pending > 0 ? `${String(pending)} pendentes` : undefined}
            value={formatRoundedCost(dashboard.cost.confirmed)}
          />
        </div>
        <div className="flex gap-3">
          <LegendItem className="bg-action" label="Concluídas" />
          <LegendItem className="bg-fail" label="Falhas" />
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
                    title={`${String(bucket.failed)} falhas`}
                  />
                )}
                <div
                  className="min-h-0.5 rounded-t bg-action"
                  style={{ height: `${String((bucket.completed / maximum) * 100)}%` }}
                  title={`${String(bucket.completed)} concluídas`}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between">
            {dashboard.statusSeries.map((bucket) => (
              <span className="font-mono text-[9.5px] text-ink-dim" key={bucket.bucketStart}>
                {formatShortDate(bucket.bucketStart, dashboard.timeZone)}
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
  const maximum = dashboard.topSpeakers[0]?.talkTimeMs ?? 0;
  const total = dashboard.topSpeakers.reduce((sum, speaker) => sum + speaker.talkTimeMs, 0);
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="m-0 flex items-center gap-2 text-[15px] font-semibold tracking-tight text-ink">
          <Mic2 className="size-4 text-accent" />
          Principais falantes
        </h2>
        <span className="label-mono text-ink-muted">Tempo de fala</span>
      </div>
      {dashboard.topSpeakers.length === 0 ? (
        <p className="m-0 text-[12.5px] text-ink-muted">
          O tempo de fala estará disponível após a primeira call concluída.
        </p>
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

const phaseLabels = {
  refinement: "Refinamento",
  summary: "Resumo",
  transcription: "Transcrição",
} as const;

const costSegmentColors = ["bg-action", "bg-accent", "bg-[#4ea8e0]", "bg-ok", "bg-warn"] as const;

type CostEntry = DashboardAnalytics["cost"]["breakdown"][number];

/** Sum of an entry's confirmed amounts; the stacked bar only needs proportions. */
function confirmedAmount(entry: CostEntry): number {
  return entry.confirmed.reduce((sum, item) => {
    const amount = Number(item.amount);
    return Number.isFinite(amount) ? sum + amount : sum;
  }, 0);
}

function segmentColor(index: number): string {
  return costSegmentColors[index % costSegmentColors.length] ?? "bg-action";
}

function CostCard({ dashboard }: { dashboard: DashboardAnalytics }) {
  const unattributed = dashboard.cost.attemptCounts.unattributed;
  const paid = dashboard.cost.breakdown.filter((entry) => entry.execution !== "local");
  const total = paid.reduce((sum, entry) => sum + confirmedAmount(entry), 0);
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="m-0 text-[15px] font-semibold tracking-tight text-ink">
          Custo por provedor
        </h2>
        <InlineLink>Detalhar</InlineLink>
      </div>
      {dashboard.cost.breakdown.length === 0 ? (
        <p className="m-0 text-[12.5px] text-ink-muted">Nenhum custo registrado no período.</p>
      ) : (
        <>
          {total > 0 && (
            <div
              aria-label="Distribuição do custo confirmado"
              className="mb-4 flex h-[9px] overflow-hidden rounded-[5px]"
              role="img"
            >
              {paid.map((entry, index) => (
                <div
                  className={segmentColor(index)}
                  key={`${entry.phase}:${entry.provider}`}
                  style={{ width: `${String((confirmedAmount(entry) / total) * 100)}%` }}
                />
              ))}
            </div>
          )}
          <div className="flex flex-col gap-2.5">
            {dashboard.cost.breakdown.map((entry) => (
              <div
                className="flex items-center gap-2.5"
                key={`${entry.phase}:${entry.provider}:${entry.execution}`}
              >
                <span
                  className={`size-2 shrink-0 rounded-sm ${
                    entry.execution === "local"
                      ? "bg-surface-inset"
                      : segmentColor(paid.indexOf(entry))
                  }`}
                />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                  {entry.execution === "local" ? entry.provider : phaseLabels[entry.phase]}
                  <span className="text-ink-dim">
                    {" "}
                    · {entry.execution === "local" ? "local" : entry.provider}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[11.5px] text-ink-secondary">
                  {entry.execution === "local" ? "sem custo" : formatRoundedCost(entry.confirmed)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {unattributed > 0 && (
        <div className="mt-4 flex items-start gap-2 text-[11.5px] leading-relaxed text-warn">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {unattributed === 1
              ? "1 tentativa não foi atribuída automaticamente."
              : `${String(unattributed)} tentativas não foram atribuídas automaticamente.`}{" "}
            O subtotal confirmado não é necessariamente completo.
          </span>
        </div>
      )}
    </Card>
  );
}

function OpenTasksCard({ dashboard, guildId }: { dashboard: DashboardAnalytics; guildId: string }) {
  if (dashboard.openTaskCount === 0) return null;
  return (
    <Card>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-[15px] font-semibold tracking-tight text-ink">Tarefas abertas</h2>
          <p className="m-0 mt-1 text-[12.5px] text-ink-muted">
            Agrupadas por responsável, extraídas dos resumos.
          </p>
        </div>
        <Link className="shrink-0 text-[12.5px] text-accent hover:text-accent-hover" to="/tasks">
          Ver todas as {String(dashboard.openTaskCount)}
        </Link>
      </div>
      <TaskPreview guildId={guildId} timeZone={dashboard.timeZone} />
    </Card>
  );
}

function TaskPreview({ guildId, timeZone }: { guildId: string; timeZone: string }) {
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
  if (tasks === undefined) return <LoadingPanel label="Carregando tarefas…" />;
  const groups = groupByOwner(tasks).slice(0, 3);
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
            {group.tasks.slice(0, 3).map((task) => (
              <div className="flex items-start gap-2" key={task.taskId}>
                <span
                  className={`mt-1.5 size-1.5 shrink-0 rounded-full ${task.overdue ? "bg-fail" : "bg-accent"}`}
                />
                <span className="min-w-0 text-[12px] leading-snug text-ink-secondary">
                  {task.text}
                  {task.deadlineDate !== null && (
                    <em
                      className={`label-mono mt-1 block not-italic ${task.overdue ? "text-fail" : "text-ink-dim"}`}
                    >
                      {formatDeadline(task, task.deadlineTimeZone ?? timeZone)}
                    </em>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function RecentCallsCard({ guildId }: { guildId: string }) {
  const [history, setHistory] = useState<MeetingHistoryPage>();
  useEffect(() => {
    let active = true;
    void api
      .listMeetings(guildId, { page: 1 })
      .then((next) => {
        if (active) setHistory(next);
      })
      .catch(() => {
        if (active) setHistory(undefined);
      });
    return () => {
      active = false;
    };
  }, [guildId]);
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="m-0 text-[15px] font-semibold tracking-tight text-ink">Últimas calls</h2>
        <Link
          className="touch-target text-[12.5px] text-accent hover:text-accent-hover"
          to="/history"
        >
          Histórico
        </Link>
      </div>
      {history === undefined || history.items.length === 0 ? (
        <p className="m-0 text-[12.5px] text-ink-muted">Nenhuma call registrada ainda.</p>
      ) : (
        <div className="flex flex-col">
          {history.items.slice(0, 4).map((meeting) => {
            const status = pipelineStatus(meeting.pipelineStatus);
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
                  {meeting.voiceChannelName ?? "Canal indisponível"}
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
