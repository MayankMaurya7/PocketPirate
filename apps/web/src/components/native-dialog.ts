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
