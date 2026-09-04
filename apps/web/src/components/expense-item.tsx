"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { formatMinorUnits } from "@expense-tracker/shared";

import { createClient } from "@/lib/supabase/client";
import { ExpenseForm } from "@/components/expense-form";
import { PencilIcon, TrashIcon } from "@/components/icons";
import {
  type CategoryOption,
  type ExpenseListItem,
  type GroupOption,
  memberLabel,
} from "@/lib/types";

/**
 * One expense row: category dot, description, meta line, amount, and — only
 * for expenses this user entered — edit/delete. RLS already limits writes to
 * `created_by`; hiding the buttons just avoids offering an action that would
 * fail.
 */
export function ExpenseItem({
  expense,
  categories,
  groups,
  userId,
  showGroup,
}: {
  expense: ExpenseListItem;
  categories: CategoryOption[];
  groups: GroupOption[];
  userId: string;
  showGroup: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!window.confirm("Delete this expense?")) {
      return;
    }

    setPending(true);
    setError(null);

    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("expenses")
      .delete()
      .eq("id", expense.id);

    if (deleteError) {
      setError(deleteError.message);
      setPending(false);
      return;
    }

    router.refresh();
  }

  if (editing) {
    return (
      <li className="p-5">
        <ExpenseForm
          categories={categories}
          groups={groups}
          userId={userId}
          expense={expense}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  const category = expense.categories;
  const enteredByMe = expense.created_by === userId;

  const meta: string[] = [];
  // Categories are private per user, so another member's category is not
  // visible to us — say nothing rather than a misleading "Uncategorised".
  if (category) {
    meta.push(category.name);
  } else if (enteredByMe) {
    meta.push("Uncategorised");
  }
  meta.push(
    new Date(`${expense.expense_date}T00:00:00`).toLocaleDateString(
      undefined,
      { day: "numeric", month: "short", year: "numeric" },
    ),
  );
  if (expense.group_id) {
    if (showGroup && expense.groups) {
      meta.push(expense.groups.name);
    }
    meta.push(
      expense.user_id === userId
        ? "Paid by you"
        : `Paid by ${memberLabel(expense.payer)}`,
    );

    const splits = expense.expense_splits;
    if (splits.length === 0) {
      meta.push("Not split");
    } else {
      const myShare = splits.find((split) => split.user_id === userId);
      meta.push(
        `Split ${splits.length} way${splits.length === 1 ? "" : "s"}` +
          (myShare
            ? ` · your share ${formatMinorUnits(myShare.amount_minor_units, expense.currency)}`
            : ""),
      );
    }
  }

  return (
    <li className="flex items-center gap-4 px-5 py-4">
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: category?.color ?? "#a1a1aa" }}
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {expense.description || category?.name || "Expense"}
        </p>
        <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
          {meta.join(" · ")}
        </p>
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>

      <span className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
        {formatMinorUnits(expense.amount_minor_units, expense.currency)}
      </span>

      {enteredByMe && (
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={pending}
            aria-label="Edit expense"
            className="rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-60 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <PencilIcon />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            aria-label="Delete expense"
            className="rounded-md p-1.5 text-zinc-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-60 dark:hover:bg-red-950/50 dark:hover:text-red-400"
          >
            <TrashIcon />
          </button>
        </div>
      )}
    </li>
  );
}
