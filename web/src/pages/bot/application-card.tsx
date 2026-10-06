import { Check, TriangleAlert } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

import { ConfirmDialog } from "../../components/confirm-dialog";
import { CopyableValue } from "../../components/copyable-value";
import {
  EditSecretButton,
  RevealSecretButton,
  SecretEditActions,
  SecretField,
  useSecretEditing,
  useSecretPlaceholder,
} from "../../components/secret-field";
import {
  Card,
  DiscordIcon,
  Field,
  FormError,
  HelpTip,
  Label,
  Notice,
  SectionHeading,
} from "../../components/ui";
import { useI18n } from "../../i18n/store";
import { ApiError, api, type DashboardSettings } from "../../lib/api";

type TokenOutcome =
  | "rotated"
  | "applicationReplaced"
  | "invalid_discord_bot_token"
  | "active_recording"
  | "pending_meetings"
  | "failed";

const refusals = ["invalid_discord_bot_token", "active_recording", "pending_meetings"] as const;

/** The "?" beside a field label, explaining what Discord says the field is for. */
function FieldHelp({ children, field }: { children: string; field: string }) {
  const { help } = useI18n().t.bot.application;
  return <HelpTip label={help.about(field)}>{children}</HelpTip>;
}

/** A label above a read-only value, with its help tip beside it. */
function LabelWithHelp({ children, help }: { children: string; help: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <Label>{children}</Label>
      {help}
    </div>
  );
}

function outcomeOfFailure(caught: unknown): TokenOutcome {
  const code = caught instanceof ApiError ? caught.code : undefined;
  return refusals.find((refusal) => refusal === code) ?? "failed";
}

/** Everything the Discord Developer Portal holds for this application: token and OAuth2. */
export function DiscordApplicationCard({
  applicationId,
  clientSecretConfigured,
  onClientSecretChange,
  onReplaced,
  redirectUri,
  tokenConfigured,
}: {
  applicationId: string | null;
  clientSecretConfigured: boolean;
  onClientSecretChange: (configured: boolean) => void;
  /** The server derives the Application ID from the token, so the caller reloads the settings. */
  onReplaced: () => Promise<DashboardSettings | undefined>;
  redirectUri: string;
  tokenConfigured: boolean;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const messages = t.bot.application;
  return (
    <Card aria-labelledby={titleId} role="region">
      <SectionHeading
        icon={<DiscordIcon className="size-4" />}
        id={titleId}
        title={messages.title}
      />
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <LabelWithHelp
            help={<FieldHelp field="Application ID">{messages.help.applicationId}</FieldHelp>}
          >
            Application ID
          </LabelWithHelp>
          {applicationId === null ? (
            <span className="rounded-lg border border-line bg-surface-raised px-3 py-2 font-mono text-[12.5px] text-ink-dim">
              {t.secretField.notConfigured}
            </span>
          ) : (
            <CopyableValue copyLabel={messages.copyApplicationId} value={applicationId} />
          )}
        </div>
        <BotTokenField
          applicationId={applicationId}
          configured={tokenConfigured}
          onReplaced={onReplaced}
        />
        <SecretField
          configured={clientSecretConfigured}
          editLabel={messages.oauth.editClientSecret}
          failedMessage={messages.oauth.clientSecretFailed}
          help={
            <FieldHelp field={messages.oauth.clientSecret}>{messages.help.clientSecret}</FieldHelp>
          }
          label={messages.oauth.clientSecret}
          name="discord_client_secret"
          onChange={onClientSecretChange}
          removeLabel={messages.oauth.removeClientSecret}
        />
        <div className="flex flex-col gap-1.5">
          <LabelWithHelp
            help={
              <FieldHelp field={messages.oauth.redirectUri}>{messages.help.redirectUri}</FieldHelp>
            }
          >
            {messages.oauth.redirectUri}
          </LabelWithHelp>
          <CopyableValue copyLabel={messages.oauth.copyRedirectUri} value={redirectUri} />
        </div>
      </div>
    </Card>
  );
}

/**
 * The stored token stays locked behind the pencil. Opening it shows what a replacement does;
 * a confirmed replacement locks it again, while a refused one stays open to be fixed.
 */
function BotTokenField({
  applicationId,
  configured,
  onReplaced,
}: {
  applicationId: string | null;
  configured: boolean;
  onReplaced: () => Promise<DashboardSettings | undefined>;
}) {
  const messages = useI18n().t.bot.application;
  const { editing, inputProps, inputRef, locked, revealed, setEditing, toggleRevealed } =
    useSecretEditing(configured);
  const placeholder = useSecretPlaceholder(configured, locked);
  const [token, setToken] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<TokenOutcome>();

  async function replace() {
    setConfirming(false);
    setBusy(true);
    setOutcome(undefined);
    try {
      await api.replaceBotToken(token);
      setToken("");
      setEditing(false);
      // Another application wipes the owner connection, so the operator needs to know which.
      const next = await onReplaced();
      const replaced = next !== undefined && next.discordApplicationId !== applicationId;
      setOutcome(replaced ? "applicationReplaced" : "rotated");
    } catch (caught) {
      setOutcome(outcomeOfFailure(caught));
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setToken("");
    setOutcome(undefined);
    setEditing(false);
  }

  return (
    <>
      {/* On narrow screens the actions drop below the field together instead of squeezing it. */}
      <div className="flex flex-wrap items-end gap-2">
        <Field
          autoComplete="off"
          className="min-w-48 flex-1"
          help={<FieldHelp field={messages.botToken}>{messages.help.botToken}</FieldHelp>}
          label={messages.botToken}
          onChange={(event) => {
            setToken(event.currentTarget.value);
            setOutcome(undefined);
          }}
          placeholder={placeholder}
          ref={inputRef}
          value={token}
          {...inputProps}
          trailing={
            locked ? (
              <EditSecretButton
                label={messages.editToken}
                onClick={() => {
                  setOutcome(undefined);
                  setEditing(true);
                }}
              />
            ) : (
              <RevealSecretButton onToggle={toggleRevealed} revealed={revealed} />
            )
          }
        />
        {!locked && (
          <SecretEditActions
            busy={busy}
            editing={editing}
            onCancel={cancel}
            onSubmit={() => setConfirming(true)}
            submitLabel={busy ? messages.validating : messages.replace}
            value={token}
          />
        )}
      </div>
      {outcome !== undefined && <TokenOutcomeMessage outcome={outcome} />}
      {!locked && (
        <Notice icon={<TriangleAlert className="mt-0.5 size-3.5 shrink-0" />} tone="warn">
          {messages.tokenWarning}
        </Notice>
      )}
      <ConfirmDialog
        confirmLabel={messages.replaceDialog.confirm}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void replace()}
        open={confirming}
        title={messages.replaceDialog.title}
      >
        <p className="m-0">{messages.replaceDialog.sameApplication}</p>
        <p className="m-0">{messages.replaceDialog.otherApplication}</p>
      </ConfirmDialog>
    </>
  );
}

function TokenOutcomeMessage({ outcome }: { outcome: TokenOutcome }) {
  const messages = useI18n().t.bot.application;
  switch (outcome) {
    case "rotated":
      return (
        <p className="m-0 flex items-center gap-1.5 text-[12.5px] text-ok">
          <Check className="size-3.5" />
          {messages.tokenRotated}
        </p>
      );
    case "applicationReplaced":
      return (
        <Notice icon={<TriangleAlert className="mt-0.5 size-3.5 shrink-0" />} tone="warn">
          {messages.applicationReplaced}
        </Notice>
      );
    case "invalid_discord_bot_token":
      return <FormError>{messages.tokenRejected}</FormError>;
    case "active_recording":
    case "pending_meetings":
      return <FormError>{messages.tokenBlocked[outcome]}</FormError>;
    case "failed":
      return <FormError>{messages.tokenFailed}</FormError>;
  }
}
