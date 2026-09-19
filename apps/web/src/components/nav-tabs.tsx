"use client";

import Link, { useLinkStatus } from "next/link";
import { useState } from "react";

import type { Section } from "@/components/app-header";
import { ChartIcon, ReceiptIcon, TagIcon, UsersIcon } from "@/components/icons";

const NAV: {
  key: Section;
  href: string;
  label: string;
  Icon: (props: { className?: string }) => React.ReactNode;
}[] = [
  { key: "expenses", href: "/", label: "Expenses", Icon: ReceiptIcon },
  { key: "stats", href: "/stats", label: "Stats", Icon: ChartIcon },
  { key: "groups", href: "/groups", label: "Groups", Icon: UsersIcon },
  { key: "categories", href: "/categories", label: "Categories", Icon: TagIcon },
];

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
 * this same nav) takes over.
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
      {NAV.map(({ key, href, label, Icon }) => (
        <Link
          key={key}
          href={href}
          aria-current={key === current ? "page" : undefined}
          onClick={() => setTapped(key)}
          className={`flex flex-1 items-center justify-center whitespace-nowrap font-medium transition max-sm:h-[var(--bottom-nav-h)] max-sm:flex-col max-sm:gap-0.5 max-sm:text-[11px] sm:flex-none sm:border-b-2 sm:px-3 sm:text-sm ${
            key === active
              ? "max-sm:text-emerald-700 max-sm:dark:text-emerald-400 sm:border-emerald-600 sm:text-zinc-900 sm:dark:border-emerald-500 sm:dark:text-zinc-50"
              : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50 sm:border-transparent sm:hover:border-zinc-300 sm:dark:hover:border-zinc-600"
          }`}
        >
          <Icon className="h-5 w-5 sm:hidden" />
          <TabLabel>{label}</TabLabel>
        </Link>
      ))}
    </nav>
  );
}

/** Dims the label while its navigation is pending (Next's link status). */
function TabLabel({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();
  return <span className={pending ? "opacity-60 transition" : ""}>{children}</span>;
}
