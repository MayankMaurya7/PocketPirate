"use client";

import { useState } from "react";

import { ExpenseForm } from "@/components/expense-form";
import { ExpenseScreen } from "@/components/expense-screen";
import { PlusIcon } from "@/components/icons";
import type { CategoryOption, GroupOption } from "@/lib/types";

/**
 * Always-visible "Add expense" button pinned to the bottom-right corner
 * (clear of the iPhone home indicator), opening the expense screen. Adding
 * is the app's primary action and must not depend on where the user has
 * scrolled to.
 */
export function AddExpenseFab({
  categories,
  groups,
  userId,
  defaultGroupId,
}: {
  categories: CategoryOption[];
  groups: GroupOption[];
  userId: string;
  defaultGroupId?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] right-6 z-10 inline-flex items-center gap-2 rounded-full bg-emerald-600 py-3 pl-4 pr-5 text-sm font-semibold text-white shadow-lg shadow-emerald-600/30 transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-950"
      >
        <PlusIcon />
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
