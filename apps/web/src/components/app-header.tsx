import Link from "next/link";

import { AccountMenu } from "@/components/account-menu";
import { NavTabs } from "@/components/nav-tabs";

export type Section = "expenses" | "stats" | "groups" | "categories";

/**
 * Site header: wordmark, the primary nav as underline tabs (`NavTabs`, a
 * client component so the tapped tab lights up before the page arrives),
 * and the account menu (gear icon → email + sign out).
 *
 * On phones the tabs form their own full-width row under the wordmark,
 * each tab an equal share; from `sm` up they sit inline between the
 * wordmark and the gear on one 4rem line. In both cases the active tab's
 * underline meets the header's bottom border.
 */
export function AppHeader({
  email,
  current,
}: {
  email: string;
  current: Section;
}) {
  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center px-4 sm:h-16 sm:flex-nowrap">
        <Link href="/" className="flex h-14 items-center gap-2 sm:h-auto">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-sm font-bold text-white">
            P
          </span>
          <span className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            PocketPirate
          </span>
        </Link>

        <NavTabs current={current} />

        <div className="ml-auto">
          <AccountMenu email={email} />
        </div>
      </div>
    </header>
  );
}
