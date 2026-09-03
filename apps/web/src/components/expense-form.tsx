"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  DEFAULT_CURRENCY,
  minorUnitsToInputValue,
  parseAmountToMinorUnits,
} from "@expense-tracker/shared";

import { createClient } from "@/lib/supabase/client";
import type { CategoryOption, ExpenseWithCategory } from "@/lib/types";

/** Today as a YYYY-MM-DD string in the user's local timezone. */
function localToday() {
  return new Date().toLocaleDateString("en-CA");
}

const inputClasses =
  "mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-600";

const labelClasses =
  "block text-sm font-medium text-zinc-700 dark:text-zinc-300";

/**
 * Add/edit form for a personal expense. Pass `expense` to edit it in place;
 * omit it to create a new one.
 */
export function ExpenseForm({
  categories,
  expense,
  onDone,
}: {
  categories: CategoryOption[];
  expense?: ExpenseWithCategory;
  onDone: () => void;
}) {
  const router = useRouter();

  const [amount, setAmount] = useState(
    expense
      ? minorUnitsToInputValue(expense.amount_minor_units, expense.currency)
      : "",
  );
  const [categoryId, setCategoryId] = useState(expense?.category_id ?? "");
  const [date, setDate] = useState(expense?.expense_date ?? localToday());
  const [description, setDescription] = useState(expense?.description ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const currency = expense?.currency ?? DEFAULT_CURRENCY;
    const amountMinorUnits = parseAmountToMinorUnits(amount, currency);
    if (amountMinorUnits === null) {
      setError("Enter a valid amount greater than zero.");
      return;
    }

    setPending(true);
    const supabase = createClient();

    if (expense) {
      const { error: updateError } = await supabase
        .from("expenses")
        .update({
          amount_minor_units: amountMinorUnits,
          category_id: categoryId || null,
          expense_date: date,
          description: description.trim() || null,
        })
        .eq("id", expense.id);

      if (updateError) {
        setError(updateError.message);
        setPending(false);
        return;
      }
    } else {
      const { data: claimsData, error: claimsError } =
        await supabase.auth.getClaims();
      const userId = claimsData?.claims.sub;
      if (claimsError || !userId) {
        setError("Your session has expired. Refresh and sign in again.");
        setPending(false);
        return;
      }

      const { error: insertError } = await supabase.from("expenses").insert({
        user_id: userId,
        created_by: userId,
        amount_minor_units: amountMinorUnits,
        currency,
        category_id: categoryId || null,
        expense_date: date,
        description: description.trim() || null,
      });

      if (insertError) {
        setError(insertError.message);
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
