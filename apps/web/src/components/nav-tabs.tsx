"use client";

import { useLinkStatus } from "next/link";
import { useState } from "react";

import type { Section } from "@/components/app-header";
import { GuardedLink } from "@/components/guarded-link";
import { ChartIcon, ReceiptIcon, TagIcon, UsersIcon } from "@/components/icons";

const NAV: {
  key: Section;
  href: string;
  label: string;
  Icon: (props: { className?: string }) => React.ReactNode;
  /**
   * Fetch the whole page in the background as soon as the tab is visible,
   * not just its loading skeleton, so the tab opens instantly from the
   * router cache (see `staleTimes` in next.config.ts; production only, dev
   * never prefetches). Off for Stats: its paging query is the heaviest in
   * the app and would re-run after every refresh from any tab.
   */
  prefetch: boolean;
}[] = [
  { key: "expenses", href: "/", label: "Expenses", Icon: ReceiptIcon, prefetch: true },
  { key: "stats", href: "/stats", label: "Stats", Icon: ChartIcon, prefetch: false },
  { key: "groups", href: "/groups", label: "Groups", Icon: UsersIcon, prefetch: true },
  { key: "categories", href: "/categories", label: "Categories", Icon: TagIcon, prefetch: true },
];

/** Pages served from the router cache on a tab tap (`RefreshOnNavigate`). */
export const PREFETCHED_PATHS = NAV.filter((item) => item.prefetch).map(
  (item) => item.href,
);

/**
 * The primary nav: one set of links, two shapes. On phones it is a bar
 * fixed to the bottom of the viewport (icon over label, within thumb
 * reach, padded for the home indicator; `--bottom-nav-h` in globals.css
 * is its height and what page padding is built on). From `sm` up it is
 * the underline tabs inside the header, the active underline meeting the
 * header's bottom border.
 *
 * The tapped tab is highlighted the moment it is tapped — before the
 * server has answered — so the tap is acknowledged; the highlight then
 * stays with it as the new page (and its loading skeleton, which renders
 * this same nav) takes over. A tap that the unsaved-changes guard holds
 * back lights nothing up until "Discard changes" lets it through.
 */
export function NavTabs({ current }: { current: Section }) {
  // Where the user is heading, until the route actually changes.
  const [tapped, setTapped] = useState<Section | null>(null);
  const active = tapped ?? current;

  return (
    <nav
      aria-label="Primary"
      className="flex items-stretch max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-10 max-sm:border-t max-sm:border-zinc-200 max-sm:bg-white max-sm:pb-[env(safe-area-inset-bottom)] max-sm:dark:border-zinc-800 max-sm:dark:bg-zinc-900 sm:-mb-px sm:ml-8 sm:self-stretch"
    >
      {NAV.map(({ key, href, label, Icon, prefetch }) => (
        <GuardedLink
          key={key}
          href={href}
          // `null` is Next's default: prefetch up to the loading skeleton.
          prefetch={prefetch ? true : null}
          aria-current={key === current ? "page" : undefined}
          onNavigate={() => setTapped(key)}
          className={`flex flex-1 items-center justify-center whitespace-nowrap font-medium transition max-sm:h-[var(--bottom-nav-h)] max-sm:flex-col max-sm:gap-0.5 max-sm:text-[11px] sm:flex-none sm:border-b-2 sm:px-3 sm:text-sm ${
            key === active
              ? "max-sm:text-emerald-700 max-sm:dark:text-emerald-400 sm:border-emerald-600 sm:text-zinc-900 sm:dark:border-emerald-500 sm:dark:text-zinc-50"
              : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50 sm:border-transparent sm:hover:border-zinc-300 sm:dark:hover:border-zinc-600"
          }`}
        >
          <Icon className="h-5 w-5 sm:hidden" />
          <TabLabel>{label}</TabLabel>
        </GuardedLink>
      ))}
    </nav>
  );
}

/** Dims the label while its navigation is pending (Next's link status). */
function TabLabel({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();
  return <span className={pending ? "opacity-60 transition" : ""}>{children}</span>;
}
