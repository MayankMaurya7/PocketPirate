"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  formatMinorUnits,
  minorUnitsToInputValue,
  parseAmountToMinorUnits,
  toLocalDateString,
} from "@expense-tracker/shared";

import { createClient } from "@/lib/supabase/client";
import { InfoIcon } from "@/components/icons";
import type { Debt } from "@/lib/balances";

const inputClasses =
  "mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-600";

const labelClasses =
  "block text-sm font-medium text-zinc-700 dark:text-zinc-300";

/**
 * Record a payment that settles (part of) one debt. The direction is fixed
 * by the debt — the debtor paid the creditor — and the amount is prefilled
 * with what is owed but can be changed for a partial or rounded payment.
 * Either party may record it; RLS checks that the signed-in user is one of
 * the two and that both are still members.
 */
export function SettleUpForm({
  groupId,
  userId,
  debt,
  fromLabel,
  toLabel,
  onDone,
}: {
  groupId: string;
  userId: string;
  debt: Debt;
  /** Display names for the debtor and creditor ("You" for the viewer). */
  fromLabel: string;
  toLabel: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(
    minorUnitsToInputValue(debt.minorUnits, debt.currency),
  );
  const [date, setDate] = useState(toLocalDateString(new Date()));
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountMinorUnits = parseAmountToMinorUnits(amount, debt.currency);
  const remaining =
    amountMinorUnits === null ? null : debt.minorUnits - amountMinorUnits;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (amountMinorUnits === null) {
      setError("Enter a valid amount greater than zero.");
      return;
    }

    setPending(true);

    const supabase = createClient();
    const { error: insertError } = await supabase.from("settlements").insert({
      group_id: groupId,
      from_user_id: debt.from,
      to_user_id: debt.to,
      created_by: userId,
      amount_minor_units: amountMinorUnits,
      currency: debt.currency,
      settled_on: date,
      note: note.trim() || null,
    });

    if (insertError) {
      setError(insertError.message);
      setPending(false);
      return;
    }

    router.refresh();
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Record a payment
        </h3>
        <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300">
          {fromLabel} paid {toLabel}
          <span className="text-zinc-400 dark:text-zinc-500">
            {" "}
            · owed {formatMinorUnits(debt.minorUnits, debt.currency)}
          </span>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="settle-amount" className={labelClasses}>
            Amount ({debt.currency})
          </label>
          <input
            id="settle-amount"
            type="text"
            inputMode="decimal"
            required
            autoFocus
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            disabled={pending}
            className={inputClasses}
          />
        </div>

        <div>
          <label htmlFor="settle-date" className={labelClasses}>
            Date
          </label>
          <input
            id="settle-date"
            type="date"
            required
            value={date}
            onChange={(event) => setDate(event.target.value)}
            disabled={pending}
            className={inputClasses}
          />
        </div>
      </div>

      {remaining !== null && remaining !== 0 && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {remaining > 0
            ? `${fromLabel} will still owe ${formatMinorUnits(remaining, debt.currency)} after this.`
            : `${formatMinorUnits(-remaining, debt.currency)} more than owed — ${toLabel} will owe ${fromLabel} the difference.`}
        </p>
      )}

      <div>
        <label htmlFor="settle-note" className={labelClasses}>
          Note <span className="font-normal text-zinc-400">(optional)</span>
        </label>
        <input
          id="settle-note"
          type="text"
          maxLength={200}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          disabled={pending}
          placeholder="UPI, cash…"
          className={inputClasses}
        />
      </div>

      <p className="flex items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300">
        <span className="mt-px shrink-0 text-emerald-600 dark:text-emerald-400">
          <InfoIcon />
        </span>
        This records a payment made outside Spendwise. No money is moved.
      </p>

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
          {pending ? "Recording…" : "Record payment"}
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
