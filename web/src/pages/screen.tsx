import type { ReactNode } from "react";

/** Scrollable body of every dashboard screen, below the fixed header. */
export function Screen({
  children,
  width = "wide",
}: {
  children: ReactNode;
  width?: "wide" | "narrow";
}) {
  return (
    <main className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <div className={`mx-auto flex flex-col gap-6 ${width === "narrow" ? "max-w-3xl" : ""}`}>
        {children}
      </div>
    </main>
  );
}
