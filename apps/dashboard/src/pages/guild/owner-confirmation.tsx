import { CircleCheck, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { Button, FormError, Notice } from "../../components/ui";
import { useI18n } from "../../i18n/store";
import { ApiError, api } from "../../lib/api";

const refusals = ["guild_configuration_incomplete", "guild_owner_changed"] as const;
type ConfirmationFailure = (typeof refusals)[number] | "request_failed";

function failureOf(caught: unknown): ConfirmationFailure {
  const code = caught instanceof ApiError ? caught.code : undefined;
  return refusals.find((refusal) => refusal === code) ?? "request_failed";
}

export function OwnerConfirmation({
  guildId,
  onConfirmed,
  required,
}: {
  guildId: string;
  onConfirmed: () => void;
  required: boolean;
}) {
  const { t } = useI18n();
  const messages = t.guild.ownerConfirmation;
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [failure, setFailure] = useState<ConfirmationFailure>();

  async function confirm() {
    setBusy(true);
    setFailure(undefined);
    try {
      await api.activateGuild(guildId);
      setConfirmed(true);
      onConfirmed();
    } catch (caught) {
      setFailure(failureOf(caught));
    } finally {
      setBusy(false);
    }
  }

  if (confirmed) {
    return (
      <Notice icon={<CircleCheck className="mt-0.5 size-3.5 shrink-0" />} tone="ok">
        {messages.confirmed}
      </Notice>
    );
  }
  if (!required) return null;
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-warn/40 bg-surface p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-warn/10 text-warn">
          <ShieldAlert className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <strong className="text-[14px] font-semibold tracking-tight text-ink">
            {messages.title}
          </strong>
          <p className="m-0 text-[12.5px] leading-relaxed text-ink-muted">{messages.body}</p>
        </div>
      </div>
      {failure !== undefined && <FormError>{messages.failures[failure]}</FormError>}
      <Button className="self-start" disabled={busy} onClick={() => void confirm()} type="button">
        {busy ? messages.confirming : messages.confirm}
      </Button>
    </section>
  );
}
