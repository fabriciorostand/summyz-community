import { Check, ChevronDown } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export interface SelectOption<T extends string> {
  label: string;
  leading?: ReactNode;
  value: T;
}

type SelectVariant = "field" | "toolbar";

const GAP = 4;
const VIEWPORT_MARGIN = 8;
const MAX_LIST_HEIGHT = 288;
const MIN_ROOM_BELOW = 160;
const PAGE_STEP = 10;
const TYPEAHEAD_RESET_MS = 700;

const triggerVariants: Record<SelectVariant, string> = {
  field: "w-full px-3 py-2 text-[13.5px]",
  toolbar: "py-1.5 pr-2 pl-2 text-[12.5px] font-medium",
};

interface Placement {
  openUp: boolean;
  style: CSSProperties;
}

/**
 * Field selects match their trigger width; toolbar pickers hug the right edge and may grow,
 * since they sit at the end of the top bar and their trigger is narrower than the options.
 */
function placeList(trigger: DOMRect, variant: SelectVariant): Placement {
  const viewportHeight = window.innerHeight;
  const viewportWidth = document.documentElement.clientWidth;
  const roomBelow = viewportHeight - trigger.bottom - GAP - VIEWPORT_MARGIN;
  const roomAbove = trigger.top - GAP - VIEWPORT_MARGIN;
  const openUp = roomBelow < MIN_ROOM_BELOW && roomAbove > roomBelow;
  const vertical = openUp
    ? { bottom: viewportHeight - trigger.top + GAP }
    : { top: trigger.bottom + GAP };
  const horizontal =
    variant === "toolbar"
      ? { minWidth: Math.max(trigger.width, 208), right: viewportWidth - trigger.right }
      : { left: trigger.left, width: trigger.width };
  return {
    openUp,
    style: {
      ...vertical,
      ...horizontal,
      maxHeight: Math.min(MAX_LIST_HEIGHT, openUp ? roomAbove : roomBelow),
    },
  };
}

function findByPrefix<T extends string>(
  options: readonly SelectOption<T>[],
  typed: string,
  from: number,
): number {
  const prefix = typed.toLocaleLowerCase();
  for (let step = 0; step < options.length; step += 1) {
    const index = (from + step) % options.length;
    if (options[index]?.label.toLocaleLowerCase().startsWith(prefix) === true) return index;
  }
  return -1;
}

function isPrintableKey(event: KeyboardEvent): boolean {
  return event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey;
}

/**
 * A select-only combobox (WAI-ARIA APG pattern). Focus never leaves the trigger: the highlighted
 * option is announced through aria-activedescendant. The list is portalled to the body so panels
 * with overflow-hidden, such as Disclosure, cannot clip it.
 */
export function Select<T extends string>({
  "aria-describedby": describedBy,
  "aria-label": ariaLabel,
  "aria-labelledby": labelledBy,
  disabled = false,
  id,
  onChange,
  options,
  renderValue,
  value,
  variant = "field",
}: {
  "aria-describedby"?: string | undefined;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  disabled?: boolean;
  id?: string;
  onChange: (value: T) => void;
  options: readonly SelectOption<T>[];
  renderValue?: (option: SelectOption<T> | undefined) => ReactNode;
  value: T;
  variant?: SelectVariant;
}) {
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ at: 0, text: "" });
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [placement, setPlacement] = useState<Placement | undefined>(undefined);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];
  const optionId = (index: number) => `${listId}-option-${String(index)}`;

  function openList(index = selectedIndex) {
    if (disabled || options.length === 0) return;
    setActiveIndex(index >= 0 ? index : 0);
    setOpen(true);
  }

  function commit(index: number) {
    setOpen(false);
    const option = options[index];
    if (option !== undefined && option.value !== value) onChange(option.value);
  }

  function moveTo(index: number) {
    setActiveIndex(Math.max(0, Math.min(options.length - 1, index)));
  }

  function typeAhead(character: string) {
    const now = Date.now();
    const state = typeahead.current;
    const text = now - state.at > TYPEAHEAD_RESET_MS ? character : state.text + character;
    typeahead.current = { at: now, text };
    const start = open ? activeIndex : selectedIndex;
    // Repeating one letter cycles through the options that share it, as native selects do.
    const cycling = [...text].every((letter) => letter === text[0]);
    const match = cycling
      ? findByPrefix(options, character, start + 1)
      : findByPrefix(options, text, Math.max(0, start));
    if (match < 0) return;
    if (open) setActiveIndex(match);
    else openList(match);
  }

  function isTyping(): boolean {
    const state = typeahead.current;
    return state.text !== "" && Date.now() - state.at <= TYPEAHEAD_RESET_MS;
  }

  function closedKeys(): Record<string, () => void> {
    return {
      " ": () => openList(),
      ArrowDown: () => openList(),
      ArrowUp: () => openList(),
      End: () => openList(options.length - 1),
      Enter: () => openList(),
      Home: () => openList(0),
    };
  }

  function openKeys(altKey: boolean): Record<string, () => void> {
    return {
      " ": () => commit(activeIndex),
      ArrowDown: () => (altKey ? commit(activeIndex) : moveTo(activeIndex + 1)),
      ArrowUp: () => (altKey ? commit(activeIndex) : moveTo(activeIndex - 1)),
      End: () => moveTo(options.length - 1),
      Enter: () => commit(activeIndex),
      Escape: () => setOpen(false),
      Home: () => moveTo(0),
      PageDown: () => moveTo(activeIndex + PAGE_STEP),
      PageUp: () => moveTo(activeIndex - PAGE_STEP),
    };
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === " " && isTyping()) {
      event.preventDefault();
      typeAhead(" ");
      return;
    }
    // Tab keeps its default so focus still moves on, as the APG select-only combobox does.
    if (open && event.key === "Tab") {
      commit(activeIndex);
      return;
    }
    const action = (open ? openKeys(event.altKey) : closedKeys())[event.key];
    if (action !== undefined) {
      event.preventDefault();
      action();
    } else if (isPrintableKey(event)) {
      event.preventDefault();
      typeAhead(event.key);
    }
  }

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    if (trigger !== null) setPlacement(placeList(trigger.getBoundingClientRect(), variant));
  }, [variant]);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, reposition]);

  // Keep the highlighted option inside the scrollable list without scrolling the page.
  useEffect(() => {
    const list = listRef.current;
    if (!open || list === null) return;
    const option = list.querySelector<HTMLElement>(`[data-index="${String(activeIndex)}"]`);
    if (option === null) return;
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
  }, [activeIndex, open]);

  return (
    <>
      <button
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        aria-controls={open ? listId : undefined}
        aria-describedby={describedBy}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        className={`group flex items-center gap-2 rounded-lg border bg-surface-raised text-left text-ink outline-none transition-[border-color,box-shadow] hover:border-line-strong focus-visible:border-action focus-visible:ring-2 focus-visible:ring-action/25 disabled:cursor-not-allowed disabled:opacity-50 ${
          open ? "border-action" : "border-line"
        } ${triggerVariants[variant]}`}
        disabled={disabled}
        id={id}
        onBlur={() => setOpen(false)}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={handleKeyDown}
        // Buttons activate on Space release; the keydown handler already acted on it.
        onKeyUp={(event) => {
          if (event.key === " ") event.preventDefault();
        }}
        ref={triggerRef}
        role="combobox"
        type="button"
      >
        {renderValue === undefined ? (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {selected?.leading}
            <span className="truncate">{selected?.label}</span>
          </span>
        ) : (
          renderValue(selected)
        )}
        <ChevronDown
          className={`size-3.5 shrink-0 text-ink-muted transition-transform duration-150 group-hover:text-ink ${
            open ? "rotate-180 text-accent" : ""
          }`}
        />
      </button>
      {open &&
        createPortal(
          <div
            aria-label={ariaLabel}
            aria-labelledby={labelledBy}
            className={`fixed z-50 overflow-y-auto [scrollbar-color:color-mix(in_oklab,var(--color-ink-dim)_45%,transparent)_transparent] [scrollbar-width:thin] rounded-lg border border-line-strong bg-surface-raised p-1 shadow-xl shadow-black/25 transition duration-150 ease-out starting:opacity-0 ${
              placement?.openUp === true ? "starting:translate-y-1" : "starting:-translate-y-1"
            }`}
            id={listId}
            // Pressing inside the list (options or its scrollbar) must not blur the trigger.
            onMouseDown={(event) => event.preventDefault()}
            ref={listRef}
            role="listbox"
            style={placement?.style}
          >
            {options.map((option, index) => {
              const isSelected = index === selectedIndex;
              const isActive = index === activeIndex;
              return (
                // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox owns the keyboard and points at this option through aria-activedescendant.
                <div
                  aria-selected={isSelected}
                  className={`flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] ${
                    isActive ? "bg-action/15" : ""
                  } ${isActive || isSelected ? "text-ink" : "text-ink-secondary"} ${
                    isSelected ? "font-medium" : ""
                  }`}
                  data-index={index}
                  id={optionId(index)}
                  key={option.value}
                  onClick={() => commit(index)}
                  onMouseMove={() => {
                    if (!isActive) setActiveIndex(index);
                  }}
                  role="option"
                  tabIndex={-1}
                >
                  {option.leading}
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {isSelected && <Check className="size-3.5 shrink-0 text-accent" />}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
