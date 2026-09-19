"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

import { PREFETCHED_PATHS } from "@/components/nav-tabs";
import { markRefreshed, msSinceRefresh } from "@/lib/last-refresh";

/** At most one background refresh per window, however many tabs are tapped. */
const THROTTLE_MS = 60_000;

/**
 * Show the cached page, then bring it up to date. The prefetched tabs open
 * instantly from the router cache, which may be a few minutes old
 * (`staleTimes` in next.config.ts); on arriving at one, this refreshes the
 * route in the background and React updates whatever changed, in place — no
 * skeleton, and client state (an open form, scroll) is kept. A small
 * "Updating…" pill shows while it runs so a number that changes reads as
 * live, not as a glitch.
 *
 * Only for the prefetched paths: any other page was just rendered by the
 * server for this navigation. `router.refresh()` is all-or-nothing in Next
 * (it drops every prefetched page and re-warms the visible tabs — there is
 * no per-route refresh), hence the throttle. Skipped while offline, where a
 * refresh would land on the offline page.
 */
export function RefreshOnNavigate() {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const previousPathname = useRef(pathname);

  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;

    if (!PREFETCHED_PATHS.includes(pathname)) return;
    if (msSinceRefresh() < THROTTLE_MS || !navigator.onLine) return;

    markRefreshed();
    startTransition(() => {
      router.refresh();
    });
  }, [pathname, router]);

  return (
    <div
      role="status"
      className={`pointer-events-none fixed bottom-[calc(var(--bottom-nav-space)+0.75rem)] left-1/2 z-10 -translate-x-1/2 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-500 shadow-sm transition-opacity dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 ${
        isPending ? "opacity-100" : "opacity-0"
      }`}
    >
      {isPending ? "Updating…" : null}
    </div>
  );
}
