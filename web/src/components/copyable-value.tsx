import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

export function CopyableValue({ copyLabel, value }: { copyLabel: string; value: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_600);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-raised px-3 py-2">
      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">{value}</span>
      <button
        aria-label={copyLabel}
        className="touch-target grid size-6 place-items-center rounded text-ink-dim transition-colors hover:bg-surface-inset hover:text-ink"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
        type="button"
      >
        {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}
