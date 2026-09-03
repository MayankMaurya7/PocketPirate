import { ExpenseItem } from "@/components/expense-item";
import type { CategoryOption, ExpenseListItem, GroupOption } from "@/lib/types";

/** The expense list card, or an empty state when there is nothing to show. */
export function ExpenseList({
  expenses,
  categories,
  groups,
  userId,
  showGroup = true,
  emptyTitle,
  emptyHint,
}: {
  expenses: ExpenseListItem[];
  categories: CategoryOption[];
  groups: GroupOption[];
  userId: string;
  /** Hide the group name on rows when the whole list is one group. */
  showGroup?: boolean;
  emptyTitle: string;
  emptyHint: string;
}) {
  if (expenses.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {emptyTitle}
        </p>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {emptyHint}
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 bg-white shadow-sm dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
      {expenses.map((expense) => (
        <ExpenseItem
          key={expense.id}
          expense={expense}
          categories={categories}
          groups={groups}
          userId={userId}
          showGroup={showGroup}
        />
      ))}
    </ul>
  );
}
