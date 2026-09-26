import { createContext, type ReactNode, useEffect, useRef } from "react";

export interface NavigationControl {
  drawerId: string;
  open: boolean;
  show(): void;
}

/** Present only inside the dashboard shell, so headers rendered elsewhere get no menu button. */
export const NavigationContext = createContext<NavigationControl | undefined>(undefined);

/**
 * Below the desktop breakpoint the sidebar lives in a modal dialog: the browser traps focus,
 * closes it on Escape and returns focus to the menu button. Every close path goes through
 * dialog.close() so the parent state follows the native close event.
 */
export function NavigationDrawer({
  children,
  id,
  onClose,
  open,
}: {
  children: (close: () => void) => ReactNode;
  id: string;
  onClose: () => void;
  open: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // The document is the page scroller; keep it still while the drawer covers it.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
    };
  }, [open]);

  const close = () => ref.current?.close();

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click only detects the backdrop; the browser closes the dialog on Escape.
    <dialog
      aria-label="Navegação"
      className="m-0 h-dvh max-h-dvh w-[min(18rem,85vw)] max-w-none border-0 border-r border-line-soft bg-surface-rail p-0 text-ink transition-transform duration-200 ease-out backdrop:bg-black/60 starting:-translate-x-full"
      id={id}
      // A press on the dialog element itself lands on the backdrop, outside the panel content.
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onClose={onClose}
      ref={ref}
    >
      {open && children(close)}
    </dialog>
  );
}
