"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  DEFAULT_CURRENCY,
  formatMinorUnits,
  minorUnitsToInputValue,
  parseAmountToMinorUnits,
  splitEqually,
  toLocalDateString,
} from "@expense-tracker/shared";

import { createClient } from "@/lib/supabase/client";
import type { CategoryOption, ExpenseListItem, GroupOption } from "@/lib/types";

const inputClasses =
  "mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-600";

const labelClasses =
  "block text-sm font-medium text-zinc-700 dark:text-zinc-300";

/** Group picker sentinels: personal expense, or create a group inline. */
const PERSONAL = "";
const NEW_GROUP = "new";

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

/**
 * Add/edit form for an expense. Pass `expense` to edit it in place; omit it
 * to create a new one.
 *
 * An expense is personal or belongs to one group. For a group expense the
 * "Paid by" picker sets `user_id` (whose spend it is) to any member, while
 * `created_by` is always the signed-in user — RLS enforces both. "Split
 * between" picks the members who share the cost, equally; their shares are
 * `expense_splits` rows that must sum to the amount (a DB constraint), so
 * the save sequences delete → update → insert to keep that true at every
 * request boundary. Unticking everyone leaves the expense un-split.
 */
export function ExpenseForm({
  categories,
  groups,
  userId,
  defaultGroupId,
  expense,
  onDone,
}: {
  categories: CategoryOption[];
  groups: GroupOption[];
  userId: string;
  defaultGroupId?: string;
  expense?: ExpenseListItem;
  onDone: () => void;
}) {
  const router = useRouter();

  const initialGroup = expense?.group_id ?? defaultGroupId ?? PERSONAL;

  const [amount, setAmount] = useState(
    expense
      ? minorUnitsToInputValue(expense.amount_minor_units, expense.currency)
      : "",
  );
  const [categoryId, setCategoryId] = useState(expense?.category_id ?? "");
  const [date, setDate] = useState(expense?.expense_date ?? toLocalDateString(new Date()));
  const [description, setDescription] = useState(expense?.description ?? "");
  const [groupChoice, setGroupChoice] = useState(initialGroup);
  const [newGroupName, setNewGroupName] = useState("");
  const [paidBy, setPaidBy] = useState(expense?.user_id ?? userId);
  // Who shares the cost. New expenses default to everyone in the group.
  const [participants, setParticipants] = useState<string[]>(() =>
    expense
      ? expense.expense_splits.map((split) => split.user_id)
      : (groups.find((group) => group.id === initialGroup)?.members ?? []).map(
          (member) => member.user_id,
        ),
  );
  // Set once a new expense row is written, so a retry after a failed split
  // insert updates that row instead of creating a second expense.
  const [savedExpenseId, setSavedExpenseId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currency = expense?.currency ?? DEFAULT_CURRENCY;

  const selectedGroup = groups.find((group) => group.id === groupChoice) ?? null;
  const members = selectedGroup?.members ?? [];
  // The chosen payer may not be in this group (group switched, or they left):
  // fall back to the signed-in user, who is always a member.
  const effectivePaidBy = members.some((member) => member.user_id === paidBy)
    ? paidBy
    : userId;
  // Same for participants — and keep member order, so the split's remainder
  // lands on the first-listed members deterministically.
  const effectiveParticipants = members
    .filter((member) => participants.includes(member.user_id))
    .map((member) => member.user_id);

  // Live share preview while the amount is typed; null when it can't split.
  const previewAmount = parseAmountToMinorUnits(amount, currency);
  const previewShares =
    previewAmount !== null && previewAmount >= effectiveParticipants.length
      ? new Map(
          splitEqually(previewAmount, effectiveParticipants.length).map(
            (share, index) => [effectiveParticipants[index], share] as const,
          ),
        )
      : null;

  function changeGroup(value: string) {
    setGroupChoice(value);
    setPaidBy(userId);
    setParticipants(
      value === NEW_GROUP
        ? [userId]
        : (groups.find((group) => group.id === value)?.members ?? []).map(
            (member) => member.user_id,
          ),
    );
  }

  function toggleParticipant(memberId: string, checked: boolean) {
    setParticipants((current) =>
      checked
        ? [...current, memberId]
        : current.filter((id) => id !== memberId),
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const amountMinorUnits = parseAmountToMinorUnits(amount, currency);
    if (amountMinorUnits === null) {
      setError("Enter a valid amount greater than zero.");
      return;
    }

    const trimmedGroupName = newGroupName.trim();
    if (groupChoice === NEW_GROUP && !trimmedGroupName) {
      setError("Enter a name for the new group.");
      return;
    }

    // A brand-new group has exactly one member: the creator.
    const splitUserIds =
      groupChoice === NEW_GROUP
        ? [userId]
        : groupChoice === PERSONAL
          ? []
          : effectiveParticipants;

    if (splitUserIds.length > 0 && amountMinorUnits < splitUserIds.length) {
      setError(
        `The amount is too small to split ${splitUserIds.length} ways.`,
      );
      return;
    }

    setPending(true);
    const supabase = createClient();

    let groupId: string | null = groupChoice || null;

    if (groupChoice === NEW_GROUP) {
      // Id minted client-side: see GroupForm for why `.select()` can't be used.
      groupId = crypto.randomUUID();
      const { error: groupError } = await supabase
        .from("groups")
        .insert({ id: groupId, name: trimmedGroupName, created_by: userId });

      if (groupError) {
        setError(groupError.message);
        setPending(false);
        return;
      }
    }

    // Only a group expense can be attributed to someone else.
    const payer = groupId ? effectivePaidBy : userId;

    const fields = {
      user_id: payer,
      group_id: groupId,
      amount_minor_units: amountMinorUnits,
      category_id: categoryId || null,
      expense_date: date,
      description: description.trim() || null,
    };

    const existingId = expense?.id ?? savedExpenseId;
    // Splits must be rewritten when the amount or group changes (the DB
    // rejects an amount change while splits exist) or the people change.
    // A retried save (no `expense`, but `savedExpenseId`) always rewrites.
    const splitsChanged =
      !expense ||
      expense.amount_minor_units !== amountMinorUnits ||
      expense.group_id !== groupId ||
      !sameSet(
        expense.expense_splits.map((split) => split.user_id),
        splitUserIds,
      );

    let expenseId: string;

    if (existingId) {
      expenseId = existingId;

      if (splitsChanged) {
        const { error: clearError } = await supabase
          .from("expense_splits")
          .delete()
          .eq("expense_id", expenseId);

        if (clearError) {
          setError(clearError.message);
          setPending(false);
          return;
        }
      }

      const { error: updateError } = await supabase
        .from("expenses")
        .update(fields)
        .eq("id", expenseId);

      if (updateError) {
        setError(updateError.message);
        setPending(false);
        return;
      }
    } else {
      // Id minted client-side so the split rows can reference it without
      // `.select()` on the insert.
      expenseId = crypto.randomUUID();
      const { error: insertError } = await supabase
        .from("expenses")
        .insert({ ...fields, id: expenseId, created_by: userId, currency });

      if (insertError) {
        if (groupChoice === NEW_GROUP && groupId) {
          // The group exists now; point the form at it so a retry doesn't make
          // a second one, and refresh so it appears in the picker.
          setGroupChoice(groupId);
          setNewGroupName("");
          router.refresh();
          setError(
            `${insertError.message} (The group "${trimmedGroupName}" was created.)`,
          );
        } else {
          setError(insertError.message);
        }
        setPending(false);
        return;
      }

      setSavedExpenseId(expenseId);
    }

    if (splitsChanged && splitUserIds.length > 0) {
      const shares = splitEqually(amountMinorUnits, splitUserIds.length);
      const { error: splitError } = await supabase.from("expense_splits").insert(
        splitUserIds.map((memberId, index) => ({
          expense_id: expenseId,
          user_id: memberId,
          amount_minor_units: shares[index],
        })),
      );

      if (splitError) {
        // The expense itself is saved (un-split). Leave the form open so the
        // user can retry; the retry goes down the update path above.
        router.refresh();
        setError(
          `${splitError.message} (The expense was saved without a split — try again.)`,
        );
        setPending(false);
        return;
      }
    }

    // Re-run the server components so the list reflects the change.
    router.refresh();
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="amount" className={labelClasses}>
            Amount ({currency})
          </label>
          <input
            id="amount"
            type="text"
            inputMode="decimal"
            required
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            disabled={pending}
            placeholder="0.00"
            className={inputClasses}
          />
        </div>

        <div>
          <label htmlFor="expense-date" className={labelClasses}>
            Date
          </label>
          <input
            id="expense-date"
            type="date"
            required
            value={date}
            onChange={(event) => setDate(event.target.value)}
            disabled={pending}
            className={inputClasses}
          />
        </div>
      </div>

      <div>
        <label htmlFor="category" className={labelClasses}>
          Category
        </label>
        <select
          id="category"
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          disabled={pending}
          className={inputClasses}
        >
          <option value="">No category</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="expense-group" className={labelClasses}>
            Group
          </label>
          <select
            id="expense-group"
            value={groupChoice}
            onChange={(event) => changeGroup(event.target.value)}
            disabled={pending}
            className={inputClasses}
          >
            <option value={PERSONAL}>Personal</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
            <option value={NEW_GROUP}>+ New group…</option>
          </select>
        </div>

        {groupChoice === NEW_GROUP && (
          <div>
            <label htmlFor="new-group-name" className={labelClasses}>
              Group name
            </label>
            <input
              id="new-group-name"
              type="text"
              required
              maxLength={60}
              autoFocus
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
              disabled={pending}
              placeholder="Goa trip"
              className={inputClasses}
            />
          </div>
        )}

        {selectedGroup && (
          <div>
            <label htmlFor="paid-by" className={labelClasses}>
              Paid by
            </label>
            <select
              id="paid-by"
              value={effectivePaidBy}
              onChange={(event) => setPaidBy(event.target.value)}
              disabled={pending}
              className={inputClasses}
            >
              {members.map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {member.user_id === userId ? "You" : member.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {groupChoice === NEW_GROUP && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          You will be the only member to start with. Add people from the
          group&apos;s page afterwards.
        </p>
      )}

      {selectedGroup && members.length > 0 && (
        <fieldset disabled={pending}>
          <legend className={labelClasses}>Split between</legend>
          <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
            {members.map((member) => {
              const checked = effectiveParticipants.includes(member.user_id);
              const share = previewShares?.get(member.user_id);
              return (
                <label
                  key={member.user_id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:has-[:checked]:bg-emerald-950/40"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) =>
                      toggleParticipant(member.user_id, event.target.checked)
                    }
                    className="h-4 w-4 accent-emerald-600"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {member.user_id === userId ? "You" : member.label}
                  </span>
                  {checked && share !== undefined && (
                    <span className="shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                      {formatMinorUnits(share, currency)}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            {effectiveParticipants.length === 0
              ? "Not split — whoever paid bears the whole amount."
              : `Split equally ${effectiveParticipants.length} way${
                  effectiveParticipants.length === 1 ? "" : "s"
                }.`}
          </p>
        </fieldset>
      )}

      <div>
        <label htmlFor="description" className={labelClasses}>
          Description <span className="font-normal text-zinc-400">(optional)</span>
        </label>
        <input
          id="description"
          type="text"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={pending}
          placeholder="Groceries, cab fare…"
          className={inputClasses}
        />
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-zinc-950"
        >
          {pending
            ? "Saving…"
            : expense
              ? "Save changes"
              : "Add expense"}
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={pending}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
