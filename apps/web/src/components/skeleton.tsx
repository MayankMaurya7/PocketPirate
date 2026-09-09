import { AppHeader, type Section } from "@/components/app-header";

/** A grey placeholder block. */
export function Bone({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-zinc-200 dark:bg-zinc-800 ${className}`}
    />
  );
}

/** A card of `rows` list-row placeholders, shaped like the real list rows. */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 bg-white shadow-sm dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className="flex items-center gap-3 px-4 py-3 sm:gap-4 sm:px-5 sm:py-4">
          <Bone className="h-2.5 w-2.5 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Bone className="h-3.5 w-2/5" />
            <Bone className="h-3 w-3/5" />
          </div>
          <Bone className="h-3.5 w-14" />
        </li>
      ))}
    </ul>
  );
}

/**
 * The shell every route's `loading.tsx` renders while its server component
 * fetches: the real header (so the tapped tab is already active) and a
 * page-shaped placeholder. Painted immediately on navigation, and Next
 * prefetches links up to this boundary so tabs open instantly.
 */
export function PageSkeleton({
  current,
  title,
  children,
}: {
  current: Section;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-zinc-950">
      <AppHeader email="" current={current} />
      <main
        aria-busy="true"
        className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:py-10"
      >
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {title}
        </h1>
        {children}
      </main>
    </div>
  );
}
