import { useState } from "react";

import { Badge, Button, TextAreaField } from "../../components/ui";

const actionClass = "px-2.5 py-1.5 text-[12.5px]";

type PendingAction = "disable" | "restore";

const confirmations: Record<
  PendingAction,
  { action: string; label: string; text: string; title: string }
> = {
  disable: {
    action: "Não enviar",
    label: "Não enviar prompt",
    text: "O texto editável será removido do perfil. O prompt-base continua sendo enviado.",
    title: "Parar de enviar este prompt?",
  },
  restore: {
    action: "Restaurar prompt padrão",
    label: "Restaurar padrão",
    text: "A personalização atual será substituída pelo prompt padrão.",
    title: "Restaurar o prompt padrão?",
  },
};

function PromptConfirmation({
  action,
  onCancel,
  onConfirm,
}: {
  action: PendingAction;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const copy = confirmations[action];
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
          Cancelar
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
          Editar prompt
        </Button>
      </>
    );
  }
  return (
    <>
      <TextAreaField
        hint="O texto completo é enviado ao modelo junto com o prompt-base. Limite de 20.000 caracteres."
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
          Fechar editor
        </Button>
        {canRestore && (
          <Button
            className={actionClass}
            onClick={() => onPending("restore")}
            type="button"
            variant="ghost"
          >
            Restaurar padrão
          </Button>
        )}
        <Button
          className={actionClass}
          onClick={() => onPending("disable")}
          type="button"
          variant="ghost"
        >
          Não enviar este prompt
        </Button>
      </div>
    </>
  );
}

/**
 * A prompt can be customised, or removed so only the immutable base prompt is sent.
 * Both destructive moves ask for confirmation because they overwrite written text.
 */
export function PromptEditor({
  defaultPrompt,
  label,
  onChange,
  value,
}: {
  defaultPrompt: string | null | undefined;
  label: string;
  onChange: (value: string | null) => void;
  value: string | null | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const hasDefault = defaultPrompt !== undefined && defaultPrompt !== null;
  const sent = value !== null && value !== undefined;
  const state = !sent ? "Não enviado" : value === defaultPrompt ? "Padrão" : "Personalizado";

  function confirm() {
    if (pending === "disable") {
      onChange(null);
      setEditing(false);
    }
    if (pending === "restore" && hasDefault) onChange(defaultPrompt);
    setPending(null);
  }

  return (
    <section className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface-raised px-3.5 py-3 sm:col-span-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <strong className="min-w-0 flex-1 text-[13px] font-medium text-ink">{label}</strong>
        <Badge tone={state === "Personalizado" ? "action" : "neutral"}>{state}</Badge>
      </div>
      {sent ? (
        <PromptText
          canRestore={hasDefault && value !== defaultPrompt}
          editing={editing}
          label={label}
          onChange={onChange}
          onEditingChange={setEditing}
          onPending={setPending}
          value={value}
        />
      ) : (
        <>
          <p className="m-0 text-[12px] leading-relaxed text-ink-muted">
            Sem prompt. O prompt-base do Summyz continua sendo enviado.
          </p>
          <Button
            className={`${actionClass} self-start`}
            onClick={() => {
              onChange(hasDefault ? defaultPrompt : "");
              setEditing(!hasDefault);
            }}
            type="button"
            variant="secondary"
          >
            {hasDefault ? "Usar prompt padrão" : "Escrever prompt"}
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
