import { Pencil, Trash2 } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";

import { useI18n } from "../i18n/store";
import { api, type InstallationSecret } from "../lib/api";
import { Button, Field, FormError } from "./ui";

/** An icon action drawn inside a field box, such as the pencil or the trash. */
function FieldIconButton({
  children,
  disabled = false,
  label,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
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

/**
 * A stored secret is never sent back, so its field stays read-only until the pencil opens it.
 * Returns whether the field is open and moves the focus into it when the pencil does.
 */
export function useSecretEditing(configured: boolean): {
  editing: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  locked: boolean;
  setEditing: (editing: boolean) => void;
} {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);
  return { editing, inputRef, locked: configured && !editing, setEditing };
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

/** Placeholder for a write-only field: locked, open over a stored value, or still empty. */
export function useSecretPlaceholder(configured: boolean, locked: boolean): string {
  const { secretField } = useI18n().t;
  if (locked) return secretField.configured;
  return configured ? secretField.configuredReplace : secretField.notConfigured;
}

/**
 * Write-only field for an installation secret: the value never comes back from the server, so
 * the placeholder only says whether one is stored. An empty secret starts open for typing.
 */
export function SecretField({
  configured,
  editLabel,
  failedMessage,
  label,
  name,
  onChange,
  removeLabel,
}: {
  configured: boolean;
  editLabel: string;
  failedMessage: string;
  label: string;
  name: InstallationSecret;
  onChange: (configured: boolean) => void;
  removeLabel: string;
}) {
  const { t } = useI18n();
  const { editing, inputRef, locked, setEditing } = useSecretEditing(configured);
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
          label={label}
          onChange={(event) => setValue(event.currentTarget.value)}
          placeholder={placeholder}
          readOnly={locked}
          ref={inputRef}
          trailing={
            <>
              {locked && <EditSecretButton label={editLabel} onClick={() => setEditing(true)} />}
              <FieldIconButton
                disabled={busy || !configured}
                label={removeLabel}
                onClick={() => void run(() => api.removeSecret(name), false)}
              >
                <Trash2 className="size-3.5" />
              </FieldIconButton>
            </>
          }
          type="password"
          value={value}
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
