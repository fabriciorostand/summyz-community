import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge, Button } from "../../components/ui";
import type { ProfileType } from "../../lib/api";

export const profileTypeLabels: Record<NonNullable<ProfileType>, string> = {
  external: "API externa",
  hybrid: "Híbrido",
  local: "Local",
};

export function ProfileTypeBadge({ short = false, type }: { short?: boolean; type: ProfileType }) {
  if (type === null) return <Badge>Incompleto</Badge>;
  const label = short && type === "external" ? "API" : profileTypeLabels[type];
  return <Badge tone={type === "local" ? "neutral" : "action"}>{label}</Badge>;
}

export function UsageLine({ count }: { count: number }) {
  if (count === 0) return <span className="text-[11.5px] text-ink-muted">Não está em uso</span>;
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] whitespace-nowrap text-ok">
      <span className="size-1.5 rounded-full bg-ok" />
      Em uso em {count} {count === 1 ? "servidor" : "servidores"}
    </span>
  );
}

function DeletePopover({
  activeServerCount,
  name,
  onClose,
  onDelete,
  onlyProfile,
}: {
  activeServerCount: number;
  name: string;
  onClose: () => void;
  onDelete: () => void;
  onlyProfile: boolean;
}) {
  const panel =
    "absolute top-[calc(100%+8px)] right-0 z-30 flex w-[min(320px,calc(100vw-2rem))] flex-col gap-2.5 rounded-xl border border-line-strong bg-surface p-3.5 text-[12.5px] leading-relaxed text-ink-secondary shadow-2xl";
  if (activeServerCount > 0 || onlyProfile) {
    const reason =
      activeServerCount > 0
        ? `Escolha outro perfil ${activeServerCount === 1 ? "no servidor que usa" : `nos ${String(activeServerCount)} servidores que usam`} este antes de excluir.`
        : "Crie outro perfil antes de excluir este.";
    return (
      <div aria-label="Excluir perfil" className={panel} role="dialog">
        <strong className="text-[13px] text-ink">
          {activeServerCount > 0 ? "Este perfil está em uso" : "Este é o único perfil"}
        </strong>
        <span>{reason}</span>
        <Button className="self-end" onClick={onClose} type="button" variant="secondary">
          Entendi
        </Button>
      </div>
    );
  }
  return (
    <div aria-label="Excluir perfil" className={panel} role="alertdialog">
      <strong className="text-[13px] text-ink">Excluir “{name}”?</strong>
      <span>O perfil sai da lista e não pode ser recuperado.</span>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose} type="button" variant="secondary">
          Cancelar
        </Button>
        <Button onClick={onDelete} type="button" variant="danger">
          Excluir perfil
        </Button>
      </div>
    </div>
  );
}

export function ProfileHeader({
  activeServerCount,
  busy,
  name,
  nameError,
  onDelete,
  onNameChange,
  onlyProfile,
  savedName,
  type,
}: {
  activeServerCount: number;
  busy: boolean;
  name: string;
  nameError: string | null;
  onDelete: () => void;
  onNameChange: (name: string) => void;
  onlyProfile: boolean;
  savedName: string;
  type: ProfileType;
}) {
  const [deleting, setDeleting] = useState(false);
  const holder = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!deleting) return;
    const close = (event: MouseEvent) => {
      if (event.target instanceof Node && holder.current?.contains(event.target)) return;
      setDeleting(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [deleting]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <input
          aria-describedby={nameError === null ? undefined : "profile-name-error"}
          aria-invalid={nameError !== null}
          aria-label="Nome do perfil"
          className={`-ml-2 min-w-0 flex-[1_1_240px] rounded-lg border bg-transparent px-2 py-1 text-[20px] font-semibold tracking-tight text-ink outline-none transition-colors hover:border-line focus:border-action focus:bg-surface-raised ${
            nameError === null ? "border-transparent" : "border-fail"
          }`}
          maxLength={100}
          onChange={(event) => onNameChange(event.currentTarget.value)}
          value={name}
        />
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
          <ProfileTypeBadge type={type} />
          <UsageLine count={activeServerCount} />
          <span className="relative" ref={holder}>
            <Button
              aria-expanded={deleting}
              disabled={busy}
              onClick={() => setDeleting((open) => !open)}
              type="button"
              variant="ghost"
            >
              <Trash2 className="size-3.5" />
              Excluir
            </Button>
            {deleting && (
              <DeletePopover
                activeServerCount={activeServerCount}
                name={savedName}
                onClose={() => setDeleting(false)}
                onDelete={() => {
                  setDeleting(false);
                  onDelete();
                }}
                onlyProfile={onlyProfile}
              />
            )}
          </span>
        </div>
      </div>
      {nameError !== null && (
        <small className="text-[11.5px] text-fail" id="profile-name-error">
          {nameError}
        </small>
      )}
    </div>
  );
}
