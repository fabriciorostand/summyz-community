import { RefreshCw, ServerOff, Unplug } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "./ui";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />;
}

export function LoadingPanel({ label = "Carregando…" }: { label?: string }) {
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
        <span className="text-[12px] text-ink-muted">{label}</span>
      </div>
    </div>
  );
}

export function FullPageLoading() {
  return (
    <div className="grid min-h-screen place-items-center bg-canvas" role="status">
      <div className="flex items-center gap-2.5 text-[13px] text-ink-muted">
        <span className="live-dot size-1.5 rounded-full bg-accent" />
        Preparando o Summyz Community…
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
  secondaryAction,
  title,
}: {
  children: ReactNode;
  code?: string;
  onRetry?: () => void;
  secondaryAction?: ReactNode;
  title: string;
}) {
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
            Tentar novamente
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
