"use client";

import { useEffect, useEffectEvent } from "react";

import { ArrowLeftIcon } from "@/components/icons";
import { isOwnDialogEvent, useNativeDialog } from "@/components/native-dialog";
import {
  UnsavedScope,
  useGuard,
  useUnsavedScope,
} from "@/components/unsaved-changes";

/**
 * History traversals this module started itself (`history.back()` after a
 * UI close, `history.forward()` to stay on a dirty form) and whose
 * `popstate` must therefore not be read as the person pressing Back.
 * Module-level because the traversal is asynchronous: its event can arrive
 * after the screen that asked for it has closed and another has opened.
 */
let ownTraversals = 0;

/** The deferred `history.back()` of the screen that closed last, if any. */
let pendingBack: ReturnType<typeof setTimeout> | null = null;

/** The open screen's Back handler; only one screen is open at a time. */
let activeBackHandler: (() => void) | null = null;
let listening = false;

/**
 * One permanent listener rather than one per open screen: the `popstate`
 * of the `history.back()` that follows a UI close arrives when no screen is
 * open, and must still be counted off `ownTraversals` or the next real Back
 * would be swallowed.
 */
function listenForPopState() {
  if (listening) {
    return;
  }
  listening = true;
  window.addEventListener("popstate", () => {
    if (ownTraversals > 0) {
      ownTraversals -= 1;
      return;
    }
    activeBackHandler?.();
  });
}

/**
 * Makes the phone's Back (button, edge swipe) close the screen instead of
 * leaving the page under it: opening pushes one history entry, and the
 * `popstate` that takes it away calls `onBack`. `onBack` returns true when
 * the screen stays up for now (it is asking "Discard changes?"); the entry
 * is then restored with `history.forward()` — not a fresh `pushState`, which
 * Chrome's history-manipulation intervention would hold against the page
 * because no tap preceded it. A close from the UI takes the entry away
 * again with one `history.back()`.
 *
 * The entry is pushed without a URL, so Next's patched `pushState` copies
 * its router state into it and dispatches nothing; both `popstate`s reach
 * Next as a traverse to the URL and tree it is already showing. Nothing is
 * stored in `history.state` to recognise the entry by: a `router.refresh()`
 * while the screen is open rewrites the current entry's state.
 *
 * On Android, Chrome hands Back to the open <dialog> as a `cancel` event
 * before it touches history, so there this only removes the entry on close;
 * iOS has no such thing and relies on the `popstate` path.
 */
function useBackToClose(open: boolean, onBack: () => boolean) {
  const handleBack = useEffectEvent(onBack);

  useEffect(() => {
    if (!open) {
      return;
    }
    const href = window.location.href;
    if (pendingBack !== null) {
      // Closed and reopened within one tick (dev strict mode re-running
      // this effect, or a very fast tap): the entry is still there.
      clearTimeout(pendingBack);
      pendingBack = null;
    } else {
      window.history.pushState(null, "");
    }
    let held = true;

    function onBackPressed() {
      if (window.location.href !== href) {
        // A jump of several entries landed on another page; Next is
        // already swapping this one out.
        held = false;
        return;
      }
      if (handleBack()) {
        ownTraversals += 1;
        window.history.forward();
      } else {
        held = false;
      }
    }

    listenForPopState();
    activeBackHandler = onBackPressed;
    return () => {
      if (activeBackHandler === onBackPressed) {
        activeBackHandler = null;
      }
      if (!held) {
        return;
      }
      pendingBack = setTimeout(() => {
        pendingBack = null;
        if (window.location.href === href) {
          ownTraversals += 1;
          window.history.back();
        }
      }, 0);
    };
  }, [open]);
}

/**
 * The full-height screen an expense is added or edited in. On phones it
 * covers the viewport like a pushed screen — back arrow in a fixed header,
 * the form scrolling between it and a pinned footer; from `sm` up the same
 * structure sits in a centred panel. A native <dialog> gives focus
 * trapping and Escape (= back); the backdrop deliberately does not close
 * it, so a stray tap cannot lose an edit, and Escape, the back arrow and the
 * phone's Back (`useBackToClose`) ask "Discard changes?" first when the form
 * inside is dirty (the form guards its own Cancel). Children are mounted only while open, so form state
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

  useBackToClose(open, () => {
    if (!scope.dirty) {
      onClose();
      return false;
    }
    confirmLeave(onClose);
    return true;
  });

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
