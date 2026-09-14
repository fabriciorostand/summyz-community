import { ClockAlert, KeyRound, RefreshCw, ServerCrash, ServerOff, Unplug } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { Button, DiscordIcon } from "./ui";

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

const primaryLinkClass =
  "inline-flex items-center gap-2 rounded-lg bg-action px-3.5 py-2 text-[13.5px] font-medium text-white transition-colors hover:bg-action-hover";
export const secondaryLinkClass =
  "inline-flex items-center gap-2 rounded-lg border border-line bg-surface-raised px-3.5 py-2 text-[13.5px] text-ink transition-colors hover:border-line-strong";

/** Link to Discord's authorization page; the backend builds the URL from the bot's own token. */
export function InstallBotLink({
  children = "Adicionar o bot a um servidor",
  installUrl,
  variant = "primary",
}: {
  children?: ReactNode;
  installUrl: string | undefined;
  variant?: "primary" | "secondary";
}) {
  const className = variant === "primary" ? primaryLinkClass : secondaryLinkClass;
  if (installUrl === undefined) {
    return (
      <span aria-disabled="true" className={`${className} cursor-not-allowed opacity-50`}>
        <DiscordIcon className="size-4" />
        {children}
      </span>
    );
  }
  return (
    <a className={className} href={installUrl} rel="noreferrer" target="_blank">
      <DiscordIcon className="size-4" />
      {children}
    </a>
  );
}

export function NoServerState({ installUrl }: { installUrl: string | undefined }) {
  return (
    <EmptyState
      action={<InstallBotLink installUrl={installUrl} />}
      icon={<ServerOff className="size-5" />}
      title="O bot ainda não está em nenhum servidor"
    >
      Autorize o bot em um servidor do Discord. Ele aparece aqui sozinho, sem precisar cadastrar
      nada.
    </EmptyState>
  );
}

/** Public mode only: the cookie is gone, so the operator has to type the installation password. */
export function SessionExpiredState({ onUnlock }: { onUnlock: () => void }) {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface px-6 py-12 text-center"
      role="alert"
    >
      <span className="grid size-11 place-items-center rounded-xl bg-warn/10 text-warn">
        <ClockAlert className="size-5" />
      </span>
      <h3 className="m-0 text-[16px] font-semibold tracking-tight text-ink">Sua sessão expirou</h3>
      <p className="m-0 max-w-md text-[13px] leading-relaxed text-ink-muted">
        A sessão cai após 7 dias sem uso, ou 30 dias no total. Digite a senha da instalação para
        continuar.
      </p>
      <Link className={`${primaryLinkClass} mt-1`} onClick={onUnlock} to="/login">
        <KeyRound className="size-3.5" />
        Desbloquear
      </Link>
    </div>
  );
}

/** The API answered 403 for this server: the bot left it, but nothing was deleted. */
export function GuildRemovedState({
  guildName,
  installUrl,
}: {
  guildName: string | undefined;
  installUrl: string | undefined;
}) {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface px-6 py-12 text-center"
      role="alert"
    >
      <span className="grid size-11 place-items-center rounded-xl bg-surface-inset text-ink-muted">
        <ServerCrash className="size-5" />
      </span>
      <h3 className="m-0 text-[16px] font-semibold tracking-tight text-ink">
        O bot não está mais neste servidor
      </h3>
      <p className="m-0 max-w-md text-[13px] leading-relaxed text-ink-muted">
        {guildName === undefined ? (
          "Este servidor"
        ) : (
          <strong className="text-ink">{guildName}</strong>
        )}{" "}
        saiu da lista porque o bot foi removido de lá. As calls e as configurações continuam no
        banco e reaparecem se ele for adicionado de novo.
      </p>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
        <InstallBotLink installUrl={installUrl}>Adicionar de volta</InstallBotLink>
        <Link className={secondaryLinkClass} to="/servers">
          Ver servidores
        </Link>
      </div>
    </div>
  );
}
