import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
  useState,
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

interface FieldIds {
  controlId: string;
  describedBy: string | undefined;
  hintId: string;
}

/**
 * The hint sits outside the label and is wired through aria-describedby, so a screen reader
 * announces the field name on its own instead of reading the help text as part of it.
 */
function useFieldIds(hint: string | undefined): FieldIds {
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

export function Card({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLElement> & { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-5 ${className}`} {...props}>
      {children}
    </section>
  );
}

export function SectionHeading({
  action,
  description,
  icon,
  id,
  title,
}: {
  action?: ReactNode;
  description?: string;
  icon?: ReactNode;
  id?: string;
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
        <h2 className="m-0 text-[15px] font-semibold tracking-tight text-ink" id={id}>
          {title}
        </h2>
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

/** Discord's own mark, used wherever the design sends the operator to the Discord authorization. */
export function DiscordIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.198.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z" />
    </svg>
  );
}

/** Reads like a link, behaves like one when there is somewhere to go and stays inert otherwise. */
export function InlineLink({
  children,
  className = "",
  href,
}: {
  children: ReactNode;
  className?: string;
  href?: string;
}) {
  const base = `inline-flex items-center gap-1 text-[12.5px] ${className}`;
  if (href === undefined) {
    return (
      <span aria-disabled="true" className={`${base} cursor-default text-ink-dim`}>
        {children}
      </span>
    );
  }
  return (
    <a className={`${base} text-accent hover:text-accent-hover`} href={href}>
      {children}
    </a>
  );
}

/**
 * The "?" affordance from the design: a short explanation that shows on hover or focus and
 * is wired through aria-describedby so keyboard and screen-reader users get it too.
 */
export function HelpTip({
  children,
  placement = "below",
}: {
  children: ReactNode;
  placement?: "below" | "left";
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const position =
    placement === "left" ? "top-[-6px] right-[calc(100%+10px)]" : "top-[26px] left-[-8px]";
  return (
    <span className="relative inline-flex">
      <button
        aria-describedby={open ? id : undefined}
        aria-label="Ajuda"
        className="grid size-[17px] cursor-help place-items-center rounded-full border border-line-strong font-mono text-[10px] font-bold text-ink-dim transition-colors hover:border-action hover:text-accent-hover focus:border-action focus:text-accent-hover focus:outline-none"
        onBlur={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        type="button"
      >
        ?
      </button>
      {open && (
        <span
          className={`absolute z-10 w-[260px] rounded-lg border border-line-strong bg-surface-inset px-3.5 py-2.5 text-left text-[11.5px] leading-relaxed font-normal tracking-normal normal-case text-ink-secondary shadow-xl ${position}`}
          id={id}
          role="tooltip"
        >
          {children}
        </span>
      )}
    </span>
  );
}
