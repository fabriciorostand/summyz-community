import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { Notice } from "../../components/ui";
import { useDiscordConnection } from "../../hooks/use-discord-connection";
import { useI18n } from "../../i18n/store";

/**
 * Without the owner's account the list only holds history. The banner only warns: connecting
 * happens from the account at the foot of the sidebar.
 */
export function ConnectOwnerBanner() {
  const { t } = useI18n();
  const { connection } = useDiscordConnection();
  if (connection?.connected !== false) return null;
  return (
    <section className="flex flex-col gap-1 rounded-xl border border-warn/40 bg-surface p-5">
      <strong className="text-[14px] font-semibold tracking-tight text-ink">
        {t.servers.connectTitle}
      </strong>
      <p className="m-0 text-[12.5px] leading-relaxed text-ink-muted">{t.servers.connectBody}</p>
    </section>
  );
}

const outcomes = {
  cancelled: { icon: Info, tone: "neutral" },
  connected: { icon: CircleCheck, tone: "ok" },
  failed: { icon: CircleAlert, tone: "fail" },
  invalid_state: { icon: CircleAlert, tone: "fail" },
} as const;

type Outcome = keyof typeof outcomes;

function isOutcome(value: string | null): value is Outcome {
  return value !== null && Object.hasOwn(outcomes, value);
}

/** The OAuth callback lands here with `?discord=<outcome>`; dismissing it clears the query. */
export function OAuthResultNotice() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const outcome = searchParams.get("discord");
  if (!isOutcome(outcome)) return null;
  const { icon: Icon, tone } = outcomes[outcome];
  return (
    <Notice
      action={
        <button
          aria-label={t.servers.dismiss}
          className="touch-target grid size-5 shrink-0 place-items-center rounded opacity-70 transition-opacity hover:opacity-100"
          onClick={() =>
            setSearchParams(
              (current) => {
                const next = new URLSearchParams(current);
                next.delete("discord");
                return next;
              },
              { replace: true },
            )
          }
          type="button"
        >
          <X className="size-3.5" />
        </button>
      }
      icon={<Icon className="mt-0.5 size-3.5 shrink-0" />}
      tone={tone}
    >
      {t.servers.oauthResults[outcome]}
    </Notice>
  );
}
