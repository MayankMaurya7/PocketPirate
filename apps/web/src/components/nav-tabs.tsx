"use client";

import Link, { useLinkStatus } from "next/link";
import { useState } from "react";

import type { Section } from "@/components/app-header";

const NAV: { key: Section; href: string; label: string }[] = [
  { key: "expenses", href: "/", label: "Expenses" },
  { key: "stats", href: "/stats", label: "Stats" },
  { key: "groups", href: "/groups", label: "Groups" },
  { key: "categories", href: "/categories", label: "Categories" },
];

/**
 * The primary nav as underline tabs. The tapped tab is highlighted the
 * moment it is tapped — before the server has answered — so the tap is
 * acknowledged; the underline then stays with it as the new page (and
 * its loading skeleton, which renders this same header) takes over.
 */
export function NavTabs({ current }: { current: Section }) {
  // Where the user is heading, until the route actually changes.
  const [tapped, setTapped] = useState<Section | null>(null);
  const active = tapped ?? current;

  return (
    <nav
      aria-label="Primary"
      className="order-last -mb-px flex basis-full items-stretch sm:order-none sm:ml-8 sm:basis-auto sm:self-stretch"
    >
      {NAV.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.key === current ? "page" : undefined}
          onClick={() => setTapped(item.key)}
          className={`flex flex-1 items-center justify-center whitespace-nowrap border-b-2 px-1 pb-2.5 pt-1 text-sm font-medium transition sm:flex-none sm:px-3 sm:py-0 ${
            item.key === active
              ? "border-emerald-600 text-zinc-900 dark:border-emerald-500 dark:text-zinc-50"
              : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-50"
          }`}
        >
          <TabLabel>{item.label}</TabLabel>
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
