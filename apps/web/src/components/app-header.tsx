import { AccountMenu } from "@/components/account-menu";
import { GuardedLink } from "@/components/guarded-link";
import { NavTabs } from "@/components/nav-tabs";

export type Section = "expenses" | "stats" | "groups" | "categories";

/**
 * Site header: wordmark, the primary nav (`NavTabs`, a client component so
 * the tapped tab lights up before the page arrives), and the account menu
 * (gear icon → email + sign out).
 *
 * On phones the header is one 3.5rem row of wordmark + gear, and the nav
 * lifts out of it into a bar fixed to the bottom of the viewport; from
 * `sm` up the tabs sit inline between the wordmark and the gear on one
 * 4rem line. Every page that renders this header therefore gets the
 * bottom bar, and its `main` must pad for `--bottom-nav-space`.
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
      <div className="mx-auto flex h-14 w-full max-w-3xl items-center px-4 sm:h-16">
        <GuardedLink href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-sm font-bold text-white">
            P
          </span>
          <span className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            PocketPirate
          </span>
        </GuardedLink>

        <NavTabs current={current} />

        <div className="ml-auto">
          <AccountMenu email={email} />
        </div>
      </div>
    </header>
  );
}
