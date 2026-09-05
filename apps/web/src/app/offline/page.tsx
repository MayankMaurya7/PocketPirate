import type { Metadata } from "next";

import { RetryButton } from "./retry-button";

export const metadata: Metadata = {
  title: "Offline",
};

/**
 * Shown by the service worker (public/sw.js) in place of any page that could
 * not be fetched because the device is offline. It is precached at install,
 * so it must stay static: no cookies, no data, nothing per-user.
 */
export default function OfflinePage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-12 font-sans dark:bg-zinc-950">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-base font-bold text-white">
            S
          </span>
          <span className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Spendwise
          </span>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            You&rsquo;re offline
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Spendwise needs a connection to show your expenses and balances.
            Reconnect and try again.
          </p>
          <div className="mt-6">
            <RetryButton />
          </div>
        </div>
      </div>
    </main>
  );
}
