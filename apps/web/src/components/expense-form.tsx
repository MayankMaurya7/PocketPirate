"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  DEFAULT_CURRENCY,
  minorUnitsToInputValue,
  parseAmountToMinorUnits,
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

/**
 * Add/edit form for an expense. Pass `expense` to edit it in place; omit it
 * to create a new one.
 *
 * An expense is personal or belongs to one group. For a group expense the
 * "Paid by" picker sets `user_id` (whose spend it is) to any member, while
 * `created_by` is always the signed-in user — RLS enforces both.
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

  const [amount, setAmount] = useState(
    expense
      ? minorUnitsToInputValue(expense.amount_minor_units, expense.currency)
      : "",
  );
  const [categoryId, setCategoryId] = useState(expense?.category_id ?? "");
  const [date, setDate] = useState(expense?.expense_date ?? toLocalDateString(new Date()));
  const [description, setDescription] = useState(expense?.description ?? "");
  const [groupChoice, setGroupChoice] = useState(
    expense?.group_id ?? defaultGroupId ?? PERSONAL,
  );
  const [newGroupName, setNewGroupName] = useState("");
  const [paidBy, setPaidBy] = useState(expense?.user_id ?? userId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedGroup = groups.find((group) => group.id === groupChoice) ?? null;
  const members = selectedGroup?.members ?? [];
  // The chosen payer may not be in this group (group switched, or they left):
  // fall back to the signed-in user, who is always a member.
  const effectivePaidBy = members.some((member) => member.user_id === paidBy)
    ? paidBy
    : userId;

  function changeGroup(value: string) {
    setGroupChoice(value);
    setPaidBy(userId);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const currency = expense?.currency ?? DEFAULT_CURRENCY;
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

    const { error: writeError } = expense
      ? await supabase.from("expenses").update(fields).eq("id", expense.id)
      : await supabase
          .from("expenses")
          .insert({ ...fields, created_by: userId, currency });

    if (writeError) {
      if (groupChoice === NEW_GROUP && groupId) {
        // The group exists now; point the form at it so a retry doesn't make
        // a second one, and refresh so it appears in the picker.
        setGroupChoice(groupId);
        setNewGroupName("");
        router.refresh();
        setError(
          `${writeError.message} (The group "${trimmedGroupName}" was created.)`,
        );
      } else {
        setError(writeError.message);
      }
      setPending(false);
      return;
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
            Amount ({expense?.currency ?? DEFAULT_CURRENCY})
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
