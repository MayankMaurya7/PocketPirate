import Link from "next/link";

import { SignOutButton } from "@/components/sign-out-button";

const navLinkClasses =
  "rounded-md px-2.5 py-1.5 text-sm font-medium transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50";

/** Site header: wordmark, primary nav, signed-in email, sign-out. */
export function AppHeader({
  email,
  current,
}: {
  email: string;
  current: "expenses" | "stats" | "groups" | "categories";
}) {
  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-sm font-bold text-white">
              S
            </span>
            <span className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Spendwise
            </span>
          </Link>

          <nav aria-label="Primary" className="flex items-center gap-1">
            <Link
              href="/"
              aria-current={current === "expenses" ? "page" : undefined}
              className={`${navLinkClasses} ${
                current === "expenses"
                  ? "text-zinc-900 dark:text-zinc-50"
                  : "text-zinc-500 dark:text-zinc-400"
              }`}
            >
              Expenses
            </Link>
            <Link
              href="/stats"
              aria-current={current === "stats" ? "page" : undefined}
              className={`${navLinkClasses} ${
                current === "stats"
                  ? "text-zinc-900 dark:text-zinc-50"
                  : "text-zinc-500 dark:text-zinc-400"
              }`}
            >
              Stats
            </Link>
            <Link
              href="/groups"
              aria-current={current === "groups" ? "page" : undefined}
              className={`${navLinkClasses} ${
                current === "groups"
                  ? "text-zinc-900 dark:text-zinc-50"
                  : "text-zinc-500 dark:text-zinc-400"
              }`}
            >
              Groups
            </Link>
            <Link
              href="/categories"
              aria-current={current === "categories" ? "page" : undefined}
              className={`${navLinkClasses} ${
                current === "categories"
                  ? "text-zinc-900 dark:text-zinc-50"
                  : "text-zinc-500 dark:text-zinc-400"
              }`}
            >
              Categories
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-zinc-600 sm:block dark:text-zinc-400">
            {email}
          </span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
