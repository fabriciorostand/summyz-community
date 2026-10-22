import { ConfirmDialog } from "../../components/confirm-dialog";
import { useI18n } from "../../i18n/store";

/** Asks before unsaved edits are thrown away; every close path means "keep editing". */
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
  return (
    <ConfirmDialog
      cancelLabel={discardDialog.keepEditing}
      confirmLabel={discardDialog.discard}
      onCancel={onKeep}
      onConfirm={onDiscard}
      open={open}
      title={discardDialog.title}
    >
      <p className="m-0">{discardDialog.body(name)}</p>
    </ConfirmDialog>
  );
}
