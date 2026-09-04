import { ExpenseItem } from "@/components/expense-item";
import { SettlementItem } from "@/components/settlement-item";
import type {
  CategoryOption,
  ExpenseListItem,
  GroupOption,
  MemberLabels,
  Settlement,
} from "@/lib/types";

type TimelineEntry =
  | { kind: "expense"; date: string; createdAt: string; expense: ExpenseListItem }
  | { kind: "settlement"; date: string; createdAt: string; settlement: Settlement };

/**
 * One list of everything that happened in a group — expenses and recorded
 * payments — newest first, grouped by month. Within a day, the entry added
 * most recently comes first.
 */
export function GroupTimeline({
  expenses,
  settlements,
  categories,
  groups,
  userId,
  labels,
}: {
  expenses: ExpenseListItem[];
  settlements: Settlement[];
  categories: CategoryOption[];
  groups: GroupOption[];
  userId: string;
  labels: MemberLabels;
}) {
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
        label: new Date(`${key}-01T00:00:00`).toLocaleDateString(undefined, {
          month: "long",
          year: "numeric",
        }),
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
            {month.entries.map((entry) =>
              entry.kind === "expense" ? (
                <ExpenseItem
                  key={`e-${entry.expense.id}`}
                  expense={entry.expense}
                  categories={categories}
                  groups={groups}
                  userId={userId}
                  showGroup={false}
                />
              ) : (
                <SettlementItem
                  key={`s-${entry.settlement.id}`}
                  settlement={entry.settlement}
                  userId={userId}
                  labels={labels}
                />
              ),
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}
