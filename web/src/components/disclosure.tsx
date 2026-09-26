import { ChevronDown } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

/**
 * The design keeps the essentials visible and folds everything else behind "Avançado".
 * Each panel owns its open state so a page can render many without a shared reducer.
 */
export function Disclosure({
  badge,
  children,
  defaultOpen = false,
  icon,
  summary,
  title,
}: {
  badge?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  icon?: ReactNode;
  summary?: string;
  title: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface">
      <button
        aria-controls={contentId}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-raised"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {icon !== undefined && <span className="shrink-0 text-accent">{icon}</span>}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* The badge drops under the title when both do not fit side by side. */}
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[13.5px] font-medium text-ink">{title}</span>
            {badge !== undefined && <span className="sm:ml-auto">{badge}</span>}
          </span>
          {summary !== undefined && (
            <span className="truncate text-[11.5px] text-ink-muted">{summary}</span>
          )}
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-ink-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div className="border-t border-line-soft p-4" hidden={!open} id={contentId}>
        {children}
      </div>
    </section>
  );
}

export interface TabOption<T extends string> {
  count?: number;
  label: string;
  value: T;
}

export function Tabs<T extends string>({
  ariaLabel,
  fill = false,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  /** Stretch the tablist to its container and give every tab the same share of it. */
  fill?: boolean;
  onChange: (value: T) => void;
  options: readonly TabOption<T>[];
  value: T;
}) {
  return (
    <div
      aria-label={ariaLabel}
      className={`${fill ? "flex w-full" : "inline-flex"} max-w-full gap-0.5 overflow-x-auto rounded-lg border border-line bg-surface p-1 [scrollbar-color:color-mix(in_oklab,var(--color-ink-dim)_45%,transparent)_transparent] [scrollbar-width:thin] sm:gap-1`}
      role="tablist"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            aria-selected={selected}
            className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium whitespace-nowrap transition-colors sm:px-3 ${
              fill ? "flex-1 basis-0 justify-center" : "shrink-0"
            } ${
              selected
                ? "bg-action text-white"
                : "cursor-pointer text-ink-secondary hover:bg-surface-inset hover:text-ink"
            }`}
            key={option.value}
            onClick={() => onChange(option.value)}
            role="tab"
            type="button"
          >
            {option.label}
            {option.count !== undefined && (
              <span
                className={`font-mono text-[10px] ${selected ? "text-white/70" : "text-ink-dim"}`}
              >
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
