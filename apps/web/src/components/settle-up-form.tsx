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
import type { Settlement } from "@/lib/types";

const inputClasses =
  "mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-600";

const labelClasses =
  "block text-sm font-medium text-zinc-700 dark:text-zinc-300";

/**
 * Record a payment that settles (part of) one debt, or edit one already
 * recorded. Recording: the direction is fixed by the debt — the debtor
 * paid the creditor — and the amount is prefilled with what is owed but
 * can be changed for a partial or rounded payment. Editing: only the
 * amount, date and note can change (the DB grants UPDATE on just those
 * columns); who paid whom is fixed — delete and re-record to turn a
 * payment around. Who may do either follows the group's edit policy
 * (migration 012): any member, or only the two parties; never once a
 * party has left. RLS checks it; `SettlementItem` only offers it then.
 */
export function SettleUpForm(
  props: {
    groupId: string;
    userId: string;
    /** Display names for the debtor and creditor ("You" for the viewer). */
    fromLabel: string;
    toLabel: string;
    onDone: () => void;
  } & (
    | { debt: Debt; settlement?: undefined }
    | { settlement: Settlement; debt?: undefined }
  ),
) {
  const { groupId, userId, fromLabel, toLabel, onDone } = props;
  const settlement = props.settlement;
  const debt = props.settlement ? null : props.debt;
  const initial = props.settlement
    ? {
        currency: props.settlement.currency,
        minorUnits: props.settlement.amount_minor_units,
        date: props.settlement.settled_on,
        note: props.settlement.note ?? "",
      }
    : {
        currency: props.debt.currency,
        minorUnits: props.debt.minorUnits,
        date: toLocalDateString(new Date()),
        note: "",
      };
  const currency = initial.currency;

  const router = useRouter();
  const [amount, setAmount] = useState(
    minorUnitsToInputValue(initial.minorUnits, currency),
  );
  const [date, setDate] = useState(initial.date);
  const [note, setNote] = useState(initial.note);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountMinorUnits = parseAmountToMinorUnits(amount, currency);
  // What is left of the debt after this payment — only meaningful while
  // recording against a known debt.
  const remaining =
    amountMinorUnits === null || !debt ? null : debt.minorUnits - amountMinorUnits;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (amountMinorUnits === null) {
      setError("Enter a valid amount greater than zero.");
      return;
    }

    setPending(true);

    const supabase = createClient();
    if (props.settlement) {
      // RLS filters rather than errors when the row may not be edited, so
      // ask for the row back to tell "saved" from "silently skipped".
      const { data, error: updateError } = await supabase
        .from("settlements")
        .update({
          amount_minor_units: amountMinorUnits,
          settled_on: date,
          note: note.trim() || null,
        })
        .eq("id", props.settlement.id)
        .select("id")
        .maybeSingle();

      if (updateError || !data) {
        setError(
          updateError?.message ??
            "This payment can't be changed: only the two people involved can edit it, and both must still be in the group.",
        );
        setPending(false);
        return;
      }
    } else {
      const { error: insertError } = await supabase.from("settlements").insert({
        group_id: groupId,
        from_user_id: props.debt.from,
        to_user_id: props.debt.to,
        created_by: userId,
        amount_minor_units: amountMinorUnits,
        currency,
        settled_on: date,
        note: note.trim() || null,
      });

      if (insertError) {
        setError(insertError.message);
        setPending(false);
        return;
      }
    }

    router.refresh();
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {settlement ? "Edit payment" : "Record a payment"}
        </h3>
        <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300">
          {fromLabel} paid {toLabel}
          {debt && (
            <span className="text-zinc-400 dark:text-zinc-500">
              {" "}
              · owed {formatMinorUnits(debt.minorUnits, currency)}
            </span>
          )}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="settle-amount" className={labelClasses}>
            Amount ({currency})
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
            ? `${fromLabel} will still owe ${formatMinorUnits(remaining, currency)} after this.`
            : `${formatMinorUnits(-remaining, currency)} more than owed — ${toLabel} will owe ${fromLabel} the difference.`}
        </p>
      )}

      {settlement && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Who paid whom can&apos;t be changed. Delete this payment and record
          it again if it went the other way.
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
          {settlement
            ? pending
              ? "Saving…"
              : "Save changes"
            : pending
              ? "Recording…"
              : "Record payment"}
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
