"use client";

import { isOwnDialogEvent, useNativeDialog } from "@/components/native-dialog";
import {
  UnsavedScope,
  useGuard,
  useUnsavedScope,
} from "@/components/unsaved-changes";

/**
 * A native <dialog> shown modally. Mount it with `open` and render the
 * content inside; the browser handles focus trapping, Escape and the
 * backdrop. Every way out (Escape, backdrop, the X) asks "Discard
 * changes?" first when a form inside is dirty. Children are only rendered
 * while open, so form state resets each time.
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
  const scope = useUnsavedScope();
  const confirmLeave = useGuard(scope);

  return (
    <dialog
      ref={ref}
      onClose={(event) => {
        if (isOwnDialogEvent(event)) {
          onClose();
        }
      }}
      onCancel={(event) => {
        if (!isOwnDialogEvent(event)) {
          return;
        }
        // Escape: close through the guard, not underneath it.
        event.preventDefault();
        confirmLeave(onClose);
      }}
      onClick={(event) => {
        // Only the backdrop is the dialog element itself; clicks inside the
        // panel land on descendants.
        if (event.target === event.currentTarget) {
          confirmLeave(onClose);
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
              onClick={() => confirmLeave(onClose)}
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
          <UnsavedScope scope={scope}>{children}</UnsavedScope>
        </div>
      )}
    </dialog>
  );
}
