import { CircleAlert, CircleCheck, Info, UserRound } from "lucide-react";
import { useId } from "react";

import { CopyableValue } from "../../components/copyable-value";
import { DiscordConnectButton } from "../../components/discord-connect-button";
import { Card, Label, Notice, SectionHeading } from "../../components/ui";
import { useDiscordConnection } from "../../hooks/use-discord-connection";
import { useI18n } from "../../i18n/store";
import type { AccessMode } from "../../lib/api";
import { SecretField } from "./secret-field";

/**
 * The OAuth side of the Discord application: the Client Secret, the redirect URL Discord must
 * know and the owner account that unlocks the configuration of their servers.
 */
export function DiscordOwnerCard({
  accessMode,
  applicationId,
  clientSecretConfigured,
  onClientSecretChange,
  redirectUri,
}: {
  accessMode: AccessMode;
  applicationId: string | null;
  clientSecretConfigured: boolean;
  onClientSecretChange: (configured: boolean) => void;
  redirectUri: string;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const messages = t.installation.discordOwner;
  return (
    <Card aria-labelledby={titleId} role="region">
      <SectionHeading
        description={messages.description}
        icon={<UserRound className="size-4" />}
        id={titleId}
        title={messages.title}
      />
      <div className="flex flex-col gap-4">
        <SecretField
          configured={clientSecretConfigured}
          failedMessage={messages.clientSecretFailed}
          label={messages.clientSecret}
          name="discord_client_secret"
          onChange={onClientSecretChange}
          removeLabel={messages.removeClientSecret}
        />
        <div className="flex flex-col gap-1.5">
          <Label>{messages.redirectUri}</Label>
          <CopyableValue copyLabel={messages.copyRedirectUri} value={redirectUri} />
          <span className="text-[11.5px] text-ink-muted">{messages.redirectHint}</span>
        </div>
        <OwnerConnection
          applicationId={applicationId}
          clientSecretConfigured={clientSecretConfigured}
        />
        {accessMode === "public" && (
          <Notice icon={<Info className="mt-0.5 size-3.5 shrink-0" />}>
            {messages.publicSessionNotice}
          </Notice>
        )}
      </div>
    </Card>
  );
}

function OwnerConnection({
  applicationId,
  clientSecretConfigured,
}: {
  applicationId: string | null;
  clientSecretConfigured: boolean;
}) {
  const { t } = useI18n();
  const messages = t.installation.discordOwner;
  const { connection, loadFailed } = useDiscordConnection(applicationId);
  const connected = connection?.connected === true;
  return (
    <div className="flex flex-col gap-2.5 border-t border-line-soft pt-4">
      <ConnectionStatus connection={connection} loadFailed={loadFailed} />
      <DiscordConnectButton
        disabled={!clientSecretConfigured}
        label={connected ? messages.switchAccount : undefined}
        variant={connected ? "secondary" : "primary"}
      />
      {!clientSecretConfigured && (
        <span className="text-[11.5px] text-ink-muted">{messages.needsClientSecret}</span>
      )}
    </div>
  );
}

function ConnectionStatus({
  connection,
  loadFailed,
}: Pick<ReturnType<typeof useDiscordConnection>, "connection" | "loadFailed">) {
  const { t } = useI18n();
  const messages = t.installation.discordOwner;
  if (loadFailed) {
    return <span className="text-[12.5px] text-ink-muted">{messages.statusFailed}</span>;
  }
  if (connection === undefined) {
    return <span className="text-[12.5px] text-ink-muted">{t.common.loading}</span>;
  }
  return connection.connected ? (
    <span className="flex items-center gap-1.5 text-[12.5px] text-ok">
      <CircleCheck className="size-3.5" />
      {messages.connectedAs(connection.discordUsername)}
    </span>
  ) : (
    <span className="flex items-center gap-1.5 text-[12.5px] text-warn">
      <CircleAlert className="size-3.5" />
      {messages.notConnected}
    </span>
  );
}
