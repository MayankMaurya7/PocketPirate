"use client";

import { ArrowLeftIcon } from "@/components/icons";
import { isOwnDialogEvent, useNativeDialog } from "@/components/native-dialog";
import {
  UnsavedScope,
  useGuard,
  useUnsavedScope,
} from "@/components/unsaved-changes";

/**
 * The full-height screen an expense is added or edited in. On phones it
 * covers the viewport like a pushed screen — back arrow in a fixed header,
 * the form scrolling between it and a pinned footer; from `sm` up the same
 * structure sits in a centred panel. A native <dialog> gives focus
 * trapping and Escape (= back); the backdrop deliberately does not close
 * it, so a stray tap cannot lose an edit, and Escape and the back arrow ask
 * "Discard changes?" first when the form inside is dirty (the form guards
 * its own Cancel). Children are mounted only while open, so form state
 * resets each time.
 */
export function ExpenseScreen({
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
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none rounded-none border-0 bg-white p-0 text-zinc-900 backdrop:bg-zinc-950/50 sm:m-auto sm:h-auto sm:max-h-[90dvh] sm:w-[calc(100%-2rem)] sm:max-w-xl sm:rounded-2xl sm:border sm:border-zinc-200 sm:shadow-xl dark:bg-zinc-900 dark:text-zinc-100 dark:sm:border-zinc-800"
    >
      {open && (
        <div className="flex h-dvh flex-col sm:h-auto sm:max-h-[90dvh]">
          <div className="flex shrink-0 items-center gap-1 border-b border-zinc-200 px-2 pt-[env(safe-area-inset-top)] dark:border-zinc-800">
            <button
              type="button"
              onClick={() => confirmLeave(onClose)}
              aria-label="Back"
              className="rounded-md p-2 text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            >
              <ArrowLeftIcon />
            </button>
            <h2 className="flex h-14 items-center text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {title}
            </h2>
          </div>
          <UnsavedScope scope={scope}>{children}</UnsavedScope>
        </div>
      )}
    </dialog>
  );
}
