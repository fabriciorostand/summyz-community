import { Check, ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";

import { Button, Label } from "../../components/ui";
import { type CatalogState, useModelCatalog } from "../../hooks/use-model-catalog";
import { isDownloadActive } from "../../hooks/use-model-downloads";
import type { Messages } from "../../i18n/messages/pt-BR";
import { type I18nSnapshot, useI18n } from "../../i18n/store";
import type { ModelCatalog, ModelDownload } from "../../lib/api";
import { compatibilityTag, installTag, type Tag } from "./model-labels";
import { localEngines, type Stage } from "./profile-stages";

type Provider = ModelCatalog["provider"];
type JobFor = (provider: ModelDownload["provider"], model: string) => ModelDownload | undefined;

interface ModelOption {
  kind: "model" | "family";
  id: string;
  sub?: string;
  tags: Tag[];
}

interface OptionGroup {
  label: string;
  options: ModelOption[];
}

const tagTones: Record<Tag["tone"], string> = {
  action: "bg-action-soft text-accent",
  fail: "bg-fail-soft text-fail",
  neutral: "bg-surface-inset text-ink-muted",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn/15 text-warn",
};

export function TagChip({ tag }: { tag: Tag }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10.5px] whitespace-nowrap ${tagTones[tag.tone]}`}>
      {tag.label}
    </span>
  );
}

function matches(query: string, ...texts: (string | undefined)[]): boolean {
  const needle = query.trim().toLowerCase();
  return needle === "" || texts.some((text) => text?.toLowerCase().includes(needle));
}

function downloadTag(job: ModelDownload | undefined, t: Messages): Tag | null {
  if (job === undefined || !isDownloadActive(job)) return null;
  if (job.status === "queued") return { label: t.models.queuedTag, tone: "neutral" };
  if (job.totalBytes === null || job.totalBytes === 0)
    return { label: t.models.downloadingTag, tone: "neutral" };
  const percent = Math.floor((job.completedBytes / job.totalBytes) * 100);
  return { label: t.models.downloadingTagPercent(String(percent)), tone: "neutral" };
}

function groupsFor(
  catalog: ModelCatalog,
  family: string | undefined,
  query: string,
  jobFor: JobFor | undefined,
  i18n: Pick<I18nSnapshot, "format" | "t">,
): OptionGroup[] {
  const { provider } = catalog;
  const { t } = i18n;
  const stateTag = (model: string, installed: boolean | null, size: number | null): Tag[] => {
    if (provider === "openrouter") return [];
    const tag = downloadTag(jobFor?.(provider, model), t) ?? installTag(installed, size, i18n);
    return tag === null ? [] : [tag];
  };
  if (provider === "ollama" && family === undefined) {
    const installed = catalog.installedModels
      .filter((entry) => matches(query, entry.model))
      .map((entry) => ({
        id: entry.model,
        kind: "model" as const,
        tags: stateTag(entry.model, true, entry.sizeBytes),
      }));
    const families = catalog.items
      .filter((item) => matches(query, item.family, item.name))
      .map((item) => ({ id: item.family ?? item.name, kind: "family" as const, tags: [] }));
    return [
      { label: t.models.installedOnMachine, options: installed },
      { label: t.models.ollamaLibrary, options: families },
    ].filter((group) => group.options.length > 0);
  }
  const options = catalog.items
    .filter((item) => matches(query, item.model, item.name))
    .map((item) => {
      const compatibility = compatibilityTag(item.compatibility, t);
      return {
        id: item.model,
        kind: "model" as const,
        tags: [
          ...stateTag(item.model, item.installed, item.sizeBytes),
          ...(compatibility === null ? [] : [compatibility]),
        ],
        ...(item.name === item.model ? {} : { sub: item.name }),
      };
    });
  return options.length === 0 ? [] : [{ label: t.models.models, options }];
}

function sourceLabel(provider: Provider, stage: Stage, t: Messages): string {
  return provider === "openrouter" ? "OpenRouter" : t.models.thisInstallation(localEngines[stage]);
}

function emptyMessage(query: string, family: string | undefined, t: Messages): string {
  if (query.trim() !== "") return t.models.noMatch(query.trim());
  if (family !== undefined) return t.models.familyEmpty;
  return t.models.stageEmpty;
}

export interface ModelPickerProps {
  jobFor?: JobFor;
  needsChoice?: boolean;
  onChange: (model: string) => void;
  provider: Provider;
  stage: Stage;
  value: string | null;
}

/**
 * Picks a model from the catalog of the execution chosen for the stage. The Ollama library is
 * too large for one list, so it is browsed by family first.
 */
export function ModelPicker({
  jobFor,
  needsChoice = false,
  onChange,
  provider,
  stage,
  value,
}: ModelPickerProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<string | undefined>(undefined);
  const [active, setActive] = useState(0);
  const ids = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { reload, state } = useModelCatalog(
    stage,
    open ? provider : null,
    provider === "ollama" ? family : undefined,
  );
  const groups = useMemo(
    () => (state.status === "ready" ? groupsFor(state.catalog, family, query, jobFor, i18n) : []),
    [state, family, query, jobFor, i18n],
  );
  const flat = groups.flatMap((group) => group.options);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const close = (event: MouseEvent) => {
      if (event.target instanceof Node && fieldRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function browse(next: string | undefined) {
    setFamily(next);
    setQuery("");
    setActive(0);
    searchRef.current?.focus();
  }

  function show() {
    browse(provider === "ollama" && value !== null ? value.split(":")[0] : undefined);
    setOpen(true);
  }

  function hide() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function choose(option: ModelOption | undefined) {
    if (option === undefined) return;
    if (option.kind === "family") {
      browse(option.id);
      return;
    }
    onChange(option.id);
    hide();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: flat.length - 1 };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      if (flat.length > 0) setActive((current) => (current + move) % flat.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(flat[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      hide();
    }
  }

  const labelId = `${ids}-label`;
  const valueId = `${ids}-value`;
  const listId = `${ids}-list`;
  const optionId = (index: number) => `${ids}-option-${String(index)}`;

  return (
    <div className="flex flex-col gap-1.5" ref={fieldRef}>
      <span id={labelId}>
        <Label>{t.models.model}</Label>
      </span>
      <div className="relative">
        <button
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-labelledby={`${labelId} ${valueId}`}
          className={`flex min-h-[42px] w-full items-center gap-2.5 rounded-lg border bg-surface-raised px-3 py-2 text-left transition-colors ${
            needsChoice ? "border-dashed border-warn" : triggerBorder(open)
          }`}
          onClick={() => (open ? hide() : show())}
          ref={triggerRef}
          type="button"
        >
          <span
            className={`min-w-0 flex-1 truncate ${
              value === null ? "text-[13.5px] text-ink-muted" : "font-mono text-[12.5px] text-ink"
            }`}
            id={valueId}
          >
            {value ?? t.models.chooseModel}
          </span>
          <ChevronDown className="size-4 shrink-0 text-ink-muted" />
        </button>
        {open && (
          <div
            aria-label={t.models.chooseFrom(sourceLabel(provider, stage, t))}
            className="absolute inset-x-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-xl border border-line-strong bg-surface shadow-2xl"
            role="dialog"
          >
            <div className="flex items-center gap-2 border-b border-line-soft px-3 py-2.5 text-ink-muted">
              <Search className="size-3.5 shrink-0" />
              <input
                aria-activedescendant={flat.length > 0 ? optionId(active) : undefined}
                aria-autocomplete="list"
                aria-controls={listId}
                aria-expanded="true"
                aria-label={t.models.search}
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-dim pointer-fine:text-[13.5px]"
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                placeholder={t.models.search}
                ref={searchRef}
                role="combobox"
                spellCheck={false}
                type="text"
                value={query}
              />
            </div>
            <div className="flex items-center gap-2 px-3 pt-2.5 pb-1 text-[11.5px] font-semibold text-ink-secondary">
              {provider === "ollama" && family !== undefined ? (
                <button
                  aria-label={t.models.backToFamilies}
                  className="-ml-1 flex items-center gap-1 rounded px-1 text-accent hover:text-accent-hover"
                  onClick={() => browse(undefined)}
                  type="button"
                >
                  <ChevronLeft className="size-3.5" />
                  {family}
                </button>
              ) : (
                sourceLabel(provider, stage, t)
              )}
            </div>
            <PickerBody reload={reload} state={state}>
              <div
                aria-label={t.models.models}
                className="max-h-[340px] overflow-y-auto pb-1.5"
                id={listId}
                role="listbox"
              >
                <OptionGroups
                  active={active}
                  groups={groups}
                  onChoose={choose}
                  onHover={setActive}
                  optionId={optionId}
                  value={value}
                />
                {groups.length === 0 && (
                  <p className="m-0 px-3.5 py-2.5 text-[12px] text-ink-muted">
                    {emptyMessage(query, family, t)}
                  </p>
                )}
              </div>
            </PickerBody>
          </div>
        )}
      </div>
    </div>
  );
}

function triggerBorder(open: boolean): string {
  return open ? "border-action" : "border-line hover:border-line-strong";
}

function OptionGroups({
  active,
  groups,
  onChoose,
  onHover,
  optionId,
  value,
}: {
  active: number;
  groups: readonly OptionGroup[];
  onChoose: (option: ModelOption) => void;
  onHover: (index: number) => void;
  optionId: (index: number) => string;
  value: string | null;
}) {
  let position = 0;
  return groups.map((group) => (
    // biome-ignore lint/a11y/useSemanticElements: inside a listbox options are grouped by role=group, not by a form fieldset.
    <div aria-label={group.label} key={group.label} role="group">
      {groups.length > 1 && (
        <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-ink-muted">{group.label}</div>
      )}
      {group.options.map((option) => {
        const index = position++;
        return (
          <OptionRow
            active={index === active}
            id={optionId(index)}
            key={`${option.kind}-${option.id}`}
            onChoose={() => onChoose(option)}
            onHover={() => onHover(index)}
            option={option}
            selected={option.kind === "model" && option.id === value}
          />
        );
      })}
    </div>
  ));
}

function OptionRow({
  active,
  id,
  onChoose,
  onHover,
  option,
  selected,
}: {
  active: boolean;
  id: string;
  onChoose: () => void;
  onHover: () => void;
  option: ModelOption;
  selected: boolean;
}) {
  const highlight = selected ? "bg-action-soft" : active ? "bg-surface-inset" : "";
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the search combobox owns the keyboard and points at this option through aria-activedescendant.
    <div
      aria-selected={selected}
      className={`mx-1.5 flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 ${highlight}`}
      id={id}
      onClick={onChoose}
      onMouseEnter={onHover}
      role="option"
      tabIndex={-1}
    >
      <Check className={`size-3.5 shrink-0 text-accent ${selected ? "" : "invisible"}`} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-mono text-[12px] text-ink">{option.id}</span>
        {option.sub !== undefined && (
          <span className="truncate text-[11px] text-ink-muted">{option.sub}</span>
        )}
      </span>
      <span className="flex flex-wrap justify-end gap-1">
        {option.tags.map((tag) => (
          <TagChip key={tag.label} tag={tag} />
        ))}
      </span>
      {option.kind === "family" && <ChevronRight className="size-3.5 shrink-0 text-ink-muted" />}
    </div>
  );
}

function PickerBody({
  children,
  reload,
  state,
}: {
  children: ReactNode;
  reload: () => void;
  state: CatalogState;
}) {
  const { format, t, timeZone } = useI18n();
  if (state.status === "idle" || state.status === "loading") {
    return <p className="m-0 px-3.5 py-3 text-[12px] text-ink-muted">{t.models.loading}</p>;
  }
  if (state.status === "error" && state.code === "openrouter_api_key_missing") {
    return (
      <div className="flex flex-col items-start gap-2 px-3.5 py-3 text-[12px] leading-relaxed text-ink-muted">
        {t.models.keyMissing}
        <Link className="text-accent hover:text-accent-hover" to="/installation">
          {t.models.openInstallation}
        </Link>
      </div>
    );
  }
  if (state.status === "error" || state.catalog.status === "unavailable") {
    return (
      <div className="flex flex-col items-start gap-2 px-3.5 py-3 text-[12px] leading-relaxed text-ink-muted">
        {t.models.catalogFailed}
        <Button
          className="px-2.5 py-1 text-[12px]"
          onClick={reload}
          type="button"
          variant="secondary"
        >
          {t.common.tryAgain}
        </Button>
      </div>
    );
  }
  return (
    <>
      {state.catalog.status === "stale" && (
        <p className="m-0 px-3.5 pb-1 text-[11px] text-warn">
          {t.models.stale(
            format.dateTime(new Date(state.catalog.fetchedAt).toISOString(), timeZone),
          )}
        </p>
      )}
      {children}
    </>
  );
}
