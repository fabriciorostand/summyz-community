import { useState } from "react";

import { Badge, Button, TextAreaField } from "../../components/ui";
import { useI18n } from "../../i18n/store";
import type { Profile } from "../../lib/api";

const actionClass = "px-2.5 py-1.5 text-[12.5px]";

type PendingAction = "disable" | "restore";
export type PromptMode = Profile["promptModes"]["refinement"];
export interface PromptChoice {
  mode: PromptMode;
  value: string | null;
}
/** The default the server applies, and the same default as it reads in the dashboard language. */
export interface PromptDefault {
  sent: string;
  shown: string;
}

function PromptConfirmation({
  action,
  onCancel,
  onConfirm,
}: {
  action: PendingAction;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const copy = t.promptEditor.confirmations[action];
  return (
    <div
      aria-label={copy.label}
      className="flex flex-col gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3.5 py-3"
      role="alertdialog"
    >
      <strong className="text-[12.5px] text-ink">{copy.title}</strong>
      <span className="text-[11.5px] leading-relaxed text-ink-muted">{copy.text}</span>
      <div className="flex gap-2">
        <Button className={actionClass} onClick={onCancel} type="button" variant="secondary">
          {t.common.cancel}
        </Button>
        <Button
          className={actionClass}
          onClick={onConfirm}
          type="button"
          variant={action === "disable" ? "danger" : "primary"}
        >
          {copy.action}
        </Button>
      </div>
    </div>
  );
}

function PromptText({
  canRestore,
  editing,
  label,
  onChange,
  onEditingChange,
  onPending,
  value,
}: {
  canRestore: boolean;
  editing: boolean;
  label: string;
  onChange: (value: string) => void;
  onEditingChange: (editing: boolean) => void;
  onPending: (action: PendingAction) => void;
  value: string;
}) {
  const { t } = useI18n();
  if (!editing) {
    return (
      <>
        <p className="m-0 line-clamp-2 font-mono text-[11.5px] leading-relaxed text-ink-secondary">
          {value}
        </p>
        <Button
          className={`${actionClass} self-start`}
          onClick={() => onEditingChange(true)}
          type="button"
          variant="secondary"
        >
          {t.promptEditor.editPrompt}
        </Button>
      </>
    );
  }
  return (
    <>
      <TextAreaField
        hint={t.promptEditor.hint}
        label={label}
        maxLength={20_000}
        onChange={(event) => onChange(event.currentTarget.value)}
        required
        rows={8}
        value={value}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          className={actionClass}
          onClick={() => onEditingChange(false)}
          type="button"
          variant="secondary"
        >
          {t.promptEditor.closeEditor}
        </Button>
        {canRestore && (
          <Button
            className={actionClass}
            onClick={() => onPending("restore")}
            type="button"
            variant="ghost"
          >
            {t.promptEditor.restoreDefault}
          </Button>
        )}
        <Button
          className={actionClass}
          onClick={() => onPending("disable")}
          type="button"
          variant="ghost"
        >
          {t.promptEditor.dontSend}
        </Button>
      </div>
    </>
  );
}

/**
 * A prompt is either the server default, custom text, or removed so only the immutable base
 * prompt is sent. The mode says which, so a default keeps following the summary language and
 * reads in the dashboard language, while custom text is kept exactly as written. The first edit
 * of a default makes it custom; both destructive moves ask for confirmation.
 */
export function PromptEditor({
  defaultPrompt,
  label,
  mode,
  onChange,
  value,
}: {
  /** Undefined while the defaults are unavailable; restoring needs the text the server sends. */
  defaultPrompt: PromptDefault | undefined;
  label: string;
  mode: PromptMode;
  onChange: (choice: PromptChoice) => void;
  value: string | null;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const isDefault = mode === "default";
  const sent = isDefault || value !== null;
  const shown = isDefault ? (defaultPrompt?.shown ?? value ?? "") : (value ?? "");
  const state = !sent
    ? t.promptEditor.notSent
    : isDefault
      ? t.promptEditor.default
      : t.promptEditor.custom;

  function restoreDefault() {
    if (defaultPrompt !== undefined) onChange({ mode: "default", value: defaultPrompt.sent });
  }

  function confirm() {
    if (pending === "disable") {
      onChange({ mode: "custom", value: null });
      setEditing(false);
    }
    if (pending === "restore") restoreDefault();
    setPending(null);
  }

  return (
    <section className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface-raised px-3.5 py-3 sm:col-span-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <strong className="min-w-0 flex-1 text-[13px] font-medium text-ink">{label}</strong>
        <Badge tone={sent && !isDefault ? "action" : "neutral"}>{state}</Badge>
      </div>
      {sent ? (
        <PromptText
          canRestore={defaultPrompt !== undefined && !isDefault}
          editing={editing}
          label={label}
          onChange={(text) => onChange({ mode: "custom", value: text })}
          onEditingChange={setEditing}
          onPending={setPending}
          value={shown}
        />
      ) : (
        <>
          <p className="m-0 text-[12px] leading-relaxed text-ink-muted">
            {t.promptEditor.noPrompt}
          </p>
          <Button
            className={`${actionClass} self-start`}
            onClick={() => {
              if (defaultPrompt === undefined) {
                onChange({ mode: "custom", value: "" });
                setEditing(true);
              } else {
                restoreDefault();
              }
            }}
            type="button"
            variant="secondary"
          >
            {defaultPrompt === undefined ? t.promptEditor.writePrompt : t.promptEditor.useDefault}
          </Button>
        </>
      )}
      {pending !== null && (
        <PromptConfirmation
          action={pending}
          onCancel={() => setPending(null)}
          onConfirm={confirm}
        />
      )}
    </section>
  );
}
