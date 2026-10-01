import { Check, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "../../components/confirm-dialog";
import { CopyableValue } from "../../components/copyable-value";
import {
  Button,
  Card,
  DiscordIcon,
  Field,
  FormError,
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

function outcomeOfFailure(caught: unknown): TokenOutcome {
  const code = caught instanceof ApiError ? caught.code : undefined;
  return refusals.find((refusal) => refusal === code) ?? "failed";
}

export function DiscordApplicationCard({
  applicationId,
  onReplaced,
  tokenConfigured,
}: {
  applicationId: string | null;
  /** The server derives the Application ID from the token, so the caller reloads the settings. */
  onReplaced: () => Promise<DashboardSettings | undefined>;
  tokenConfigured: boolean;
}) {
  const { t } = useI18n();
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

  return (
    <Card>
      <SectionHeading
        icon={<DiscordIcon className="size-4" />}
        title={t.installation.discordApplication}
      />
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Application ID</Label>
          {applicationId === null ? (
            <span className="rounded-lg border border-line bg-surface-raised px-3 py-2 font-mono text-[12.5px] text-ink-dim">
              {t.installation.notConfigured}
            </span>
          ) : (
            <CopyableValue copyLabel={t.installation.copyApplicationId} value={applicationId} />
          )}
        </div>
        <div className="flex items-end gap-2">
          <Field
            autoComplete="off"
            className="flex-1"
            label={t.installation.botToken}
            onChange={(event) => {
              setToken(event.currentTarget.value);
              setOutcome(undefined);
            }}
            placeholder={
              tokenConfigured ? t.installation.configuredReplace : t.installation.notConfigured
            }
            type="password"
            value={token}
          />
          <Button
            disabled={busy || token === ""}
            onClick={() => setConfirming(true)}
            type="button"
            variant="secondary"
          >
            {busy ? t.installation.validating : t.installation.replace}
          </Button>
        </div>
        {outcome !== undefined && <TokenOutcomeMessage outcome={outcome} />}
        <Notice icon={<TriangleAlert className="mt-0.5 size-3.5 shrink-0" />} tone="warn">
          {t.installation.tokenWarning}
        </Notice>
      </div>
      <ConfirmDialog
        confirmLabel={t.installation.replaceDialog.confirm}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void replace()}
        open={confirming}
        title={t.installation.replaceDialog.title}
      >
        <p className="m-0">{t.installation.replaceDialog.sameApplication}</p>
        <p className="m-0">{t.installation.replaceDialog.otherApplication}</p>
      </ConfirmDialog>
    </Card>
  );
}

function TokenOutcomeMessage({ outcome }: { outcome: TokenOutcome }) {
  const { t } = useI18n();
  switch (outcome) {
    case "rotated":
      return (
        <p className="m-0 flex items-center gap-1.5 text-[12.5px] text-ok">
          <Check className="size-3.5" />
          {t.installation.tokenRotated}
        </p>
      );
    case "applicationReplaced":
      return (
        <Notice icon={<TriangleAlert className="mt-0.5 size-3.5 shrink-0" />} tone="warn">
          {t.installation.applicationReplaced}
        </Notice>
      );
    case "invalid_discord_bot_token":
      return <FormError>{t.installation.tokenRejected}</FormError>;
    case "active_recording":
    case "pending_meetings":
      return <FormError>{t.installation.tokenBlocked[outcome]}</FormError>;
    case "failed":
      return <FormError>{t.installation.tokenFailed}</FormError>;
  }
}
