"use client";

import { useId } from "react";

import { AlertTriangleIcon } from "@/components/icons";
import { isOwnDialogEvent, useNativeDialog } from "@/components/native-dialog";

/**
 * In-app replacement for `window.confirm` on destructive actions.
 *
 * Why not the native one: it looks foreign to the app, cannot be styled or
 * themed, blocks the whole tab, shows a generic "OK", and vanishes before
 * the action runs — so a failure has nowhere to land. This dialog names the
 * action on its button ("Delete expense", never "OK"), leads with the
 * consequence, keeps the safe choice focused by default (Escape and the
 * backdrop both cancel), stays open with a spinner label while the action
 * runs, and shows the failure inside itself so the person can retry or
 * cancel with the context still in view.
 *
 * The caller owns the async work and its state: `pending` and `error`
 * come in as props, `onConfirm` runs the action, and the caller closes the
 * dialog by flipping `open` when it succeeds. Buttons stack on phones
 * (primary on top) and sit right-aligned in a row from `sm` up; Cancel is
 * first in DOM order so it takes the initial focus either way.
 */
export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  description,
  confirmLabel,
  pendingLabel,
  cancelLabel = "Cancel",
  pending = false,
  error = null,
  tone = "danger",
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  /** What will happen, in one or two sentences. */
  description: React.ReactNode;
  /** Verb + object, e.g. "Delete expense". */
  confirmLabel: string;
  /** Shown on the confirm button while `pending`; defaults to "Working…". */
  pendingLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  error?: string | null;
  tone?: "danger" | "default";
}) {
  const ref = useNativeDialog(open);
  const titleId = useId();
  const descriptionId = useId();

  return (
    <dialog
      ref={ref}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClose={(event) => {
        if (isOwnDialogEvent(event)) {
          onCancel();
        }
      }}
      onCancel={(event) => {
        if (!isOwnDialogEvent(event)) {
          return;
        }
        // Escape: let the caller decide (it may keep the dialog open while
        // pending), rather than the browser closing it underneath us.
        event.preventDefault();
        if (!pending) {
          onCancel();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) {
          onCancel();
        }
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-xl outline-none backdrop:bg-zinc-950/50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
    >
      {open && (
        <div className="p-5 sm:p-6">
          <div className="flex gap-4">
            {tone === "danger" && (
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400"
              >
                <AlertTriangleIcon />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h2
                id={titleId}
                className="text-base font-semibold text-zinc-900 dark:text-zinc-50"
              >
                {title}
              </h2>
              <div
                id={descriptionId}
                className="mt-1.5 text-sm leading-6 text-zinc-600 dark:text-zinc-400"
              >
                {description}
              </div>
              {error && (
                <p
                  role="alert"
                  className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300"
                >
                  {error}
                </p>
              )}
            </div>
          </div>

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              autoFocus
              onClick={onCancel}
              disabled={pending}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus:ring-offset-zinc-900"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={pending}
              className={`rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm transition focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-zinc-900 ${
                tone === "danger"
                  ? "bg-red-600 hover:bg-red-700 focus:ring-red-500"
                  : "bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500"
              }`}
            >
              {pending ? (pendingLabel ?? "Working…") : confirmLabel}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
