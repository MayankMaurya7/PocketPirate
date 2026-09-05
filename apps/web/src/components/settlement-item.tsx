"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { formatMinorUnits } from "@expense-tracker/shared";

import { createClient } from "@/lib/supabase/client";
import { AddedAt } from "@/components/added-at";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { BanknoteIcon, PencilIcon, TrashIcon } from "@/components/icons";
import { SettleUpForm } from "@/components/settle-up-form";
import type { MemberLabels, Settlement } from "@/lib/types";

/**
 * One recorded payment: who paid whom, amount, date, who recorded it.
 * Either party can edit (amount, date, note) or delete it — RLS enforces
 * this; the buttons are only offered to them. Editing also needs the other
 * party to still be a member, so the pencil is hidden once they have left.
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
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameOf = (id: string) =>
    id === userId ? "you" : (labels[id] ?? "a former member");
  const paidBy = settlement.from_user_id === userId ? "You" : nameOf(settlement.from_user_id);
  const paidTo = nameOf(settlement.to_user_id);
  const isParty =
    settlement.from_user_id === userId || settlement.to_user_id === userId;
  const canEdit =
    isParty &&
    settlement.from_user_id in labels &&
    settlement.to_user_id in labels;

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

    setConfirmingDelete(false);
    router.refresh();
  }

  if (editing) {
    return (
      <li className="p-5">
        <SettleUpForm
          groupId={settlement.group_id}
          userId={userId}
          settlement={settlement}
          fromLabel={paidBy}
          toLabel={paidTo}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:flex-nowrap sm:gap-4 sm:px-5 sm:py-4">
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

      <span className="shrink-0 text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
        {formatMinorUnits(settlement.amount_minor_units, settlement.currency)}
      </span>

      {/*
        Same behaviour and slot width as expense rows so the timeline's
        amounts align: actions wrap under the amount on phones and take a
        fixed-width slot in the row from `sm` up.
      */}
      {isParty ? (
        <div className="flex w-full justify-end gap-1 sm:w-15 sm:shrink-0">
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={pending}
              aria-label="Edit payment"
              className="rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-60 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <PencilIcon />
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            disabled={pending}
            aria-label="Delete payment"
            className="rounded-md p-1.5 text-zinc-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-60 dark:hover:bg-red-950/50 dark:hover:text-red-400"
          >
            <TrashIcon />
          </button>
        </div>
      ) : (
        <div aria-hidden="true" className="hidden sm:block sm:w-15 sm:shrink-0" />
      )}

      {isParty && (
        <ConfirmDialog
          open={confirmingDelete}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={handleDelete}
          pending={pending}
          error={error}
          title="Delete this payment?"
          description={
            <>
              The record that{" "}
              <span className="font-medium text-zinc-800 dark:text-zinc-200">
                {paidBy} paid {paidTo}{" "}
                {formatMinorUnits(settlement.amount_minor_units, settlement.currency)}
              </span>{" "}
              will be removed and the balance goes back to what it was before.
            </>
          }
          confirmLabel="Delete payment"
          pendingLabel="Deleting…"
        />
      )}
    </li>
  );
}
