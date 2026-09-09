import { formatMonth } from "@expense-tracker/shared";

import { ActivityItem } from "@/components/activity-item";
import { ExpenseItem } from "@/components/expense-item";
import { SettlementItem } from "@/components/settlement-item";
import { activitySnapshot } from "@/lib/activity";
import type {
  ActivityEntry,
  CategoryOption,
  ExpenseListItem,
  GroupOption,
  MemberLabels,
  Settlement,
} from "@/lib/types";

/**
 * Where a row sits in the list: the expense's or payment's own date, then
 * when it was added (`anchorAt`), then the moment of the row itself (`at`).
 * A trail entry borrows the first two from the row it is about, so it lands
 * directly above that row — newer first — instead of floating to the top of
 * the list on the day of the edit.
 */
type Placement = { date: string; anchorAt: string; at: string };

type TimelineEntry = Placement &
  (
    | { kind: "expense"; expense: ExpenseListItem }
    | { kind: "settlement"; settlement: Settlement }
    | { kind: "activity"; entry: ActivityEntry }
  );

/**
 * One list of everything that happened in a group — expenses, recorded
 * payments and the trail of edits and deletions — newest first, grouped
 * by month. Expenses and payments sit on their own date; within a day the
 * most recently added comes first. An edit or deletion sits with the row
 * it changed: just above it while the row exists, and on the row's last
 * known date (from the snapshot) once it has been deleted. Creations are
 * left out of the trail: the row itself says who added it.
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

  // Each expense's own trail, for its edit screen.
  const trailByExpense = new Map<string, ActivityEntry[]>();
  for (const entry of activity) {
    if (entry.entity_kind === "expense" && entry.action !== "created") {
      const list = trailByExpense.get(entry.entity_id) ?? [];
      list.push(entry);
      trailByExpense.set(entry.entity_id, list);
    }
  }

  const expenseById = new Map(expenses.map((expense) => [expense.id, expense]));
  const settlementById = new Map(
    settlements.map((settlement) => [settlement.id, settlement]),
  );

  // A trail entry goes where its row is; a deleted row's entry goes where
  // the row was, on the date the snapshot remembers.
  const placeEntry = (entry: ActivityEntry): Placement => {
    const at = entry.created_at;
    if (entry.entity_kind === "expense") {
      const expense = expenseById.get(entry.entity_id);
      if (expense) {
        return { date: expense.expense_date, anchorAt: expense.created_at, at };
      }
    } else {
      const settlement = settlementById.get(entry.entity_id);
      if (settlement) {
        return { date: settlement.settled_on, anchorAt: settlement.created_at, at };
      }
    }
    const remembered =
      activitySnapshot(entry)[
        entry.entity_kind === "expense" ? "expense_date" : "settled_on"
      ];
    return {
      date: typeof remembered === "string" ? remembered : at.slice(0, 10),
      anchorAt: at,
      at,
    };
  };

  const entries: TimelineEntry[] = [
    ...expenses.map((expense) => ({
      kind: "expense" as const,
      date: expense.expense_date,
      anchorAt: expense.created_at,
      at: expense.created_at,
      expense,
    })),
    ...settlements.map((settlement) => ({
      kind: "settlement" as const,
      date: settlement.settled_on,
      anchorAt: settlement.created_at,
      at: settlement.created_at,
      settlement,
    })),
    ...activity
      .filter((entry) => entry.action !== "created")
      .map((entry) => ({ kind: "activity" as const, ...placeEntry(entry), entry })),
  ].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      b.anchorAt.localeCompare(a.anchorAt) ||
      b.at.localeCompare(a.at),
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
                      group={group}
                      userId={userId}
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
