import { CircleAlert, CircleCheck } from "lucide-react";
import { useEffect } from "react";

export interface Feedback {
  id: number;
  text: string;
  tone: "ok" | "fail";
}

const visibleMs = 4_000;

/** A short confirmation of what just happened, announced politely and gone after a moment. */
export function FeedbackToast({
  feedback,
  onDone,
}: {
  feedback: Feedback | null;
  onDone: () => void;
}) {
  useEffect(() => {
    if (feedback === null) return;
    const timer = setTimeout(onDone, visibleMs);
    return () => clearTimeout(timer);
  }, [feedback, onDone]);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-24 z-40 flex justify-center"
      role="status"
    >
      {feedback !== null && (
        <span
          className={`flex max-w-md items-center gap-2.5 rounded-xl border bg-surface px-3.5 py-2.5 text-[13px] text-ink shadow-xl ${
            feedback.tone === "ok" ? "border-line-strong" : "border-fail/50"
          }`}
          key={feedback.id}
        >
          {feedback.tone === "ok" ? (
            <CircleCheck className="size-4 shrink-0 text-ok" />
          ) : (
            <CircleAlert className="size-4 shrink-0 text-fail" />
          )}
          {feedback.text}
        </span>
      )}
    </div>
  );
}
