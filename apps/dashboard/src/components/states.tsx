import { ClockAlert, KeyRound, RefreshCw, ServerCrash, ServerOff, Unplug } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { useI18n } from "../i18n/store";
import { Button, DiscordIcon } from "./ui";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />;
}

export function LoadingPanel({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5" role="status">
      <div className="grid grid-cols-3 gap-3">
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
      <Skeleton className="h-28" />
      <div className="flex items-center gap-2.5">
        <span className="live-dot size-1.5 rounded-full bg-accent" />
        <span className="text-[12px] text-ink-muted">{label ?? t.common.loading}</span>
      </div>
    </div>
  );
}

export function FullPageLoading() {
  const { t } = useI18n();
  return (
    <div className="grid min-h-screen place-items-center bg-canvas" role="status">
      <div className="flex items-center gap-2.5 text-[13px] text-ink-muted">
        <span className="live-dot size-1.5 rounded-full bg-accent" />
        {t.app.preparing}
      </div>
    </div>
  );
}

export function EmptyState({
  action,
  children,
  icon = <ServerOff className="size-5" />,
  secondaryAction,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  icon?: ReactNode;
  secondaryAction?: ReactNode;
  title: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface px-6 py-12 text-center">
      <span className="grid size-11 place-items-center rounded-xl bg-surface-inset text-ink-muted">
        {icon}
      </span>
      <h3 className="m-0 text-[16px] font-semibold tracking-tight text-ink">{title}</h3>
      <p className="m-0 max-w-md text-[13px] leading-relaxed text-ink-muted">{children}</p>
      {(action !== undefined || secondaryAction !== undefined) && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}

export function ErrorState({
  children,
  code,
  onRetry,
  retryLabel,
  secondaryAction,
  title,
}: {
  children: ReactNode;
  code?: string;
  onRetry?: () => void;
  /** Replaces "Try again" when retrying means something more specific, like reloading. */
  retryLabel?: string;
  secondaryAction?: ReactNode;
  title: string;
}) {
  const { t } = useI18n();
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface px-6 py-12 text-center"
      role="alert"
    >
      <span className="grid size-11 place-items-center rounded-xl bg-fail-soft text-fail">
        <Unplug className="size-5" />
      </span>
      <h3 className="m-0 text-[16px] font-semibold tracking-tight text-ink">{title}</h3>
      <p className="m-0 max-w-md text-[13px] leading-relaxed text-ink-muted">{children}</p>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
        {onRetry !== undefined && (
          <Button onClick={onRetry} type="button">
            <RefreshCw className="size-3.5" />
            {retryLabel ?? t.common.retry}
          </Button>
        )}
        {secondaryAction}
      </div>
      {code !== undefined && (
        <code className="mt-1 rounded bg-surface-inset px-2 py-1 font-mono text-[11px] text-ink-dim">
          {code}
        </code>
      )}
    </div>
  );
}

const primaryLinkClass =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-action-gradient px-3.5 py-2 text-[13.5px] font-medium text-white transition-colors hover:bg-action-gradient-hover";
export const secondaryLinkClass =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-surface-raised px-3.5 py-2 text-[13.5px] text-ink transition-colors hover:border-line-strong";

export function InstallBotLink({
  children,
  installUrl,
  variant = "primary",
}: {
  children?: ReactNode;
  installUrl: string | undefined;
  variant?: "primary" | "secondary";
}) {
  const { t } = useI18n();
  const label = children ?? t.states.installBot;
  const className = variant === "primary" ? primaryLinkClass : secondaryLinkClass;
  if (installUrl === undefined) {
    return (
      <span aria-disabled="true" className={`${className} cursor-not-allowed opacity-50`}>
        <DiscordIcon className="size-4" />
        {label}
      </span>
    );
  }
  return (
    <a className={className} href={installUrl} rel="noreferrer" target="_blank">
      <DiscordIcon className="size-4" />
      {label}
    </a>
  );
}

export function NoServerState({ installUrl }: { installUrl: string | undefined }) {
  const { t } = useI18n();
  return (
    <EmptyState
      action={<InstallBotLink installUrl={installUrl} />}
      icon={<ServerOff className="size-5" />}
      title={t.states.noServerTitle}
    >
      {t.states.noServerBody}
    </EmptyState>
  );
}

export function SessionExpiredState({ onUnlock }: { onUnlock: () => void }) {
  const { t } = useI18n();
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface px-6 py-12 text-center"
      role="alert"
    >
      <span className="grid size-11 place-items-center rounded-xl bg-warn/10 text-warn">
        <ClockAlert className="size-5" />
      </span>
      <h3 className="m-0 text-[16px] font-semibold tracking-tight text-ink">
        {t.states.sessionExpiredTitle}
      </h3>
      <p className="m-0 max-w-md text-[13px] leading-relaxed text-ink-muted">
        {t.states.sessionExpiredBody}
      </p>
      <Link className={`${primaryLinkClass} mt-1`} onClick={onUnlock} to="/login">
        <KeyRound className="size-3.5" />
        {t.states.unlock}
      </Link>
    </div>
  );
}

export function DiscordNotConnectedState() {
  const { t } = useI18n();
  return (
    <EmptyState icon={<DiscordIcon className="size-5" />} title={t.states.discordNotConnectedTitle}>
      {t.states.discordNotConnectedBody}
    </EmptyState>
  );
}

export function GuildRemovedState({
  guildName,
  installUrl,
}: {
  guildName: string | undefined;
  installUrl: string | undefined;
}) {
  const { t } = useI18n();
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface px-6 py-12 text-center"
      role="alert"
    >
      <span className="grid size-11 place-items-center rounded-xl bg-surface-inset text-ink-muted">
        <ServerCrash className="size-5" />
      </span>
      <h3 className="m-0 text-[16px] font-semibold tracking-tight text-ink">
        {t.states.guildRemovedTitle}
      </h3>
      <p className="m-0 max-w-md text-[13px] leading-relaxed text-ink-muted">
        {guildName === undefined ? (
          t.states.guildRemovedThisServer
        ) : (
          <strong className="text-ink">{guildName}</strong>
        )}{" "}
        {t.states.guildRemovedBody}
      </p>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
        <InstallBotLink installUrl={installUrl}>{t.states.addBack}</InstallBotLink>
        <Link className={secondaryLinkClass} to="/servers">
          {t.states.viewServers}
        </Link>
      </div>
    </div>
  );
}
