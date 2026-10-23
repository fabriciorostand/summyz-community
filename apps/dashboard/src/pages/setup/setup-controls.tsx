import { TriangleAlert } from "lucide-react";

import { useI18n } from "../../i18n/store";

export type SetupFailure = "invalid_discord_bot_token" | "invalid_setup_token" | "request_failed";

/** The large gradient action of each setup step; its hover is guarded while disabled. */
export function PrimaryButton({
  busy,
  busyLabel,
  children,
  disabled = false,
}: {
  busy: boolean;
  busyLabel: string;
  children: string;
  disabled?: boolean;
}) {
  return (
    <button
      className="flex items-center justify-center gap-2 rounded-[10px] bg-action-gradient px-6 py-3 text-[14px] font-medium text-white transition-colors enabled:hover:bg-action-gradient-hover disabled:cursor-not-allowed disabled:bg-surface-inset disabled:bg-none disabled:text-ink-dim"
      disabled={busy || disabled}
      type="submit"
    >
      {busy ? (
        <>
          <span className="live-dot size-1.5 rounded-full bg-white" />
          {busyLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** Outlined companion of the primary action, such as going back or skipping a step. */
export function SecondaryButton({
  children,
  disabled = false,
  onClick,
}: {
  children: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="rounded-[10px] border border-line px-4.5 py-3 text-[14px] text-ink-secondary transition-colors enabled:hover:border-line-strong enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

export function FailureLine({ failure }: { failure: SetupFailure }) {
  const { t } = useI18n();
  return (
    <div className="mt-2.5 flex items-start gap-2" role="alert">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-fail" />
      <span className="text-[12.5px] text-fail">{t.setup.failures[failure]}</span>
    </div>
  );
}
