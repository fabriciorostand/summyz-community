import type { FormEvent } from "react";

import { CopyableValue } from "../../components/copyable-value";
import { HelpTip } from "../../components/ui";
import { useI18n } from "../../i18n/store";
import { FailureLine, PrimaryButton, SecondaryButton, type SetupFailure } from "./setup-controls";

/**
 * Optional: the Client Secret lets the owner's Discord account be connected right after the
 * setup. Skipping it keeps the setup short; Installation offers the same fields later.
 */
export function DiscordStep({
  busy,
  clientSecret,
  failure,
  isLastStep,
  onBack,
  onChange,
  onSkip,
  onSubmit,
  redirectUri,
}: {
  busy: boolean;
  clientSecret: string;
  failure: SetupFailure | undefined;
  /** Local mode has no password step, so this step finishes the setup. */
  isLastStep: boolean;
  onBack: () => void;
  onChange: (value: string) => void;
  onSkip: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** Read from the server; undefined while it loads or when the status check fails. */
  redirectUri: string | undefined;
}) {
  const { t } = useI18n();
  return (
    <form className="w-full max-w-[420px]" onSubmit={onSubmit}>
      <div className="flex items-center gap-2">
        <h2 className="m-0 text-[23px] font-semibold tracking-tight text-ink">
          {t.setup.discordTitle}
        </h2>
        <HelpTip placement="left">{t.setup.discordHelp}</HelpTip>
      </div>
      <input
        aria-label={t.setup.clientSecretLabel}
        autoComplete="off"
        className="mt-6 w-full rounded-[11px] border border-line-strong bg-surface px-4.5 py-4 text-base text-ink pointer-fine:text-[15px] outline-none transition-colors placeholder:text-ink-dim focus:border-action"
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={t.setup.clientSecretLabel}
        type="password"
        value={clientSecret}
      />
      {failure !== undefined && <FailureLine failure={failure} />}
      {redirectUri !== undefined && (
        <div className="mt-4 flex flex-col gap-1.5">
          <span className="text-[12.5px] text-ink-muted">{t.setup.redirectLabel}</span>
          <CopyableValue copyLabel={t.setup.copyRedirect} value={redirectUri} />
        </div>
      )}
      <div className="mt-6 flex flex-wrap items-center gap-2.5">
        <PrimaryButton
          busy={busy}
          busyLabel={t.setup.finishing}
          disabled={clientSecret.trim().length === 0}
        >
          {isLastStep ? t.setup.finish : t.setup.continue}
        </PrimaryButton>
        <SecondaryButton disabled={busy} onClick={onSkip}>
          {t.setup.skip}
        </SecondaryButton>
        <SecondaryButton disabled={busy} onClick={onBack}>
          {t.setup.back}
        </SecondaryButton>
      </div>
    </form>
  );
}
