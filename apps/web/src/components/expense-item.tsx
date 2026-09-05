"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  expenseNetFor,
  expensePayers,
  formatMinorUnits,
} from "@expense-tracker/shared";

import { createClient } from "@/lib/supabase/client";
import { AddedAt } from "@/components/added-at";
import { ExpenseDetails, expenseMemberNamer } from "@/components/expense-details";
import { ExpenseForm } from "@/components/expense-form";
import { PencilIcon, TrashIcon } from "@/components/icons";
import { Modal } from "@/components/modal";
import type { CategoryOption, ExpenseListItem, GroupOption } from "@/lib/types";

/** "A and B" / "A, B and C" — the group's own list style, "you" last. */
function joinNames(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * One expense row: category dot, description, meta line, amount, and — only
 * for expenses this user entered — edit/delete. RLS already limits writes to
 * `created_by`; hiding the buttons just avoids offering an action that would
 * fail. For a group expense the title opens a details dialog with every
 * payer's and participant's amount (personal expenses have nothing beyond
 * the row to show).
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
  const [detailsOpen, setDetailsOpen] = useState(false);
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
  const title = expense.description || category?.name || "Expense";
  const nameOf = expenseMemberNamer(expense, groups, userId);

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
    const payers = expensePayers(expense);
    if (payers.length === 1) {
      meta.push(`Paid by ${nameOf(expense.user_id)}`);
    } else {
      // Several payers: name them largest share first, the viewer last as
      // "you".
      const others = payers
        .filter((payer) => payer.user_id !== userId)
        .sort(
          (a, b) =>
            b.amount_minor_units - a.amount_minor_units ||
            (a.user_id < b.user_id ? -1 : 1),
        )
        .map((payer) => nameOf(payer.user_id));
      const includesMe = payers.some((payer) => payer.user_id === userId);
      meta.push(`Paid by ${joinNames(includesMe ? [...others, "you"] : others)}`);
    }

    const splits = expense.expense_splits;
    if (splits.length === 0) {
      meta.push("Not split");
    } else {
      meta.push(`Split ${splits.length} way${splits.length === 1 ? "" : "s"}`);
    }
  }

  // What this expense did to the viewer's balance: what you paid minus your
  // share — lent when positive, borrowed when negative. This is exactly the
  // total the pairwise ledger on the group page assigns you for it, whoever
  // the other payers and participants are.
  let position: { label: "you lent" | "you borrowed" | "even" | "not involved" } & {
    minorUnits: number;
  } = { label: "not involved", minorUnits: 0 };
  if (expense.group_id && expense.expense_splits.length > 0) {
    const { paid, share, net } = expenseNetFor(
      userId,
      expensePayers(expense),
      expense.expense_splits,
    );
    if (net > 0) {
      position = { label: "you lent", minorUnits: net };
    } else if (net < 0) {
      position = { label: "you borrowed", minorUnits: -net };
    } else if (paid > 0 || share > 0) {
      position = { label: "even", minorUnits: 0 };
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:flex-nowrap sm:gap-4 sm:px-5 sm:py-4">
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: category?.color ?? "#a1a1aa" }}
      />

      <div className="min-w-0 flex-1">
        {expense.group_id ? (
          <button
            type="button"
            onClick={() => setDetailsOpen(true)}
            title="Show details"
            className="block max-w-full truncate text-left text-sm font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-100"
          >
            {title}
          </button>
        ) : (
          <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {title}
          </p>
        )}
        <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
          {meta.join(" · ")}
          <AddedAt iso={expense.created_at} date={expense.expense_date} />
        </p>
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>

      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
          {formatMinorUnits(expense.amount_minor_units, expense.currency)}
        </p>
        {expense.group_id && expense.expense_splits.length > 0 && (
          <p
            className={`mt-0.5 text-xs tabular-nums ${
              position.label === "you lent"
                ? "text-emerald-600 dark:text-emerald-400"
                : position.label === "you borrowed"
                  ? "text-red-600 dark:text-red-400"
                  : "text-zinc-400 dark:text-zinc-500"
            }`}
          >
            {position.minorUnits === 0
              ? position.label
              : `${position.label} ${formatMinorUnits(position.minorUnits, expense.currency)}`}
          </p>
        )}
      </div>

      {/*
        Actions: on phones they wrap onto their own line under the amount so
        the title keeps its width; from `sm` up they take a fixed-width slot
        in the row so amounts line up across rows with and without actions.
      */}
      {enteredByMe ? (
        <div className="flex w-full justify-end gap-1 sm:w-15 sm:shrink-0">
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
      ) : (
        <div aria-hidden="true" className="hidden sm:block sm:w-15 sm:shrink-0" />
      )}

      {expense.group_id && (
        <Modal
          open={detailsOpen}
          onClose={() => setDetailsOpen(false)}
          title="Expense details"
        >
          <ExpenseDetails
            expense={expense}
            groups={groups}
            userId={userId}
            onEdit={
              enteredByMe
                ? () => {
                    setDetailsOpen(false);
                    setEditing(true);
                  }
                : undefined
            }
          />
        </Modal>
      )}
    </li>
  );
}
