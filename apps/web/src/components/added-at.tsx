"use client";

import { useSyncExternalStore } from "react";

import { toLocalDateString } from "@expense-tracker/shared";

const subscribeNoop = () => () => {};

/** True once hydrated — the only time the browser's timezone is known. */
export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

/**
 * A timestamp as a local time ("8:50 pm"), rendered only after hydration:
 * the server has no idea what timezone the browser is in, so any
 * server-rendered local time would mismatch. Pass `date` to show the day
 * as well whenever the timestamp fell on a different local day than it
 * (a backdated expense); omit it to show the day always.
 */
export function LocalTime({ iso, date }: { iso: string; date?: string }) {
  const mounted = useMounted();

  if (!mounted) {
    return null;
  }

  const at = new Date(iso);
  const sameDay = date !== undefined && toLocalDateString(at) === date;
  return (
    <>
      {at.toLocaleString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        ...(sameDay ? {} : { day: "numeric", month: "short" }),
      })}
    </>
  );
}

/** " · added 8:50 pm" for a list row's meta line. */
export function AddedAt({ iso, date }: { iso: string; date: string }) {
  const mounted = useMounted();

  if (!mounted) {
    return null;
  }

  return (
    <>
      {" · added "}
      <LocalTime iso={iso} date={date} />
    </>
  );
}
