import {
  type ComponentProps,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Link } from "react-router-dom";

import { useI18n } from "../i18n/store";
import { initialsOf } from "../lib/format";
import { Select } from "./select";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonVariants: Record<ButtonVariant, string> = {
  danger: "border border-fail/40 bg-fail-soft text-fail enabled:hover:bg-fail/20",
  ghost:
    "border border-transparent text-ink-secondary enabled:hover:bg-surface-inset enabled:hover:text-ink",
  primary: "bg-action-gradient text-white enabled:hover:bg-action-gradient-hover",
  secondary: "border border-line bg-surface-raised text-ink enabled:hover:border-line-strong",
};

type ButtonSize = "default" | "toolbar";

const buttonSizes: Record<ButtonSize, string> = {
  default: "px-3.5 py-2 text-[13.5px]",
  toolbar: "h-[34px] px-3 text-[12.5px]",
};

export function Button({
  className = "",
  size = "default",
  variant = "primary",
  ...props
}: ComponentProps<"button"> & { size?: ButtonSize; variant?: ButtonVariant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${buttonSizes[size]} ${buttonVariants[variant]} ${className}`}
      {...props}
    />
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="label-mono text-ink-muted">{children}</span>;
}

export const controlClass =
  "w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-ink outline-none transition-colors placeholder:text-ink-dim focus:border-action disabled:cursor-not-allowed disabled:opacity-50";

const fieldTextClass = "text-base pointer-fine:text-[13.5px]";

const boxedControlClass =
  "flex w-full items-center gap-2 rounded-lg border border-line bg-surface-raised pr-2 transition-colors focus-within:border-action";

const boxedInputClass =
  "min-w-0 flex-1 bg-transparent py-2 pl-3 text-ink outline-none placeholder:text-ink-dim";

interface FieldIds {
  controlId: string;
  describedBy: string | undefined;
  hintId: string;
}

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

/** A native control with its label above and an optional hint below, tied by id. */
function LabelledControl({
  children,
  className,
  controlId,
  hint,
  hintId,
  label,
}: {
  children: ReactNode;
  className: string;
  controlId: string;
  hint: string | undefined;
  hintId: string;
  label: string;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={controlId}>
        <Label>{label}</Label>
      </label>
      {children}
      {hint !== undefined && <Hint id={hintId}>{hint}</Hint>}
    </div>
  );
}

export function Field({
  hint,
  label,
  className = "",
  trailing,
  ...props
}: ComponentProps<"input"> & {
  hint?: string;
  label: string;
  /** Small controls drawn inside the box, at its right end. */
  trailing?: ReactNode;
}) {
  const { controlId, describedBy, hintId } = useFieldIds(hint);
  return (
    <LabelledControl
      className={className}
      controlId={controlId}
      hint={hint}
      hintId={hintId}
      label={label}
    >
      {/* Always wrapped, so the input survives trailing controls coming and going. With them,
          the wrapper draws the box and the input sits beside the controls inside it. */}
      <div className={trailing === undefined ? "" : boxedControlClass}>
        <input
          aria-describedby={describedBy}
          className={`${trailing === undefined ? controlClass : boxedInputClass} ${fieldTextClass}`}
          id={controlId}
          {...props}
        />
        {trailing !== undefined && (
          <span className="flex shrink-0 items-center gap-1">{trailing}</span>
        )}
      </div>
    </LabelledControl>
  );
}

export function SelectField<T extends string>({
  className = "",
  hint,
  label,
  ...props
}: Omit<ComponentProps<typeof Select<T>>, "aria-describedby" | "aria-labelledby" | "id"> & {
  className?: string;
  hint?: string;
  label: string;
}) {
  const { controlId, describedBy, hintId } = useFieldIds(hint);
  const labelId = `${controlId}-label`;
  // A <label for> would forward its click to the trigger and open the list, unlike a native
  // select, so the name comes from aria-labelledby instead.
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <span id={labelId}>
        <Label>{label}</Label>
      </span>
      <Select aria-describedby={describedBy} aria-labelledby={labelId} id={controlId} {...props} />
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
    <LabelledControl
      className={className}
      controlId={controlId}
      hint={hint}
      hintId={hintId}
      label={label}
    >
      <textarea
        aria-describedby={describedBy}
        className={`${controlClass} font-mono text-base leading-relaxed pointer-fine:text-[12.5px]`}
        id={controlId}
        {...props}
      />
    </LabelledControl>
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
    // A lone title centres on the icon; with a description the pair aligns to the icon's top.
    <div
      className={`mb-4 flex gap-3 ${description === undefined ? "items-center" : "items-start"}`}
    >
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

type AvatarFallbackTone = "neutral" | "action";

/**
 * The neutral fallback nearly matches raised surfaces, so pickers drawn on them use the outlined
 * action tone to keep the initials box as visible as a guild icon or user photo.
 */
const avatarFallbackTones: Record<AvatarFallbackTone, string> = {
  action: "border border-action/40 bg-action-soft text-accent",
  neutral: "bg-surface-inset text-ink-secondary",
};

export function Avatar({
  avatarUrl,
  fallbackTone = "neutral",
  name,
  size = 28,
}: {
  avatarUrl?: string | null;
  fallbackTone?: AvatarFallbackTone;
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
      className={`grid shrink-0 place-items-center rounded-lg text-[10.5px] font-semibold ${avatarFallbackTones[fallbackTone]}`}
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
  action,
  children,
  icon,
  tone = "neutral",
}: {
  action?: ReactNode;
  children: ReactNode;
  icon?: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "fail";
}) {
  const tones = {
    fail: "border-fail/30 bg-fail-soft text-fail",
    neutral: "border-line bg-surface-raised text-ink-muted",
    ok: "border-ok/30 bg-ok-soft text-ok",
    warn: "border-warn/30 bg-warn/10 text-warn",
  } as const;
  return (
    <div
      className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-[12px] leading-relaxed ${tones[tone]}`}
    >
      {icon}
      <span className="min-w-0 flex-1">{children}</span>
      {action}
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

/** A text link to another dashboard screen, navigated inside the app. */
export function InlineLink({ children, to }: { children: ReactNode; to: string }) {
  return (
    <Link
      className="inline-flex items-center gap-1 text-[12.5px] text-accent hover:text-accent-hover"
      to={to}
    >
      {children}
    </Link>
  );
}

const tipViewportGutter = 16;

/**
 * The "?" affordance from the design: a short explanation that shows on hover or focus and
 * is wired through aria-describedby so keyboard and screen-reader users get it too.
 */
export function HelpTip({
  children,
  label,
  placement = "below",
}: {
  children: ReactNode;
  /** Accessible name of the "?" button, for pages that show several tips side by side. */
  label?: string;
  placement?: "below" | "left";
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [placementStyle, setPlacementStyle] = useState<CSSProperties | undefined>(undefined);
  const tipRef = useRef<HTMLSpanElement>(null);
  const id = useId();

  // Keep the open tip at least one gutter inside the viewport, whatever side it opens to. It
  // moves in its own box (not with a transform) so its original spot cannot widen the page.
  useLayoutEffect(() => {
    const tip = tipRef.current;
    const anchor = tip?.parentElement;
    if (!open || tip === null || anchor == null) return;
    const rect = tip.getBoundingClientRect();
    const limit = document.documentElement.clientWidth - tipViewportGutter;
    let shift = rect.right > limit ? limit - rect.right : 0;
    if (rect.left + shift < tipViewportGutter) shift = tipViewportGutter - rect.left;
    if (shift === 0) return;
    const left = rect.left + shift - anchor.getBoundingClientRect().left;
    setPlacementStyle({ left: `${String(left)}px`, right: "auto" });
    return () => setPlacementStyle(undefined);
  }, [open]);
  // Phones have no room beside the "?", so a left tip opens below it and grows inwards.
  const position =
    placement === "left"
      ? "top-[26px] right-[-8px] sm:top-[-6px] sm:right-[calc(100%+10px)]"
      : "top-[26px] left-[-8px]";
  return (
    <span className="relative inline-flex">
      <button
        aria-describedby={open ? id : undefined}
        aria-label={label ?? t.common.help}
        className="touch-target grid size-[17px] cursor-help place-items-center rounded-full border border-line-strong font-mono text-[10px] font-bold text-ink-dim transition-colors hover:border-action hover:text-accent-hover focus:border-action focus:text-accent-hover focus:outline-none"
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
          className={`absolute z-10 w-[min(260px,calc(100vw-2rem))] rounded-lg border border-line-strong bg-surface-inset px-3.5 py-2.5 text-left text-[11.5px] leading-relaxed font-normal tracking-normal normal-case text-ink-secondary shadow-xl ${position}`}
          id={id}
          ref={tipRef}
          role="tooltip"
          style={placementStyle}
        >
          {children}
        </span>
      )}
    </span>
  );
}
