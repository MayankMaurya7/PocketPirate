import { formatMonth } from "@expense-tracker/shared";

import { ActivityItem } from "@/components/activity-item";
import { ExpenseItem } from "@/components/expense-item";
import { SettlementItem } from "@/components/settlement-item";
import { groupMemberNamer } from "@/lib/members";
import type {
  ActivityEntry,
  CategoryOption,
  ExpenseListItem,
  GroupOption,
  MemberLabels,
  Settlement,
} from "@/lib/types";

type TimelineEntry =
  | { kind: "expense"; date: string; createdAt: string; expense: ExpenseListItem }
  | { kind: "settlement"; date: string; createdAt: string; settlement: Settlement }
  | { kind: "activity"; date: string; createdAt: string; entry: ActivityEntry };

/**
 * One list of everything that happened in a group — expenses, recorded
 * payments and the trail of edits and deletions — newest first, grouped
 * by month. Expenses and payments sit on their own date; a trail entry on
 * the day it happened. Within a day, the most recent comes first.
 * Creations are left out of the trail: the row itself says who added it.
 */
export function GroupTimeline({
  expenses,
  settlements,
  activity,
  categories,
  groups,
  userId,
  labels,
}: {
  expenses: ExpenseListItem[];
  settlements: Settlement[];
  activity: ActivityEntry[];
  categories: CategoryOption[];
  groups: GroupOption[];
  userId: string;
  labels: MemberLabels;
}) {
  const group = groups[0];
  const nameOf = groupMemberNamer(group, userId);

  // Each expense's own trail, for its edit screen.
  const trailByExpense = new Map<string, ActivityEntry[]>();
  for (const entry of activity) {
    if (entry.entity_kind === "expense" && entry.action !== "created") {
      const list = trailByExpense.get(entry.entity_id) ?? [];
      list.push(entry);
      trailByExpense.set(entry.entity_id, list);
    }
  }

  const entries: TimelineEntry[] = [
    ...expenses.map((expense) => ({
      kind: "expense" as const,
      date: expense.expense_date,
      createdAt: expense.created_at,
      expense,
    })),
    ...settlements.map((settlement) => ({
      kind: "settlement" as const,
      date: settlement.settled_on,
      createdAt: settlement.created_at,
      settlement,
    })),
    ...activity
      .filter((entry) => entry.action !== "created")
      .map((entry) => ({
        kind: "activity" as const,
        date: entry.created_at.slice(0, 10),
        createdAt: entry.created_at,
        entry,
      })),
  ].sort(
    (a, b) =>
      b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
  );

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Nothing here yet
        </p>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Add the first expense — anyone in the group can, on their own or
          another member&apos;s behalf.
        </p>
      </div>
    );
  }

  // Month buckets in the order the entries already have.
  const months: { key: string; label: string; entries: TimelineEntry[] }[] = [];
  for (const entry of entries) {
    const key = entry.date.slice(0, 7);
    let month = months[months.length - 1];
    if (!month || month.key !== key) {
      month = {
        key,
        label: formatMonth(key),
        entries: [],
      };
      months.push(month);
    }
    month.entries.push(entry);
  }

  return (
    <div className="space-y-5">
      {months.map((month) => (
        <section key={month.key}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {month.label}
          </h3>
          <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 bg-white shadow-sm dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {month.entries.map((entry) => {
              switch (entry.kind) {
                case "expense":
                  return (
                    <ExpenseItem
                      key={`e-${entry.expense.id}`}
                      expense={entry.expense}
                      categories={categories}
                      groups={groups}
                      userId={userId}
                      showGroup={false}
                      activity={trailByExpense.get(entry.expense.id) ?? []}
                    />
                  );
                case "settlement":
                  return (
                    <SettlementItem
                      key={`s-${entry.settlement.id}`}
                      settlement={entry.settlement}
                      group={group}
                      userId={userId}
                      labels={labels}
                    />
                  );
                case "activity":
                  return (
                    <ActivityItem
                      key={`a-${entry.entry.id}`}
                      entry={entry.entry}
                      nameOf={nameOf}
                    />
                  );
              }
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
