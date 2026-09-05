"use client";

import { useState } from "react";

import { formatMinorUnits } from "@expense-tracker/shared";

import { SettleUpForm } from "@/components/settle-up-form";
import type { Debt } from "@/lib/balances";
import type { MemberLabels } from "@/lib/types";

const FORMER_MEMBER = "a former member";

/**
 * One "X owes Y" row. When the viewer is one of the two, a button opens the
 * record-payment form inline; other people's debts are shown read-only.
 */
export function DebtItem({
  groupId,
  userId,
  debt,
  labels,
}: {
  groupId: string;
  userId: string;
  debt: Debt;
  labels: MemberLabels;
}) {
  const [settling, setSettling] = useState(false);

  const iOwe = debt.from === userId;
  const owedToMe = debt.to === userId;
  const involved = iOwe || owedToMe;
  // A party who has left the group is not in `labels`; they can't settle
  // either (RLS needs both parties to be members), so no button.
  const canSettle = involved && debt.from in labels && debt.to in labels;

  const nameOf = (id: string) =>
    id === userId ? "You" : (labels[id] ?? FORMER_MEMBER);
  const fromLabel = nameOf(debt.from);
  const toLabel = nameOf(debt.to);

  if (settling) {
    return (
      <li className="p-5">
        <SettleUpForm
          groupId={groupId}
          userId={userId}
          debt={debt}
          fromLabel={fromLabel}
          toLabel={owedToMe ? "you" : toLabel}
          onDone={() => setSettling(false)}
        />
      </li>
    );
  }

  const amount = formatMinorUnits(debt.minorUnits, debt.currency);

  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:gap-4 sm:px-5 sm:py-4">
      <span
        aria-hidden="true"
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
          iOwe
            ? "bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400"
            : owedToMe
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
              : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
        }`}
      >
        {(iOwe ? toLabel : fromLabel).charAt(0).toUpperCase()}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-zinc-900 dark:text-zinc-100">
          <span className="font-medium">{fromLabel}</span>
          {iOwe ? " owe " : " owes "}
          <span className="font-medium">
            {owedToMe ? "you" : toLabel}
          </span>
        </p>
        {!involved && (
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Between other members
          </p>
        )}
      </div>

      {/*
        On phones the button sits under the amount so the name keeps its
        width; from `sm` up they share the row, with a fixed-width slot so
        amounts line up on rows without a button.
      */}
      <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-4">
        <span
          className={`text-sm font-semibold tabular-nums ${
            iOwe
              ? "text-red-600 dark:text-red-400"
              : owedToMe
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-zinc-700 dark:text-zinc-200"
          }`}
        >
          {amount}
        </span>
        <div className="flex justify-end sm:w-32">
          {canSettle && (
            <button
              type="button"
              onClick={() => setSettling(true)}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {iOwe ? "Settle up" : "Record payment"}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
