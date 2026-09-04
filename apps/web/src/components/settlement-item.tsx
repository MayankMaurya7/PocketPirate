"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { formatMinorUnits } from "@expense-tracker/shared";

import { createClient } from "@/lib/supabase/client";
import { AddedAt } from "@/components/added-at";
import { BanknoteIcon, TrashIcon } from "@/components/icons";
import type { MemberLabels, Settlement } from "@/lib/types";

/**
 * One recorded payment: who paid whom, amount, date, who recorded it.
 * Either party can delete it (RLS enforces this; the button is only
 * offered to them).
 */
export function SettlementItem({
  settlement,
  userId,
  labels,
}: {
  settlement: Settlement;
  userId: string;
  labels: MemberLabels;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameOf = (id: string) =>
    id === userId ? "you" : (labels[id] ?? "a former member");
  const paidBy = settlement.from_user_id === userId ? "You" : nameOf(settlement.from_user_id);
  const paidTo = nameOf(settlement.to_user_id);
  const isParty =
    settlement.from_user_id === userId || settlement.to_user_id === userId;

  const meta: string[] = [
    new Date(`${settlement.settled_on}T00:00:00`).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
    `Recorded by ${settlement.created_by === userId ? "you" : nameOf(settlement.created_by)}`,
  ];
  if (settlement.note) {
    meta.push(settlement.note);
  }

  async function handleDelete() {
    if (!window.confirm("Delete this payment? The balance will go back to what it was.")) {
      return;
    }

    setPending(true);
    setError(null);

    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("settlements")
      .delete()
      .eq("id", settlement.id);

    if (deleteError) {
      setError(deleteError.message);
      setPending(false);
      return;
    }

    router.refresh();
  }

  return (
    <li className="flex items-center gap-4 px-5 py-4">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
      >
        <BanknoteIcon />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-zinc-900 dark:text-zinc-100">
          <span className="font-medium">{paidBy}</span> paid{" "}
          <span className="font-medium">{paidTo}</span>
        </p>
        <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
          {meta.join(" · ")}
          <AddedAt iso={settlement.created_at} date={settlement.settled_on} />
        </p>
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>

      <span className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
        {formatMinorUnits(settlement.amount_minor_units, settlement.currency)}
      </span>

      {/* Same slot width as expense rows so the timeline's amounts align. */}
      <div className="flex w-15 shrink-0 justify-end">
        {isParty && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            aria-label="Delete payment"
            className="rounded-md p-1.5 text-zinc-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-60 dark:hover:bg-red-950/50 dark:hover:text-red-400"
          >
            <TrashIcon />
          </button>
        )}
      </div>
    </li>
  );
}
