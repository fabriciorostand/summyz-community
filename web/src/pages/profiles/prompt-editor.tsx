import { useState } from "react";

import { Button, TextAreaField, Toggle } from "../../components/ui";

/**
 * A prompt can be customised, or removed so only the immutable base prompt is sent.
 * Both destructive moves ask for confirmation because they overwrite written text.
 */
export function PromptEditor({
  defaultPrompt,
  label,
  onChange,
  toggleLabel,
  value,
}: {
  defaultPrompt: string | null | undefined;
  label: string;
  onChange: (value: string | null) => void;
  toggleLabel: string;
  value: string | null | undefined;
}) {
  const [pendingAction, setPendingAction] = useState<"disable" | "restore" | null>(null);
  const enabled = value !== null && value !== undefined;
  const hasDefault = defaultPrompt !== undefined && defaultPrompt !== null;

  function confirmPendingAction() {
    if (pendingAction === "disable") onChange(null);
    if (pendingAction === "restore" && hasDefault) onChange(defaultPrompt);
    setPendingAction(null);
  }

  return (
    <section className="flex flex-col gap-3">
      <Toggle
        checked={enabled}
        description="Desative para remover somente a personalização; o prompt-base continuará ativo."
        label={toggleLabel}
        onChange={(checked) => {
          if (checked) onChange(defaultPrompt ?? "");
          else setPendingAction("disable");
        }}
      />
      {enabled ? (
        <>
          <TextAreaField
            hint="O texto completo será enviado ao modelo. Limite de 20.000 caracteres."
            label={label}
            maxLength={20_000}
            onChange={(event) => onChange(event.currentTarget.value)}
            required
            rows={7}
            value={value}
          />
          {hasDefault && value !== defaultPrompt && (
            <Button
              className="self-start"
              onClick={() => setPendingAction("restore")}
              type="button"
              variant="secondary"
            >
              Restaurar padrão
            </Button>
          )}
        </>
      ) : (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-line bg-surface-raised px-3.5 py-3">
          <strong className="text-[12.5px] text-ink">Sem prompt</strong>
          <span className="text-[11.5px] leading-relaxed text-ink-muted">
            O prompt-base imutável do Summyz Community continuará ativo.
          </span>
          {hasDefault && (
            <Button onClick={() => onChange(defaultPrompt)} type="button" variant="secondary">
              Usar prompt padrão
            </Button>
          )}
        </div>
      )}
      {pendingAction !== null && (
        <div
          aria-label={pendingAction === "disable" ? "Desativar prompt" : "Restaurar prompt"}
          className="flex flex-col gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3.5 py-3"
          role="alertdialog"
        >
          <strong className="text-[12.5px] text-ink">
            {pendingAction === "disable" ? "Desativar este prompt?" : "Restaurar o padrão?"}
          </strong>
          <span className="text-[11.5px] leading-relaxed text-ink-muted">
            {pendingAction === "disable"
              ? "O texto editável será removido do perfil. O prompt-base imutável continuará sendo enviado."
              : "A personalização atual será substituída pelo prompt padrão."}
          </span>
          <div className="flex gap-2">
            <Button onClick={() => setPendingAction(null)} type="button" variant="secondary">
              Cancelar
            </Button>
            <Button
              onClick={confirmPendingAction}
              type="button"
              variant={pendingAction === "disable" ? "danger" : "primary"}
            >
              {pendingAction === "disable" ? "Desativar prompt" : "Restaurar prompt"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
