"use client";

import { useSyncExternalStore } from "react";

import { toLocalDateString } from "@expense-tracker/shared";

const subscribeNoop = () => () => {};

/**
 * "Added 8:50 pm" for a timestamp, in the viewer's timezone. Rendered only
 * after hydration: the server has no idea what timezone the browser is in,
 * so any server-rendered local time would mismatch. If the entry was added
 * on a different day than `date` (a backdated expense), the day is shown
 * too.
 */
export function AddedAt({ iso, date }: { iso: string; date: string }) {
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  if (!mounted) {
    return null;
  }

  const added = new Date(iso);
  const sameDay = toLocalDateString(added) === date;
  const text = added.toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    ...(sameDay ? {} : { day: "numeric", month: "short" }),
  });

  return <> · added {text}</>;
}
