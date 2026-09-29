import { useEffect, useId, useRef } from "react";

import { Button } from "../../components/ui";
import { useI18n } from "../../i18n/store";

/**
 * Asks before unsaved edits are thrown away. The native modal dialog traps focus, closes on
 * Escape and returns focus to what opened it; every close path means "keep editing".
 */
export function DiscardDialog({
  name,
  onDiscard,
  onKeep,
  open,
}: {
  name: string;
  onDiscard: () => void;
  onKeep: () => void;
  open: boolean;
}) {
  const { discardDialog } = useI18n().t;
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
        onKeep();
      }}
      ref={ref}
    >
      {open && (
        <div className="flex flex-col gap-3">
          <h2 className="m-0 text-[15px] font-semibold" id={titleId}>
            {discardDialog.title}
          </h2>
          <p className="m-0 text-[12.5px] leading-relaxed text-ink-muted">
            {discardDialog.body(name)}
          </p>
          <div className="mt-1 flex flex-wrap justify-end gap-2">
            <Button autoFocus onClick={onKeep} type="button" variant="secondary">
              {discardDialog.keepEditing}
            </Button>
            <Button onClick={onDiscard} type="button" variant="danger">
              {discardDialog.discard}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
