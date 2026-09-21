"use client";

import { useEffect, useRef } from "react";

/**
 * How many open dialogs currently hold the body scroll lock. Dialogs stack
 * (a confirm dialog over the expense screen), so the lock is only released
 * when the last one closes — not when the top one does.
 */
let scrollLocks = 0;

function lockBodyScroll() {
  scrollLocks += 1;
  document.body.style.overflow = "hidden";
}

function unlockBodyScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) {
    document.body.style.overflow = "";
  }
}

/**
 * Drives a native <dialog> from React state: `showModal()` when `open`
 * turns true, `close()` when it turns false, and locks body scroll while
 * shown. Shared by `Modal`, `ConfirmDialog` and `ExpenseScreen`.
 */
export function useNativeDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
    if (!open) {
      return;
    }
    // Held for exactly as long as this dialog is open (or until unmount).
    lockBodyScroll();
    return unlockBodyScroll;
  }, [open]);

  return ref;
}

/**
 * True when a dialog event (`close`, `cancel`) was fired by this dialog
 * rather than by one nested inside it. Natively these events do not bubble,
 * but React bubbles them through its own tree (only `scroll` is exempt), so
 * without this check closing a confirm dialog rendered inside a modal also
 * runs the modal's `onClose`. Every dialog handler must go through it.
 */
export function isOwnDialogEvent(event: React.SyntheticEvent<HTMLDialogElement>) {
  return event.target === event.currentTarget;
}

/**
 * A native <dialog> shown modally. Mount it with `open` and render the
 * content inside; the browser handles focus trapping, Escape and the
 * backdrop. Children are only rendered while open, so form state resets
 * each time.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const ref = useNativeDialog(open);

  return (
    <dialog
      ref={ref}
      onClose={(event) => {
        if (isOwnDialogEvent(event)) {
          onClose();
        }
      }}
      onClick={(event) => {
        // Only the backdrop is the dialog element itself; clicks inside the
        // panel land on descendants.
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-xl rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-zinc-950/50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
    >
      {open && (
        <div className="max-h-[85dvh] overflow-y-auto p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
