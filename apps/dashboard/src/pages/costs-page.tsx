import { ArrowLeft, TriangleAlert } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { EmptyState, ErrorState, LoadingPanel } from "../components/states";
import { Card, controlClass, FormError, HelpTip, Notice } from "../components/ui";
import { useI18n } from "../i18n/store";
import { useDashboard } from "../layout/dashboard-layout";
import { TopBar } from "../layout/top-bar";
import { api, type CostDetail } from "../lib/api";
import { type CostRange, confirmedAmount, costRange, currentMonthRange } from "../lib/costs";
import { percentageOf } from "../lib/format";
import { stageColor } from "../lib/series";
import { Screen } from "./screen";

type Model = CostDetail["models"][number];
type AttemptCounts = CostDetail["attemptCounts"];

const attemptsOf = (counts: AttemptCounts) =>
  counts.confirmed + counts.pending + counts.unattributed + counts.notApplicable;

export function CostsPage() {
  const { controls, guilds } = useDashboard();
  const { t, timeZone } = useI18n();
  const [parameters, setParameters] = useSearchParams();
  const fallback = useMemo(() => currentMonthRange(new Date(), timeZone), [timeZone]);
  const range = costRange(parameters, fallback);
  const validRange = range.dateFrom <= range.dateTo;
  const guildId = guilds.selectedGuildId;
  const [detail, setDetail] = useState<CostDetail>();
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken is the explicit refetch trigger.
  useEffect(() => {
    if (guildId.length === 0 || !validRange) return;
    let active = true;
    setDetail(undefined);
    setLoadError(false);
    void api
      .getCostDetail(guildId, { dateFrom: range.dateFrom, dateTo: range.dateTo }, timeZone)
      .then((next) => {
        if (active) setDetail(next);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [guildId, range.dateFrom, range.dateTo, reloadToken, timeZone, validRange]);

  function changeRange(next: Partial<CostRange>) {
    const merged = { ...range, ...next };
    setParameters({ from: merged.dateFrom, to: merged.dateTo }, { replace: true });
  }

  const noGuild = guilds.guilds !== undefined && guilds.guilds.length === 0;
  return (
    <>
      <TopBar
        actions={controls}
        breadcrumb={
          <>
            <Link
              className="touch-target flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink"
              to="/"
            >
              <ArrowLeft className="size-3.5" />
              {t.overview.title}
            </Link>
            <span className="font-mono text-[11px] text-ink-dim">/</span>
          </>
        }
        title={t.costs.title}
      />
      <Screen>
        {noGuild ? (
          <EmptyState title={t.costs.noGuildTitle}>{t.costs.noGuildBody}</EmptyState>
        ) : (
          <>
            <RangeHeader
              detail={detail}
              onChange={changeRange}
              range={range}
              validRange={validRange}
            />
            {validRange && (
              <CostsBody
                detail={detail}
                loadError={loadError || guilds.error}
                onRetry={() => setReloadToken((token) => token + 1)}
              />
            )}
          </>
        )}
      </Screen>
    </>
  );
}

function RangeHeader({
  detail,
  onChange,
  range,
  validRange,
}: {
  detail: CostDetail | undefined;
  onChange: (next: Partial<CostRange>) => void;
  range: CostRange;
  validRange: boolean;
}) {
  const { format, t } = useI18n();
  const pending = detail?.attemptCounts.pending ?? 0;
  const unattributed = detail?.attemptCounts.unattributed ?? 0;
  // OpenRouter reports every charge in USD, so a range with no charge still reads as a sum.
  const confirmed =
    detail === undefined || detail.confirmed.length > 0
      ? detail?.confirmed
      : [{ amount: "0", currency: "USD" }];
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          {confirmed !== undefined && detail !== undefined && detail.meetingCount > 0 && (
            <p className="m-0 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <strong className="font-mono text-[28px] leading-none font-medium tracking-tight text-ink">
                {format.roundedCost(confirmed)}
              </strong>
              <span className="text-[13.5px] text-ink-secondary">
                {t.costs.confirmedAcross(detail.meetingCount)}
              </span>
            </p>
          )}
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto sm:gap-3">
          <InlineDateField
            label={t.costs.from}
            onChange={(dateFrom) => onChange({ dateFrom })}
            value={range.dateFrom}
          />
          <InlineDateField
            label={t.costs.to}
            onChange={(dateTo) => onChange({ dateTo })}
            value={range.dateTo}
          />
        </div>
      </div>
      {!validRange && <FormError>{t.costs.invalidRange}</FormError>}
      {validRange && pending + unattributed > 0 && (
        <Notice icon={<TriangleAlert className="mt-0.5 size-3.5 shrink-0" />} tone="warn">
          {pending > 0 && <>{t.costs.pending(pending)} </>}
          {unattributed > 0 && <>{t.costs.unattributed(unattributed)} </>}
          {t.costs.incompleteSubtotal}
        </Notice>
      )}
    </section>
  );
}

/** A date field with its label beside it, so both ends of the range share one line. */
function InlineDateField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none sm:gap-2">
      <span className="shrink-0 text-[12.5px] text-ink-muted">{label}</span>
      <input
        // One line on phones needs a smaller face than the 16px other fields use there.
        className={`${controlClass} min-w-0 px-1.5 text-[14px] sm:px-3 pointer-fine:text-[13.5px]`}
        onChange={(event) => {
          // Clearing the field would drop the range back to the current month; keep the last date.
          const next = event.currentTarget.value;
          if (next !== "") onChange(next);
        }}
        type="date"
        value={value}
      />
    </label>
  );
}

function CostsBody({
  detail,
  loadError,
  onRetry,
}: {
  detail: CostDetail | undefined;
  loadError: boolean;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  if (loadError) {
    return (
      <ErrorState code="request_failed" onRetry={onRetry} title={t.costs.errorTitle}>
        {t.costs.errorBody}
      </ErrorState>
    );
  }
  if (detail === undefined) return <LoadingPanel label={t.costs.loading} />;
  if (detail.meetingCount === 0) {
    return <EmptyState title={t.costs.emptyTitle}>{t.costs.emptyBody}</EmptyState>;
  }
  return (
    <>
      <StageTrack detail={detail} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ModelTable models={detail.models} />
        <TopMeetings detail={detail} />
      </div>
    </>
  );
}

/**
 * The page's centrepiece: one continuous track split by what each stage cost, above the three
 * stages in the order the pipeline runs them.
 */
function StageTrack({ detail }: { detail: CostDetail }) {
  const { t } = useI18n();
  const headingId = useId();
  const total = confirmedAmount(detail.confirmed);
  const paid = detail.stages.filter((stage) => confirmedAmount(stage.confirmed) > 0);
  return (
    <Card>
      <h2 className="m-0 mb-4 text-[15px] font-semibold tracking-tight text-ink" id={headingId}>
        {t.costs.stages}
      </h2>
      {total > 0 && (
        <div
          aria-label={t.costs.stageDistribution}
          className="mb-5 flex h-2.5 gap-0.5 overflow-hidden rounded-full"
          role="img"
        >
          {paid.map((stage) => (
            <span
              className={`basis-0 ${stageColor(stage.phase)}`}
              key={stage.phase}
              // Shares of 100: raw amounts in cents add up to less than 1 and would leave the
              // flex track mostly empty.
              style={{ flexGrow: (confirmedAmount(stage.confirmed) / total) * 100 }}
            />
          ))}
        </div>
      )}
      <ol
        aria-labelledby={headingId}
        className="m-0 grid list-none grid-cols-1 gap-5 p-0 sm:grid-cols-3 sm:gap-0"
      >
        {detail.stages.map((stage) => (
          <StageColumn
            key={stage.phase}
            models={detail.models.filter((model) => model.phase === stage.phase)}
            stage={stage}
            total={total}
          />
        ))}
      </ol>
    </Card>
  );
}

function StageColumn({
  models,
  stage,
  total,
}: {
  models: Model[];
  stage: CostDetail["stages"][number];
  total: number;
}) {
  const { format, t } = useI18n();
  const amount = confirmedAmount(stage.confirmed);
  const counts = stage.attemptCounts;
  const apiRequests = counts.confirmed + counts.pending + counts.unattributed;
  const unresolved = counts.pending + counts.unattributed;
  const ran = attemptsOf(counts) > 0;
  let value = t.overview.noCharge;
  if (!ran) value = "—";
  else if (apiRequests > 0) value = format.roundedCost(stage.confirmed);
  return (
    <li className="flex min-w-0 flex-col gap-1.5 sm:border-l sm:border-line-soft sm:px-5 sm:first:border-l-0 sm:first:pl-0 sm:last:pr-0">
      <h3 className="m-0 flex items-center gap-2 text-[13px] font-medium text-ink">
        <span className={`size-2 shrink-0 rounded-full ${stageColor(stage.phase)}`} />
        {t.stages.titles[stage.phase]}
      </h3>
      <strong className="font-mono text-[20px] leading-tight font-medium tracking-tight text-ink">
        {value}
      </strong>
      {amount > 0 && total > 0 && (
        <span className="text-[11.5px] text-ink-muted">
          {t.costs.share(percentageOf(amount, total))}
        </span>
      )}
      {!ran && <span className="text-[12px] text-ink-muted">{t.costs.notRun}</span>}
      {models.length > 0 && (
        <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
          {models.map((model) => (
            <li
              className="truncate text-[12px] text-ink-secondary"
              key={`${model.execution}:${model.provider}:${model.model ?? ""}`}
            >
              {model.provider} · {model.model ?? t.costs.modelUnknown}
            </li>
          ))}
        </ul>
      )}
      {ran && (
        <span className="text-[11.5px] text-ink-muted">
          {[
            apiRequests > 0 ? t.costs.requestCount(apiRequests) : undefined,
            counts.notApplicable > 0 ? t.costs.localRuns(counts.notApplicable) : undefined,
          ]
            .filter((part) => part !== undefined)
            .join(" · ")}
        </span>
      )}
      {unresolved > 0 && (
        <span className="text-[11.5px] text-warn">{t.costs.unresolvedCount(unresolved)}</span>
      )}
    </li>
  );
}

/** On phones each row becomes a small card: the header hides and the figures carry labels. */
const phoneRow =
  "max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-4 max-md:gap-y-1.5 max-md:px-5 max-md:py-3 max-md:[grid-template-areas:'stage_confirmed'_'model_model'_'requests_failures']";
const phoneLabel =
  "max-md:before:mr-1.5 max-md:before:font-sans max-md:before:text-[11px] max-md:before:text-ink-muted max-md:before:content-[attr(data-label)]";
const headerCell = "px-3 py-2.5 font-normal first:pl-5 last:pr-5";
const bodyCell = "max-md:block md:px-3 md:py-3 md:align-top md:first:pl-5 md:last:pr-5";

function ModelTable({ models }: { models: Model[] }) {
  const { format, t } = useI18n();
  const headingId = useId();
  return (
    <Card className="min-w-0 px-0 pb-1">
      <div className="mb-3 flex items-center justify-between gap-3 px-5">
        <h2 className="m-0 text-[15px] font-semibold tracking-tight text-ink" id={headingId}>
          {t.costs.byModel}
        </h2>
        <HelpTip label={t.costs.chargedFailures} placement="left">
          {t.costs.chargedFailuresHelp}
        </HelpTip>
      </div>
      <table aria-labelledby={headingId} className="w-full border-collapse max-md:block">
        <thead className="max-md:hidden">
          <tr className="label-mono border-b border-line-soft text-ink-muted">
            <th className={`${headerCell} w-[22%] text-left`} scope="col">
              {t.costs.stage}
            </th>
            <th className={`${headerCell} text-left`} scope="col">
              {t.costs.model}
            </th>
            <th className={`${headerCell} text-right`} scope="col">
              {t.costs.requests}
            </th>
            <th className={`${headerCell} text-right`} scope="col">
              {t.costs.chargedFailures}
            </th>
            <th className={`${headerCell} text-right`} scope="col">
              {t.costs.confirmed}
            </th>
          </tr>
        </thead>
        <tbody className="max-md:block">
          {models.map((model) => (
            <tr
              className={`border-b border-line-soft last:border-0 ${phoneRow}`}
              key={`${model.phase}:${model.execution}:${model.provider}:${model.model ?? ""}`}
            >
              <td className={`${bodyCell} text-[12.5px] text-ink [grid-area:stage]`}>
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                  <span className={`size-2 shrink-0 rounded-full ${stageColor(model.phase)}`} />
                  {t.stages.titles[model.phase]}
                </span>
              </td>
              <td className={`${bodyCell} min-w-0 [grid-area:model]`}>
                <span className="block text-[12.5px] text-ink">{model.provider}</span>
                <span className="block font-mono text-[11px] text-ink-muted [overflow-wrap:anywhere]">
                  {model.model ?? t.costs.modelUnknown}
                </span>
              </td>
              <td
                className={`${bodyCell} font-mono text-[12px] text-ink-secondary [grid-area:requests] md:text-right ${phoneLabel}`}
                data-label={t.costs.requests}
              >
                {format.number(attemptsOf(model.attemptCounts))}
              </td>
              <td
                className={`${bodyCell} text-right font-mono text-[12px] whitespace-nowrap text-ink-secondary [grid-area:failures] ${phoneLabel}`}
                data-label={t.costs.chargedFailures}
              >
                {model.chargedFailures.count === 0
                  ? "—"
                  : `${format.number(model.chargedFailures.count)} · ${format.cost(model.chargedFailures.confirmed)}`}
              </td>
              <td
                className={`${bodyCell} text-right font-mono text-[12.5px] whitespace-nowrap text-ink [grid-area:confirmed]`}
              >
                {model.execution === "local" ? t.overview.noCharge : format.cost(model.confirmed)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function TopMeetings({ detail }: { detail: CostDetail }) {
  const { format, t } = useI18n();
  const headingId = useId();
  return (
    <Card className="min-w-0">
      <h2 className="m-0 mb-3 text-[15px] font-semibold tracking-tight text-ink" id={headingId}>
        {t.costs.topMeetings}
      </h2>
      {detail.topMeetings.length === 0 ? (
        <p className="m-0 text-[12.5px] text-ink-muted">{t.costs.topMeetingsEmpty}</p>
      ) : (
        <ol aria-labelledby={headingId} className="m-0 flex list-none flex-col p-0">
          {detail.topMeetings.map((meeting, index) => (
            <li className="border-b border-line-soft last:border-0" key={meeting.meetingId}>
              <Link
                className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-raised"
                to={`/history/${meeting.meetingId}`}
              >
                <span className="w-4 shrink-0 font-mono text-[11px] text-ink-dim">
                  {String(index + 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-ink">
                    {meeting.voiceChannelName ?? t.overview.channelUnavailable}
                  </span>
                  <span className="block font-mono text-[10.5px] text-ink-dim">
                    {format.shortDateTime(meeting.startedAt, detail.timeZone)}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[12px] text-ink-secondary">
                  {format.cost(meeting.confirmed)}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
