"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { formatMinorUnits } from "@expense-tracker/shared";

import { createClient } from "@/lib/supabase/client";
import { ExpenseForm } from "@/components/expense-form";
import type { CategoryOption, ExpenseWithCategory } from "@/lib/types";

/** One expense row: category badge, description, date, amount, edit/delete. */
export function ExpenseItem({
  expense,
  categories,
}: {
  expense: ExpenseWithCategory;
  categories: CategoryOption[];
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
          expense={expense}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  const category = expense.categories;

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
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {category?.name ?? "Uncategorised"} ·{" "}
          {new Date(`${expense.expense_date}T00:00:00`).toLocaleDateString(
            undefined,
            { day: "numeric", month: "short", year: "numeric" },
          )}
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
    </li>
  );
}

function PencilIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}
