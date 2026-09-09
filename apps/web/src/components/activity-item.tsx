"use client";

import { LocalTime } from "@/components/added-at";
import { ChevronDownIcon, HistoryIcon } from "@/components/icons";
import { activitySubject, describeActivity } from "@/lib/activity";
import { groupMemberNamer } from "@/lib/members";
import type { ActivityEntry, GroupOption } from "@/lib/types";

/**
 * One line of the activity trail — "Bob edited Groceries" or "Bob deleted
 * Groceries (₹300)" — collapsed to a single quiet row that expands
 * (native <details>) to the field-level changes. Creations are not shown
 * here: the expense or payment row itself already says who added it and
 * when. `compact` drops the leading icon for use inside the edit screen.
 *
 * People are named from `group`'s current members (the viewer as "you",
 * anyone who has left as "a former member"). The namer is built here, not
 * passed in: this is a client component and the timeline that renders it
 * is a server component, and a function prop cannot cross that boundary
 * (it crashed every group page whose trail had an entry, 2026-09-09).
 */
export function ActivityItem({
  entry,
  group,
  userId,
  compact = false,
}: {
  entry: ActivityEntry;
  group: GroupOption | undefined;
  userId: string;
  compact?: boolean;
}) {
  const nameOf = groupMemberNamer(group, userId);
  const actor = entry.actor_id
    ? nameOf(entry.actor_id, { sentence: true })
    : "Someone";
  const subject = activitySubject(entry);
  const lines = entry.action === "edited" ? describeActivity(entry, nameOf) : [];
  const verb = entry.action === "deleted" ? "deleted" : "edited";
  const expandable = lines.length > 0 || entry.action === "deleted";

  const summary = (
    <>
      <span className="font-medium text-zinc-700 dark:text-zinc-200">{actor}</span>{" "}
      {verb}{" "}
      <span className="font-medium text-zinc-700 dark:text-zinc-200">
        {subject.title}
      </span>
      {entry.action === "deleted" && subject.amount && (
        <span className="tabular-nums"> ({subject.amount})</span>
      )}
      <span className="text-zinc-400 dark:text-zinc-500">
        {" · "}
        <LocalTime iso={entry.created_at} />
      </span>
    </>
  );

  const rowClass = `flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400 ${
    compact ? "px-0 py-2" : "px-4 py-2.5 sm:px-5"
  }`;

  if (!expandable) {
    return (
      <li className={rowClass}>
        {!compact && <TrailIcon />}
        <p className="min-w-0 flex-1">{summary}</p>
      </li>
    );
  }

  return (
    <li className={compact ? "" : "px-4 sm:px-5"}>
      <details className="group">
        <summary
          className={`${rowClass} list-none px-0 sm:px-0 [&::-webkit-details-marker]:hidden`}
        >
          {!compact && <TrailIcon />}
          <p className="min-w-0 flex-1">{summary}</p>
          <span className="transition-transform group-open:rotate-180">
            <ChevronDownIcon />
          </span>
        </summary>
        <dl
          className={`mb-2.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg bg-zinc-50 px-3 py-2 text-xs dark:bg-zinc-800/60 ${
            compact ? "" : "ml-9"
          }`}
        >
          {entry.action === "deleted" ? (
            <>
              <dt className="text-zinc-500 dark:text-zinc-400">Was</dt>
              <dd className="text-zinc-700 dark:text-zinc-200">
                {subject.title}
                {subject.amount && (
                  <span className="tabular-nums"> · {subject.amount}</span>
                )}
              </dd>
            </>
          ) : (
            lines.map((line) => (
              <ChangeLine key={line.label + line.from + line.to} {...line} />
            ))
          )}
        </dl>
      </details>
    </li>
  );
}

function ChangeLine({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <>
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="min-w-0 break-words text-zinc-700 dark:text-zinc-200">
        {to === "" ? (
          from
        ) : (
          <>
            <span className="text-zinc-400 line-through dark:text-zinc-500">{from}</span>
            {" → "}
            {to}
          </>
        )}
      </dd>
    </>
  );
}

function TrailIcon() {
  return (
    <span
      aria-hidden="true"
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"
    >
      <HistoryIcon />
    </span>
  );
}
