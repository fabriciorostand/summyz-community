import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from "react";

import { initialsOf } from "../lib/format";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonVariants: Record<ButtonVariant, string> = {
  danger: "border border-fail/40 bg-fail-soft text-fail hover:bg-fail/20",
  ghost: "border border-transparent text-ink-secondary hover:bg-surface-inset hover:text-ink",
  primary: "bg-action text-white hover:bg-action-hover",
  secondary: "border border-line bg-surface-raised text-ink hover:border-line-strong",
};

export function Button({
  className = "",
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-[13.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${buttonVariants[variant]} ${className}`}
      {...props}
    />
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="label-mono text-ink-muted">{children}</span>;
}

const controlClass =
  "w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-[13.5px] text-ink outline-none transition-colors placeholder:text-ink-dim focus:border-action disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The hint sits outside the label and is wired through aria-describedby, so a screen reader
 * announces the field name on its own instead of reading the help text as part of it.
 */
function useFieldIds(hint: string | undefined): {
  controlId: string;
  describedBy: string | undefined;
  hintId: string;
} {
  const id = useId();
  return {
    controlId: `${id}-control`,
    describedBy: hint === undefined ? undefined : `${id}-hint`,
    hintId: `${id}-hint`,
  };
}

function Hint({ children, id }: { children: string; id: string }) {
  return (
    <small className="text-[11px] text-ink-dim" id={id}>
      {children}
    </small>
  );
}

export function Field({
  hint,
  label,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { hint?: string; label: string }) {
  const { controlId, describedBy, hintId } = useFieldIds(hint);
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={controlId}>
        <Label>{label}</Label>
      </label>
      <input aria-describedby={describedBy} className={controlClass} id={controlId} {...props} />
      {hint !== undefined && <Hint id={hintId}>{hint}</Hint>}
    </div>
  );
}

export function SelectField({
  children,
  hint,
  label,
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  children: ReactNode;
  hint?: string;
  label: string;
}) {
  const { controlId, describedBy, hintId } = useFieldIds(hint);
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={controlId}>
        <Label>{label}</Label>
      </label>
      <select aria-describedby={describedBy} className={controlClass} id={controlId} {...props}>
        {children}
      </select>
      {hint !== undefined && <Hint id={hintId}>{hint}</Hint>}
    </div>
  );
}

export function TextAreaField({
  hint,
  label,
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { hint?: string; label: string }) {
  const { controlId, describedBy, hintId } = useFieldIds(hint);
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={controlId}>
        <Label>{label}</Label>
      </label>
      <textarea
        aria-describedby={describedBy}
        className={`${controlClass} font-mono text-[12.5px] leading-relaxed`}
        id={controlId}
        {...props}
      />
      {hint !== undefined && <Hint id={hintId}>{hint}</Hint>}
    </div>
  );
}

export function Toggle({
  checked,
  description,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  description?: string;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-line bg-surface-raised px-3.5 py-3">
      <span className="flex flex-col gap-1">
        <strong className="text-[13px] font-medium text-ink">{label}</strong>
        {description !== undefined && (
          <small className="text-[11.5px] leading-relaxed text-ink-muted">{description}</small>
        )}
      </span>
      <input
        checked={checked}
        className="mt-0.5 size-4 shrink-0 accent-action"
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        type="checkbox"
      />
    </label>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-5 ${className}`}>
      {children}
    </section>
  );
}

export function SectionHeading({
  action,
  description,
  icon,
  title,
}: {
  action?: ReactNode;
  description?: string;
  icon?: ReactNode;
  title: string;
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      {icon !== undefined && (
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-action-soft text-accent">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="m-0 text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
        {description !== undefined && (
          <p className="m-0 mt-1 text-[12.5px] leading-relaxed text-ink-muted">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function RailLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <span className="label-mono text-ink-muted">{children}</span>
      <span className="h-px flex-1 bg-line-soft" />
    </div>
  );
}

type BadgeTone = "ok" | "fail" | "live" | "neutral" | "action";

const badgeTones: Record<BadgeTone, string> = {
  action: "bg-action-soft text-accent",
  fail: "bg-fail-soft text-fail",
  live: "bg-fail-soft text-fail",
  neutral: "bg-surface-inset text-ink-muted",
  ok: "bg-ok-soft text-ok",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: BadgeTone }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded px-2 py-1 font-mono text-[10px] font-medium tracking-[0.1em] uppercase ${badgeTones[tone]}`}
    >
      {tone === "live" && <span className="live-dot size-1.5 rounded-full bg-fail" />}
      {children}
    </span>
  );
}

export function Avatar({
  avatarUrl,
  name,
  size = 28,
}: {
  avatarUrl?: string | null;
  name: string;
  size?: number;
}) {
  const dimension = { height: `${String(size)}px`, width: `${String(size)}px` };
  if (avatarUrl !== null && avatarUrl !== undefined) {
    return (
      <img
        alt=""
        className="shrink-0 rounded-lg object-cover"
        loading="lazy"
        src={avatarUrl}
        style={dimension}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-lg bg-surface-inset text-[10.5px] font-semibold text-ink-secondary"
      style={dimension}
    >
      {initialsOf(name)}
    </span>
  );
}

export function Meter({ percentage, tone = "action" }: { percentage: number; tone?: BadgeTone }) {
  const fills: Record<BadgeTone, string> = {
    action: "bg-action",
    fail: "bg-fail",
    live: "bg-fail",
    neutral: "bg-ink-dim",
    ok: "bg-ok",
  };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-inset">
      <div
        className={`h-full rounded-full ${fills[tone]}`}
        style={{ width: `${String(Math.max(2, Math.min(100, percentage)))}%` }}
      />
    </div>
  );
}

export function Notice({
  children,
  icon,
  tone = "neutral",
}: {
  children: ReactNode;
  icon?: ReactNode;
  tone?: "neutral" | "warn" | "fail";
}) {
  const tones = {
    fail: "border-fail/30 bg-fail-soft text-fail",
    neutral: "border-line bg-surface-raised text-ink-muted",
    warn: "border-warn/30 bg-warn/10 text-warn",
  } as const;
  return (
    <div
      className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-[12px] leading-relaxed ${tones[tone]}`}
    >
      {icon}
      <span className="min-w-0">{children}</span>
    </div>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <p
      className="m-0 rounded-lg border border-fail/30 bg-fail-soft px-3 py-2 text-[12.5px] text-fail"
      role="alert"
    >
      {children}
    </p>
  );
}
