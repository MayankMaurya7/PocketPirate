"use client";

import { useState } from "react";

import { ExpenseForm } from "@/components/expense-form";
import { ExpenseScreen } from "@/components/expense-screen";
import type { CategoryOption, GroupOption } from "@/lib/types";

/** "Add expense" button that opens the expense screen. */
export function AddExpense({
  categories,
  groups,
  userId,
  defaultGroupId,
}: {
  categories: CategoryOption[];
  groups: GroupOption[];
  userId: string;
  /** Pre-select a group (used when the list is filtered to one). */
  defaultGroupId?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-950"
      >
        Add expense
      </button>

      <ExpenseScreen open={open} onClose={() => setOpen(false)} title="New expense">
        <ExpenseForm
          categories={categories}
          groups={groups}
          userId={userId}
          defaultGroupId={defaultGroupId}
          onDone={() => setOpen(false)}
        />
      </ExpenseScreen>
    </>
  );
}
