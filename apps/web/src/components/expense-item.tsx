"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  expenseNetFor,
  expensePayers,
  formatDate,
  formatMinorUnits,
} from "@expense-tracker/shared";

import { createClient } from "@/lib/supabase/client";
import { AddedAt } from "@/components/added-at";
import { ExpenseForm } from "@/components/expense-form";
import { ExpenseScreen } from "@/components/expense-screen";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PencilIcon, TrashIcon } from "@/components/icons";
import { expenseMemberNamer } from "@/lib/members";
import { expenseEditPermission } from "@/lib/permissions";
import type {
  ActivityEntry,
  CategoryOption,
  ExpenseListItem,
  GroupOption,
} from "@/lib/types";

/** "A and B" / "A, B and C" — the group's own list style, "you" last. */
function joinNames(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * One expense row: category dot, description, meta line, amount. Tapping
 * the row, its title or the pencil opens the expense screen — editable
 * when RLS would let this member save (`expenseEditPermission` mirrors the
 * policy), otherwise read-only with the reason. Delete is offered on the
 * same terms. `activity` is the expense's own trail for the screen's
 * History section.
 */
export function ExpenseItem({
  expense,
  categories,
  groups,
  userId,
  showGroup,
  activity = [],
}: {
  expense: ExpenseListItem;
  categories: CategoryOption[];
  groups: GroupOption[];
  userId: string;
  showGroup: boolean;
  activity?: ActivityEntry[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped — inside the same transition as the refresh — when the form asks
  // for the latest version after an edit conflict, so the form remounts
  // from the refreshed `expense` prop in one commit. Not keyed on
  // `expense.updated_at`: a background refresh (tab resume, navigation)
  // landing another member's edit would otherwise remount a form someone
  // is typing in and lose their input.
  const [formVersion, setFormVersion] = useState(0);
  const [reloading, startReload] = useTransition();

  function reloadForm() {
    startReload(() => {
      router.refresh();
      setFormVersion((version) => version + 1);
    });
  }

  const permission = expenseEditPermission(expense, groups, userId);
  const canEdit = permission.ok;

  async function handleDelete() {
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

    setConfirmingDelete(false);
    router.refresh();
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
  meta.push(formatDate(expense.expense_date));
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

  const iconButtonClasses =
    "rounded-md p-1.5 text-zinc-400 transition disabled:opacity-60";

  return (
    <li
      onClick={() => setOpen(true)}
      className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 transition hover:bg-zinc-50 sm:flex-nowrap sm:gap-4 sm:px-5 sm:py-4 dark:hover:bg-zinc-800/60"
    >
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: category?.color ?? "#a1a1aa" }}
      />

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setOpen(true);
          }}
          className="block max-w-full truncate text-left text-sm font-medium text-zinc-900 dark:text-zinc-100"
        >
          {title}
        </button>
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
      {canEdit ? (
        <div className="flex w-full justify-end gap-1 sm:w-15 sm:shrink-0">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setOpen(true);
            }}
            disabled={pending}
            aria-label="Edit expense"
            className={`${iconButtonClasses} hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200`}
          >
            <PencilIcon />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setConfirmingDelete(true);
            }}
            disabled={pending}
            aria-label="Delete expense"
            className={`${iconButtonClasses} hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50 dark:hover:text-red-400`}
          >
            <TrashIcon />
          </button>
        </div>
      ) : (
        <div aria-hidden="true" className="hidden sm:block sm:w-15 sm:shrink-0" />
      )}

      {/* Dialogs live outside the row's click target. */}
      <div onClick={(event) => event.stopPropagation()} className="contents">
        <ExpenseScreen
          open={open}
          onClose={() => setOpen(false)}
          title={canEdit ? "Edit expense" : "Expense"}
        >
          <ExpenseForm
            key={formVersion}
            categories={categories}
            groups={groups}
            userId={userId}
            expense={expense}
            readOnly={permission.ok ? null : permission.reason}
            activity={activity}
            onDone={() => setOpen(false)}
            onReload={reloadForm}
            reloading={reloading}
          />
        </ExpenseScreen>

        {canEdit && (
          <ConfirmDialog
            open={confirmingDelete}
            onCancel={() => setConfirmingDelete(false)}
            onConfirm={handleDelete}
            pending={pending}
            error={error}
            title="Delete this expense?"
            description={
              <>
                <span className="font-medium text-zinc-800 dark:text-zinc-200">
                  {title}
                </span>{" "}
                ({formatMinorUnits(expense.amount_minor_units, expense.currency)})
                {expense.group_id && expense.expense_splits.length > 0
                  ? ` will be removed and everyone's balances in ${
                      expense.groups?.name ?? "the group"
                    } adjusted.`
                  : " will be removed."}{" "}
                {expense.group_id
                  ? "The group's activity will record who deleted it."
                  : "This can’t be undone."}
              </>
            }
            confirmLabel="Delete expense"
            pendingLabel="Deleting…"
          />
        )}
      </div>
    </li>
  );
}
