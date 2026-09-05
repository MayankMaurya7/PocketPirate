import Link from "next/link";

import { AccountMenu } from "@/components/account-menu";

type Section = "expenses" | "stats" | "groups" | "categories";

const NAV: { key: Section; href: string; label: string }[] = [
  { key: "expenses", href: "/", label: "Expenses" },
  { key: "stats", href: "/stats", label: "Stats" },
  { key: "groups", href: "/groups", label: "Groups" },
  { key: "categories", href: "/categories", label: "Categories" },
];

/**
 * Site header: wordmark, the primary nav as underline tabs, and the account
 * menu (gear icon → email + sign out).
 *
 * On phones the tabs form their own full-width row under the wordmark, each
 * tab an equal share; from `sm` up they sit inline between the wordmark and
 * the gear on one 4rem line. In both cases the active tab's underline meets
 * the header's bottom border.
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
            S
          </span>
          <span className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Spendwise
          </span>
        </Link>

        <nav
          aria-label="Primary"
          className="order-last -mb-px flex basis-full items-stretch sm:order-none sm:ml-8 sm:basis-auto sm:self-stretch"
        >
          {NAV.map((item) => {
            const active = item.key === current;
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-1 items-center justify-center whitespace-nowrap border-b-2 px-1 pb-2.5 pt-1 text-sm font-medium transition sm:flex-none sm:px-3 sm:py-0 ${
                  active
                    ? "border-emerald-600 text-zinc-900 dark:border-emerald-500 dark:text-zinc-50"
                    : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-50"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto">
          <AccountMenu email={email} />
        </div>
      </div>
    </header>
  );
}
