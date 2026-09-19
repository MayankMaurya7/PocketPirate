"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { markRefreshed } from "@/lib/last-refresh";

/** Coming back sooner than this is a glance at another app, not a return. */
const AWAY_MS = 30_000;

/**
 * Refreshes the current route when the user comes back to the app after
 * being away (installed app reopened, tab switched back to). Renders
 * nothing.
 *
 * The tab links prefetch whole pages and keep them for a few minutes
 * (`staleTimes` in next.config.ts), which is what makes tab switches
 * instant. `router.refresh()` drops every prefetched page and re-warms the
 * visible tabs, so this is what bounds how old another member's change can
 * look after the app has been in the background. It does not unmount
 * client components, so a half-filled form survives it. Skipped while
 * offline: a refresh that cannot reach the server would land on the
 * offline page and take the form with it.
 */
export function RefreshOnResume() {
  const router = useRouter();

  useEffect(() => {
    let hiddenAt: number | null = null;

    function onVisibilityChange() {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      if (away >= AWAY_MS && navigator.onLine) {
        // Stamp the shared clock so RefreshOnNavigate does not repeat this.
        markRefreshed();
        router.refresh();
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router]);

  return null;
}
