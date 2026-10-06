import { ArrowLeft, Check, Copy, Download, ExternalLink, FileText, Info } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { Disclosure } from "../components/disclosure";
import { ErrorState, LoadingPanel } from "../components/states";
import { Avatar, Badge, Button, Card, Meter, Notice } from "../components/ui";
import { useI18n } from "../i18n/store";
import { useDashboard } from "../layout/dashboard-layout";
import { TopBar } from "../layout/top-bar";
import { api, type MeetingHistoryDetail, type MeetingHistorySummary } from "../lib/api";
import { downloadTextFile, meetingFileName } from "../lib/download";
import { formatDuration, pipelineStatus } from "../lib/format";
import { parseTranscript } from "../lib/transcript";
import { Screen } from "./screen";

export function CallDetailPage() {
  const { meetingId = "" } = useParams();
  const { controls, guilds } = useDashboard();
  const { t, timeZone } = useI18n();
  const guildId = guilds.selectedGuildId;
  const [meeting, setMeeting] = useState<MeetingHistoryDetail>();
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken is the explicit refetch trigger.
  useEffect(() => {
    if (guildId.length === 0) return;
    let active = true;
    setMeeting(undefined);
    setLoadError(false);
    void api
      .getMeeting(guildId, meetingId, timeZone)
      .then((next) => {
        if (active) setMeeting(next);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [guildId, meetingId, reloadToken, timeZone]);

  const status =
    meeting === undefined ? undefined : pipelineStatus(meeting.pipelineStatus, t.pipeline);
  return (
    <>
      <TopBar
        actions={
          <>
            <HeaderActions guildId={guildId} meeting={meeting} />
            {controls}
          </>
        }
        breadcrumb={
          <>
            <Link
              className="touch-target flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink"
              to="/history"
            >
              <ArrowLeft className="size-3.5" />
              {t.nav.calls}
            </Link>
            <span className="font-mono text-[11px] text-ink-dim">/</span>
          </>
        }
        title={
          <span className="flex min-w-0 items-center gap-3">
            <span className="min-w-0 truncate">
              {meeting?.voiceChannelName ?? t.callDetail.title}
            </span>
            {status !== undefined && (
              <span className="shrink-0">
                <Badge tone={status.tone === "live" ? "live" : status.tone}>{status.label}</Badge>
              </span>
            )}
          </span>
        }
      />
      <Screen>
        <DetailBody
          failed={loadError || guilds.error}
          meeting={meeting}
          onRetry={() => setReloadToken((token) => token + 1)}
        />
      </Screen>
    </>
  );
}

function HeaderActions({
  guildId,
  meeting,
}: {
  guildId: string;
  meeting: MeetingHistoryDetail | undefined;
}) {
  const { t } = useI18n();
  if (meeting === undefined) return null;
  return (
    <>
      <ExportButton guildId={guildId} meeting={meeting} />
      {meeting.discordUrl !== null && (
        <a
          className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface-raised px-3.5 py-2 text-[13.5px] text-ink"
          href={meeting.discordUrl}
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLink className="size-3.5" />
          {t.callDetail.openInDiscord}
        </a>
      )}
    </>
  );
}

function DetailBody({
  failed,
  meeting,
  onRetry,
}: {
  failed: boolean;
  meeting: MeetingHistoryDetail | undefined;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  if (failed) {
    return (
      <ErrorState
        code="request_failed"
        onRetry={onRetry}
        secondaryAction={
          <Link
            className="rounded-lg border border-line bg-surface-raised px-3.5 py-2 text-[13.5px] text-ink"
            to="/history"
          >
            {t.callDetail.historyUnavailable}
          </Link>
        }
        title={t.callDetail.unavailableTitle}
      >
        {t.callDetail.unavailableBody}
      </ErrorState>
    );
  }
  if (meeting === undefined) return <LoadingPanel label={t.callDetail.loading} />;
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col gap-6">
        <SummaryCard summary={meeting.summary} />
        <TranscriptCard transcript={meeting.transcript} />
      </div>
      <div className="flex flex-col gap-6">
        <ParticipantsCard meeting={meeting} />
        <FactsCard meeting={meeting} />
      </div>
    </div>
  );
}

function ExportButton({ guildId, meeting }: { guildId: string; meeting: MeetingHistoryDetail }) {
  const { dateFormat, t, timeFormat, timeZone } = useI18n();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const available = meeting.summary?.status === "completed" && meeting.transcript !== null;
  if (!available) return null;
  async function exportMeeting() {
    setBusy(true);
    setFailed(false);
    try {
      const contents = await api.getMeetingExport(guildId, meeting.meetingId, {
        dateFormat,
        timeFormat,
        timeZone,
      });
      downloadTextFile(
        meetingFileName(meeting.voiceChannelName, meeting.meetingId, t.callDetail.fileNameFallback),
        contents,
      );
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button
      disabled={busy}
      onClick={() => void exportMeeting()}
      type="button"
      variant={failed ? "danger" : "secondary"}
    >
      <Download className="size-3.5" />
      {failed ? t.callDetail.exportFailed : busy ? t.callDetail.exporting : t.callDetail.export}
    </Button>
  );
}

/**
 * Section titles for summaries that did not bring their own. They follow the language of the
 * summary, not the dashboard, so a card never mixes languages; the export uses the same rule.
 */
const summaryFallbackLabels = {
  en: {
    deadline: "Deadline",
    decisions: "Decisions",
    discussedTopics: "Discussed topics",
    executiveSummary: "Executive summary",
    observations: "Open issues and notes",
    tasks: "Tasks by owner",
  },
  pt: {
    deadline: "Prazo",
    decisions: "Decisões",
    discussedTopics: "Tópicos discutidos",
    executiveSummary: "Resumo executivo",
    observations: "Pendências e observações",
    tasks: "Tarefas por responsável",
  },
} as const;

function SummaryCard({ summary }: { summary: MeetingHistorySummary | null }) {
  const { t } = useI18n();
  if (summary === null) {
    return (
      <Card>
        <h2 className="m-0 mb-2 text-[15px] font-semibold tracking-tight text-ink">
          {t.callDetail.summary}
        </h2>
        <p className="m-0 text-[12.5px] text-ink-muted">{t.callDetail.contentNotRetained}</p>
      </Card>
    );
  }
  if (summary.status === "failed") {
    return (
      <Card>
        <h2 className="m-0 mb-3 text-[15px] font-semibold tracking-tight text-ink">
          {t.callDetail.summary}
        </h2>
        <Notice tone="warn">{t.callDetail.summaryFailed}</Notice>
      </Card>
    );
  }
  const fallback =
    summaryFallbackLabels[summary.language.toLowerCase().startsWith("pt") ? "pt" : "en"];
  const labels = { ...fallback, ...summary.labels };
  const warning = summary.languageWarning;
  return (
    <Card>
      {warning !== undefined && (
        <div className="mb-4">
          <Notice tone="warn">
            {t.callDetail.languageUnconfirmed} <strong>{warning.requestedLanguage}</strong>.
            {warning.detectedLanguage !== undefined && (
              <>
                {" "}
                {t.callDetail.detectedLanguage} <strong>{warning.detectedLanguage}</strong>.
              </>
            )}
          </Notice>
        </div>
      )}
      <div className="label-mono mb-3 text-ink-muted">{labels.executiveSummary}</div>
      <p className="m-0 text-[14px] leading-relaxed text-ink">{summary.executiveSummary}</p>
      <SummaryList items={summary.decisions} title={labels.decisions} withCheck />
      <SummaryList items={summary.discussedTopics} title={labels.discussedTopics} />
      {summary.tasks.length > 0 && (
        <section className="mt-6">
          <h3 className="m-0 mb-3 text-[13px] font-semibold text-ink">{labels.tasks}</h3>
          <div className="flex flex-col gap-2">
            {summary.tasks.map((task, index) => (
              <div
                className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-raised px-3 py-2.5"
                key={`${String(index)}:${task.text}`}
              >
                <Avatar name={task.ownerName ?? "?"} size={22} />
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] text-ink">{task.text}</div>
                  <div className="label-mono mt-1 text-ink-dim">
                    {[
                      task.ownerName,
                      task.deadlineText === undefined
                        ? undefined
                        : `${labels.deadline} ${task.deadlineText}`,
                    ]
                      .filter((part): part is string => part !== undefined)
                      .join(" · ")}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {summary.observations.length > 0 && (
        <div className="mt-6">
          <Notice icon={<Info className="mt-0.5 size-3.5 shrink-0" />}>
            <strong className="block text-ink">{labels.observations}</strong>
            <span className="mt-1 block">{summary.observations.join(" ")}</span>
          </Notice>
        </div>
      )}
    </Card>
  );
}

function SummaryList({
  items,
  title,
  withCheck = false,
}: {
  items: readonly string[];
  title: string;
  withCheck?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <section className="mt-6">
      <h3 className="m-0 mb-3 text-[13px] font-semibold text-ink">{title}</h3>
      <div className="flex flex-col gap-2">
        {items.map((item, index) => (
          <div className="flex items-start gap-2.5" key={`${String(index)}:${item}`}>
            {withCheck ? (
              <Check className="mt-0.5 size-3.5 shrink-0 text-ok" />
            ) : (
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
            )}
            <span className="text-[12.5px] leading-relaxed text-ink-secondary">{item}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function TranscriptCard({ transcript }: { transcript: string | null }) {
  const { t } = useI18n();
  const turns = useMemo(() => parseTranscript(transcript ?? ""), [transcript]);
  if (transcript === null) {
    return (
      <Card>
        <h2 className="m-0 mb-2 text-[15px] font-semibold tracking-tight text-ink">
          {t.callDetail.transcript}
        </h2>
        <p className="m-0 text-[12.5px] text-ink-muted">{t.callDetail.contentNotRetained}</p>
      </Card>
    );
  }
  return (
    <Disclosure icon={<FileText className="size-4" />} title={t.callDetail.fullTranscript}>
      {turns.length === 0 ? (
        <pre className="m-0 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-secondary">
          {transcript}
        </pre>
      ) : (
        <div className="flex flex-col">
          {turns.map((turn, index) => (
            <div
              className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-line-soft py-2.5 last:border-0 sm:grid-cols-[72px_120px_minmax(0,1fr)] sm:gap-y-3"
              key={`${String(index)}:${turn.startedAt}`}
            >
              <span className="font-mono text-[11px] text-ink-dim">{turn.startedAt}</span>
              <span className="truncate text-[12px] font-medium text-ink-secondary">
                {turn.speaker}
              </span>
              <span className="col-span-2 text-[12.5px] leading-relaxed whitespace-pre-line text-ink sm:col-span-1">
                {turn.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </Disclosure>
  );
}

function ParticipantsCard({ meeting }: { meeting: MeetingHistoryDetail }) {
  const { t } = useI18n();
  if (meeting.participants === null) {
    return (
      <Card>
        <h2 className="m-0 mb-2 text-[15px] font-semibold tracking-tight text-ink">
          {t.callDetail.participants}
        </h2>
        <p className="m-0 text-[12.5px] text-ink-muted">{t.callDetail.participantsUnavailable}</p>
      </Card>
    );
  }
  const silent = meeting.participants.every((participant) => participant.percentage === 0);
  return (
    <Card>
      <h2 className="m-0 mb-4 text-[15px] font-semibold tracking-tight text-ink">
        {t.callDetail.participants}
      </h2>
      {silent && <p className="m-0 mb-3 text-[12px] text-ink-muted">{t.callDetail.noSpeech}</p>}
      <div className="flex flex-col gap-3">
        {meeting.participants.map((participant) => (
          <div className="flex items-center gap-2.5" key={participant.userId}>
            <Avatar avatarUrl={participant.avatarUrl} name={participant.displayName} size={26} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[12.5px] text-ink">{participant.displayName}</span>
                <span className="font-mono text-[11px] text-ink-muted">
                  {participant.percentage === null ? "—" : `${String(participant.percentage)}%`}
                </span>
              </div>
              {participant.percentage !== null && (
                <div className="mt-1.5">
                  <Meter percentage={participant.percentage} />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function FactsCard({ meeting }: { meeting: MeetingHistoryDetail }) {
  const { format, t } = useI18n();
  const yesNo = (value: boolean) => (value ? t.callDetail.yes : t.callDetail.no);
  const facts: { label: string; value: string }[] = [
    { label: t.callDetail.startedAt, value: format.dateTime(meeting.startedAt, meeting.timeZone) },
    { label: t.callDetail.duration, value: formatDuration(meeting.durationMs) },
    { label: t.callDetail.profileUsed, value: meeting.aiProfile?.name ?? "—" },
    {
      label: t.callDetail.summaryLanguage,
      value: meeting.summary === null ? "—" : meeting.summary.language,
    },
    { label: t.callDetail.contentRetained, value: yesNo(meeting.contentRetained) },
    { label: t.callDetail.audioRetained, value: yesNo(meeting.audioRetained) },
    { label: t.callDetail.callCost, value: format.cost(meeting.cost.confirmed) },
  ];
  return (
    <Card>
      <h2 className="m-0 mb-4 text-[15px] font-semibold tracking-tight text-ink">
        {t.callDetail.factSheet}
      </h2>
      <div className="flex flex-col">
        {facts.map((fact) => (
          <div
            className="flex items-baseline justify-between gap-3 border-b border-line-soft py-2 last:border-0"
            key={fact.label}
          >
            <span className="text-[12px] text-ink-muted">{fact.label}</span>
            <span className="text-right font-mono text-[11.5px] text-ink-secondary">
              {fact.value}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4">
        <div className="label-mono mb-1.5 text-ink-muted">{t.callDetail.meetingId}</div>
        <CopyableId value={meeting.meetingId} />
      </div>
    </Card>
  );
}

function CopyableId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_600);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      className="flex w-full items-center gap-2 rounded-lg border border-line bg-surface-raised px-2.5 py-2 text-left font-mono text-[11px] text-ink-secondary transition-colors hover:border-line-strong"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
      type="button"
    >
      <span className="min-w-0 flex-1 truncate">{value}</span>
      {copied ? (
        <Check className="size-3.5 shrink-0 text-ok" />
      ) : (
        <Copy className="size-3.5 shrink-0 text-ink-dim" />
      )}
    </button>
  );
}
