import { type ReactNode, useEffect, useId, useRef } from "react";

import { useI18n } from "../i18n/store";
import { Button } from "./ui";

export function ConfirmDialog({
  cancelLabel,
  children,
  confirmLabel,
  confirmTone = "danger",
  onCancel,
  onConfirm,
  open,
  title,
}: {
  cancelLabel?: string;
  children: ReactNode;
  confirmLabel: string;
  /** Red for actions that lose something; the action color for steps that only move on. */
  confirmTone?: "danger" | "primary";
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      aria-labelledby={titleId}
      className="m-auto w-[min(400px,calc(100vw-2rem))] rounded-2xl border border-line-strong bg-surface p-5 text-ink backdrop:bg-black/60"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      ref={ref}
    >
      {open && (
        <div className="flex flex-col gap-3">
          <h2 className="m-0 text-[15px] font-semibold" id={titleId}>
            {title}
          </h2>
          <div className="flex flex-col gap-2 text-[12.5px] leading-relaxed text-ink-muted">
            {children}
          </div>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            <Button autoFocus onClick={onCancel} type="button" variant="secondary">
              {cancelLabel ?? t.common.cancel}
            </Button>
            <Button onClick={onConfirm} type="button" variant={confirmTone}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
