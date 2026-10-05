import { ArrowLeftRight } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Link } from "react-router-dom";

import { ConfirmDialog } from "../components/confirm-dialog";
import { Skeleton } from "../components/states";
import { Button, DiscordIcon, FormError } from "../components/ui";
import { useDiscordConnect, useDiscordConnection } from "../hooks/use-discord-connection";
import { useI18n } from "../i18n/store";
import type { DashboardSettings } from "../lib/api";

/**
 * The Discord account that owns the servers, at the foot of the sidebar: its photo and name with
 * a switch action, or a connect button. Both need the bot token and the Client Secret first.
 */
export function SidebarAccount({
  onNavigate,
  settings,
}: {
  onNavigate?: (() => void) | undefined;
  settings: DashboardSettings;
}) {
  const messages = useI18n().t.ownerAccount;
  const titleId = useId();
  const { connection, loadFailed } = useDiscordConnection(settings.discordApplicationId);
  const { discordBotToken, discordClientSecret } = settings.secrets;
  const blockedBy = !discordBotToken
    ? messages.tokenMissing
    : !discordClientSecret
      ? messages.clientSecretMissing
      : undefined;
  const isPublic = settings.accessMode === "public";

  return (
    <section
      aria-labelledby={titleId}
      className="mt-3 flex flex-col gap-2 border-t border-line-soft pt-3"
    >
      <h2 className="sr-only" id={titleId}>
        {messages.title}
      </h2>
      {loadFailed ? (
        <p className="m-0 px-1 text-[11.5px] leading-relaxed text-ink-muted">
          {messages.statusFailed}
        </p>
      ) : connection === undefined ? (
        <Skeleton className="h-9" />
      ) : (
        <>
          {connection.connected ? (
            <ConnectedAccount
              avatarUrl={connection.avatarUrl}
              blocked={blockedBy !== undefined}
              isPublic={isPublic}
              name={connection.discordUsername}
            />
          ) : (
            <ConnectButton blocked={blockedBy !== undefined} isPublic={isPublic} />
          )}
          {blockedBy !== undefined && (
            <Link
              className="px-1 text-[11.5px] leading-relaxed text-accent hover:text-accent-hover"
              onClick={onNavigate}
              to="/bot"
            >
              {blockedBy}
            </Link>
          )}
        </>
      )}
    </section>
  );
}

function ConnectedAccount({
  avatarUrl,
  blocked,
  isPublic,
  name,
}: {
  avatarUrl: string | null;
  blocked: boolean;
  isPublic: boolean;
  name: string;
}) {
  const messages = useI18n().t.ownerAccount;
  const { ask, connecting, dialog, failureMessage } = useConfirmedConnect();
  return (
    <>
      <div className="flex items-center gap-2.5 px-1">
        <AccountPhoto avatarUrl={avatarUrl} name={name} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink" title={name}>
          {name}
        </span>
        <Button
          aria-label={messages.switchAccount}
          className="touch-target px-2"
          disabled={blocked || connecting}
          onClick={ask}
          title={messages.switchAccount}
          type="button"
          variant="ghost"
        >
          <ArrowLeftRight className="size-4" />
        </Button>
      </div>
      {failureMessage}
      <ConfirmDialog
        {...dialog}
        confirmLabel={messages.switchDialog.confirm}
        title={messages.switchDialog.title}
      >
        <p className="m-0">{messages.switchDialog.body}</p>
        {isPublic && <p className="m-0">{messages.switchDialog.publicNotice}</p>}
      </ConfirmDialog>
    </>
  );
}

function ConnectButton({ blocked, isPublic }: { blocked: boolean; isPublic: boolean }) {
  const { t } = useI18n();
  const messages = t.ownerAccount;
  const { ask, connect, connecting, dialog, failureMessage } = useConfirmedConnect();
  return (
    <>
      <Button
        className="w-full"
        disabled={blocked || connecting}
        // Public mode ends the dashboard session on return, so it asks first.
        onClick={isPublic ? ask : connect}
        type="button"
      >
        <DiscordIcon className="size-4" />
        {connecting ? t.discordConnect.connecting : messages.connect}
      </Button>
      {failureMessage}
      <ConfirmDialog
        {...dialog}
        confirmLabel={messages.connectDialog.confirm}
        confirmTone="primary"
        title={messages.connectDialog.title}
      >
        <p className="m-0">{messages.connectDialog.body}</p>
      </ConfirmDialog>
    </>
  );
}

/** Discord shows people in circles; the initial stands in until a photo arrives or loads. */
function AccountPhoto({ avatarUrl, name }: { avatarUrl: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  if (avatarUrl !== null && !broken) {
    return (
      <img
        alt=""
        className="size-8 shrink-0 rounded-full object-cover"
        onError={() => setBroken(true)}
        referrerPolicy="no-referrer"
        src={avatarUrl}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="grid size-8 shrink-0 place-items-center rounded-full border border-action/40 bg-action-soft text-[13px] font-semibold text-accent"
    >
      {[...name.trim()][0]?.toLocaleUpperCase() ?? "?"}
    </span>
  );
}

/** Starts the Discord authorization, directly or after a confirmation dialog. */
function useConfirmedConnect(): {
  ask: () => void;
  connect: () => void;
  connecting: boolean;
  dialog: { onCancel: () => void; onConfirm: () => void; open: boolean };
  failureMessage: ReactNode;
} {
  const { t } = useI18n();
  const { connect, connecting, failure } = useDiscordConnect();
  const [confirming, setConfirming] = useState(false);
  return {
    ask: () => setConfirming(true),
    connect: () => void connect(),
    connecting,
    dialog: {
      onCancel: () => setConfirming(false),
      onConfirm: () => {
        setConfirming(false);
        void connect();
      },
      open: confirming,
    },
    failureMessage:
      failure === undefined ? null : <FormError>{t.discordConnect.failures[failure]}</FormError>,
  };
}
