import { TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

import { Button, FormError } from "../../components/ui";
import { type I18nSnapshot, useI18n } from "../../i18n/store";
import type { Stage } from "./profile-stages";

export type SaveBlocker =
  | { kind: "incomplete"; stages: Stage[] }
  | { count: number; kind: "review"; stages: Stage[] };

function blockerMessage(blocker: SaveBlocker, { format, t }: I18nSnapshot): string {
  const stages = format.list(blocker.stages.map((stage) => t.stages.titles[stage]));
  if (blocker.kind === "incomplete") return t.saveBar.incompleteBlocker(stages);
  return t.saveBar.reviewBlocker(blocker.count, stages);
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-start gap-2 text-warn">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <span className="text-ink-secondary">{children}</span>
    </span>
  );
}

function SaveBarMessage({
  activeServerCount,
  blocker,
  changes,
  confirming,
  missingModels,
}: {
  activeServerCount: number;
  blocker: SaveBlocker | null;
  changes: readonly string[];
  confirming: boolean;
  missingModels: readonly string[];
}) {
  const i18n = useI18n();
  const { format, t } = i18n;
  if (blocker !== null) return <Warning>{blockerMessage(blocker, i18n)}</Warning>;
  if (confirming) {
    const detail =
      missingModels.length > 0
        ? t.saveBar.missingDetail(
            format.list(missingModels),
            missingModels.length,
            activeServerCount,
          )
        : t.saveBar.nextMeetings;
    return (
      <Warning>
        <strong className="font-medium text-ink">{t.saveBar.inUse(activeServerCount)}</strong>{" "}
        {detail}
      </Warning>
    );
  }
  return (
    <span className="flex items-center gap-2.5">
      <span className="size-1.5 shrink-0 rounded-full bg-warn" />
      <span>
        <strong className="font-medium text-ink">{t.saveBar.unsaved}</strong>
        {changes.length > 0 && t.saveBar.unsavedIn(format.list(changes))}
      </span>
    </span>
  );
}

/**
 * Stays at the bottom of the window while the profile has unsaved changes, so saving is always
 * one step away however long the stage panel gets. The document scrolls, so the bar is fixed to
 * the viewport and clears the desktop sidebar rail.
 */
export function SaveBar({
  activeServerCount,
  blocker,
  busy,
  changes,
  confirming,
  error,
  missingModels,
  onBack,
  onConfirm,
  onDiscard,
  onGoTo,
  onSave,
}: {
  activeServerCount: number;
  blocker: SaveBlocker | null;
  busy: boolean;
  changes: readonly string[];
  confirming: boolean;
  error: string | null;
  missingModels: readonly string[];
  onBack: () => void;
  onConfirm: () => void;
  onDiscard: () => void;
  onGoTo: (stage: Stage) => void;
  onSave: () => void;
}) {
  const { t } = useI18n();
  const saveRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const previousConfirming = useRef(confirming);
  // Focus follows the swap between saving and confirming, never the first keystroke of an edit.
  useEffect(() => {
    if (previousConfirming.current === confirming) return;
    previousConfirming.current = confirming;
    (confirming ? confirmRef : saveRef).current?.focus({ preventScroll: true });
  }, [confirming]);

  const firstBlocked = blocker?.stages[0];
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex flex-col gap-2 border-t border-line bg-surface-rail/95 px-4 py-3 backdrop-blur sm:px-6 lg:left-[236px]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <div className="min-w-0 flex-[1_1_260px] text-[12.5px] leading-relaxed text-ink-secondary">
          <SaveBarMessage
            activeServerCount={activeServerCount}
            blocker={blocker}
            changes={changes}
            confirming={confirming}
            missingModels={missingModels}
          />
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {confirming && blocker === null ? (
            <>
              <Button disabled={busy} onClick={onBack} type="button" variant="secondary">
                {t.common.back}
              </Button>
              <Button disabled={busy} onClick={onConfirm} ref={confirmRef} type="button">
                {busy ? t.saveBar.saving : t.saveBar.saveAnyway}
              </Button>
            </>
          ) : (
            <>
              {firstBlocked !== undefined && (
                <Button onClick={() => onGoTo(firstBlocked)} type="button" variant="secondary">
                  {t.saveBar.goTo(t.stages.titles[firstBlocked])}
                </Button>
              )}
              <Button disabled={busy} onClick={onDiscard} type="button" variant="secondary">
                {t.saveBar.discard}
              </Button>
              <Button
                disabled={busy || blocker !== null}
                onClick={onSave}
                ref={saveRef}
                type="button"
              >
                {busy ? t.saveBar.saving : t.saveBar.save}
              </Button>
            </>
          )}
        </div>
      </div>
      {error !== null && <FormError>{error}</FormError>}
    </div>
  );
}
