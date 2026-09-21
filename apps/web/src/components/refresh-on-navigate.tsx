"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

import { PREFETCHED_PATHS } from "@/components/nav-tabs";
import { markRefreshed, msSinceRefresh } from "@/lib/last-refresh";

/** At most one background refresh per window, however many pages are opened. */
const THROTTLE_MS = 60_000;

/** How long the router keeps a page: `staleTimes` in next.config.ts, in ms. */
const CACHE_MS = 300_000;

/**
 * Show the cached page, then bring it up to date. A page opens instantly
 * from the router cache when it is one of the prefetched tabs, or when it
 * was opened in the last few minutes (leave a group, come straight back) —
 * and what the cache holds may be that old. On arriving at such a page this
 * refreshes the route in the background and React updates whatever
 * changed, in place: no skeleton, and client state (an open form, scroll)
 * is kept. A small "Updating…" pill shows while it runs so a number that
 * changes reads as live, not as a glitch.
 *
 * A page opened for the first time is left alone: the server has just
 * rendered it for this navigation. `router.refresh()` is all-or-nothing in
 * Next (it drops every cached page and re-warms the visible tabs — there is
 * no per-route refresh), hence the throttle. Skipped while offline, where a
 * refresh would land on the offline page.
 */
export function RefreshOnNavigate() {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const previousPathname = useRef<string | null>(null);
  // URL (path + query, since `/?group=…` is cached apart from `/`) → when
  // it was last opened. Emptied by our own refresh, which empties the cache.
  const openedAt = useRef(new Map<string, number>());

  useEffect(() => {
    if (previousPathname.current === pathname) return;
    const firstPage = previousPathname.current === null;
    previousPathname.current = pathname;

    const search = window.location.search;
    const url = pathname + search;
    const now = Date.now();
    const lastOpened = openedAt.current.get(url);
    openedAt.current.set(url, now);

    // The page the browser loaded is fresh by definition.
    if (firstPage) return;

    const fromCache =
      (search === "" && PREFETCHED_PATHS.includes(pathname)) ||
      (lastOpened !== undefined && now - lastOpened < CACHE_MS);
    if (!fromCache) return;
    if (msSinceRefresh() < THROTTLE_MS || !navigator.onLine) return;

    markRefreshed();
    openedAt.current = new Map([[url, now]]);
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
