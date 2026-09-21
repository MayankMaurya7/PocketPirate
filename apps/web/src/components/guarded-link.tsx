"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useGuard, useHasUnsavedChanges } from "@/components/unsaved-changes";

/**
 * `next/link` that asks "Discard changes?" before leaving a page with a
 * dirty form (see `unsaved-changes.tsx`). With nothing dirty it is a plain
 * link. `onNavigate` here takes no event and runs when the navigation
 * really goes ahead — straight away, or after "Discard changes" — so a
 * caller can acknowledge the tap without lighting up a blocked one.
 *
 * Only client-side navigations are intercepted (Next does not fire
 * `onNavigate` for modified clicks that open a new tab, which lose nothing).
 */
export function GuardedLink({
  href,
  onNavigate,
  ...props
}: Omit<React.ComponentProps<typeof Link>, "href" | "onNavigate"> & {
  href: string;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const confirmLeave = useGuard();
  const hasUnsavedChanges = useHasUnsavedChanges();

  return (
    <Link
      {...props}
      href={href}
      onNavigate={(event) => {
        if (!hasUnsavedChanges()) {
          // Let Next navigate itself, so `useLinkStatus` keeps working.
          onNavigate?.();
          return;
        }
        event.preventDefault();
        confirmLeave(() => {
          onNavigate?.();
          router.push(href);
        });
      }}
    />
  );
}
