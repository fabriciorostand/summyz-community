import { Eye, EyeOff, Pencil, Trash2 } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";

import { useI18n } from "../i18n/store";
import { api, type InstallationSecret } from "../lib/api";
import { Button, Field, FormError } from "./ui";

/**
 * What a locked field holds in place of a stored secret, which the server never sends back. The
 * field stays a read-only password input while it shows, so it only ever renders as dots.
 */
export const storedSecretMask = "storedsecretmask";

/** An icon action drawn inside a field box, such as the pencil or the trash. */
function FieldIconButton({
  children,
  disabled = false,
  label,
  onClick,
  pressed,
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  /** Set for a toggle, such as the eye. */
  pressed?: boolean;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={pressed}
      className="touch-target grid size-6 place-items-center rounded text-ink-dim transition-colors enabled:hover:bg-surface-inset enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

/** The pencil inside a locked secret field; it opens the field for a new value. */
export function EditSecretButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <FieldIconButton label={label} onClick={onClick}>
      <Pencil className="size-3.5" />
    </FieldIconButton>
  );
}

/** The eye inside an open secret field; it shows or hides what is being typed. */
export function RevealSecretButton({
  onToggle,
  revealed,
}: {
  onToggle: () => void;
  revealed: boolean;
}) {
  const { t } = useI18n();
  return (
    <FieldIconButton label={t.secretField.reveal} onClick={onToggle} pressed={revealed}>
      {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
    </FieldIconButton>
  );
}

/**
 * A stored secret is never sent back, so its field stays read-only until the pencil opens it.
 * Returns whether the field is open, moves the focus into it when the pencil does, and holds the
 * eye's state, which every lock or unlock hides again.
 */
export function useSecretEditing(configured: boolean): {
  editing: boolean;
  inputProps: { readOnly: boolean; type: "password" | "text"; value?: string };
  inputRef: RefObject<HTMLInputElement | null>;
  locked: boolean;
  revealed: boolean;
  setEditing: (editing: boolean) => void;
  toggleRevealed: () => void;
} {
  const [editing, setEditingState] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);
  const locked = configured && !editing;
  function setEditing(next: boolean) {
    setEditingState(next);
    setRevealed(false);
  }
  return {
    editing,
    // A locked field is always a password input, so the mask can never be revealed.
    inputProps: locked
      ? { readOnly: true, type: "password", value: storedSecretMask }
      : { readOnly: false, type: revealed ? "text" : "password" },
    inputRef,
    locked,
    revealed,
    setEditing,
    toggleRevealed: () => setRevealed((current) => !current),
  };
}

/**
 * The actions beside an open secret field: send the typed value, and leave the edit when the
 * field was opened over a stored value. Together they drop below the field on narrow screens.
 */
export function SecretEditActions({
  busy,
  editing,
  onCancel,
  onSubmit,
  submitLabel,
  value,
}: {
  busy: boolean;
  editing: boolean;
  onCancel: () => void;
  onSubmit: () => void;
  submitLabel: string;
  value: string;
}) {
  const { t } = useI18n();
  return (
    <div className="flex gap-2">
      <Button disabled={busy || value === ""} onClick={onSubmit} type="button" variant="secondary">
        {submitLabel}
      </Button>
      {editing && (
        <Button disabled={busy} onClick={onCancel} type="button" variant="ghost">
          {t.common.cancel}
        </Button>
      )}
    </div>
  );
}

/** Placeholder for an open write-only field; a locked one shows the mask instead. */
export function useSecretPlaceholder(configured: boolean, locked: boolean): string | undefined {
  const { secretField } = useI18n().t;
  if (locked) return undefined;
  return configured ? secretField.typeToReplace : secretField.notConfigured;
}

/**
 * Write-only field for an installation secret: the value never comes back from the server, so a
 * stored one shows as dots. An empty secret starts open for typing.
 */
export function SecretField({
  configured,
  editLabel,
  failedMessage,
  help,
  label,
  name,
  onChange,
  removeLabel,
}: {
  configured: boolean;
  editLabel: string;
  failedMessage: string;
  /** A help tip drawn beside the label. */
  help?: ReactNode;
  label: string;
  name: InstallationSecret;
  onChange: (configured: boolean) => void;
  removeLabel: string;
}) {
  const { t } = useI18n();
  const { editing, inputProps, inputRef, locked, revealed, setEditing, toggleRevealed } =
    useSecretEditing(configured);
  const placeholder = useSecretPlaceholder(configured, locked);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function run(action: () => Promise<void>, nextConfigured: boolean) {
    setBusy(true);
    setFailed(false);
    try {
      await action();
      setValue("");
      setEditing(false);
      onChange(nextConfigured);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setValue("");
    setFailed(false);
    setEditing(false);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* On narrow screens the actions drop below the field together instead of squeezing it. */}
      <div className="flex flex-wrap items-end gap-2">
        <Field
          autoComplete="off"
          className="min-w-48 flex-1"
          help={help}
          label={label}
          onChange={(event) => setValue(event.currentTarget.value)}
          placeholder={placeholder}
          ref={inputRef}
          value={value}
          {...inputProps}
          trailing={
            <>
              {locked ? (
                <EditSecretButton label={editLabel} onClick={() => setEditing(true)} />
              ) : (
                <RevealSecretButton onToggle={toggleRevealed} revealed={revealed} />
              )}
              <FieldIconButton
                disabled={busy || !configured}
                label={removeLabel}
                onClick={() => void run(() => api.removeSecret(name), false)}
              >
                <Trash2 className="size-3.5" />
              </FieldIconButton>
            </>
          }
        />
        {!locked && (
          <SecretEditActions
            busy={busy}
            editing={editing}
            onCancel={cancel}
            onSubmit={() => void run(() => api.updateSecret(name, value), true)}
            submitLabel={t.secretField.update}
            value={value}
          />
        )}
      </div>
      {failed && <FormError>{failedMessage}</FormError>}
    </div>
  );
}
