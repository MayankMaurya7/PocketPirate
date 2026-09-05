"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { formatMinorUnits } from "@expense-tracker/shared";

import { createClient } from "@/lib/supabase/client";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { UserMinusIcon } from "@/components/icons";
import type { BalanceEntry } from "@/lib/balances";
import { memberLabel, type GroupMember } from "@/lib/types";

/**
 * One member row: avatar/initial, name or email, role, net balance (when
 * the group has split expenses or payments), optional remove.
 */
export function MemberItem({
  groupId,
  member,
  isSelf,
  canRemove,
  balance,
}: {
  groupId: string;
  member: GroupMember;
  isSelf: boolean;
  /** Owner viewing someone else's row. */
  canRemove: boolean;
  /**
   * Non-zero net positions per currency; empty = settled up. Omit to hide
   * the column (nothing split or paid in the group yet).
   */
  balance?: BalanceEntry[];
}) {
  const router = useRouter();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = memberLabel(member.profiles);
  const secondary =
    member.profiles?.display_name && member.profiles.email
      ? member.profiles.email
      : null;

  async function handleRemove() {
    setPending(true);
    setError(null);

    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("user_id", member.user_id);

    if (deleteError) {
      setError(deleteError.message);
      setPending(false);
      return;
    }

    setConfirmingRemove(false);
    router.refresh();
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:gap-4 sm:px-5 sm:py-4">
      {member.profiles?.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote OAuth avatars, arbitrary hosts
        <img
          src={member.profiles.avatar_url}
          alt=""
          className="h-9 w-9 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
        >
          {label.charAt(0).toUpperCase()}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {label}
          {isSelf && (
            <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">
              You
            </span>
          )}
        </p>
        <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
          {member.role === "owner" ? "Owner" : "Member"}
          {secondary && ` · ${secondary}`}
        </p>
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>

      {balance && (
        <div className="shrink-0 text-right text-sm font-semibold tabular-nums">
          {balance.length === 0 ? (
            <span className="text-xs font-normal text-zinc-400 dark:text-zinc-500">
              Settled up
            </span>
          ) : (
            balance.map((entry) => (
              <p
                key={entry.currency}
                className={
                  entry.minorUnits > 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                }
              >
                {entry.minorUnits > 0 ? "+" : ""}
                {formatMinorUnits(entry.minorUnits, entry.currency)}
              </p>
            ))
          )}
        </div>
      )}

      {/* Fixed-width slot so balances line up whether or not a row can be removed. */}
      <div className="flex w-7 shrink-0 justify-end">
        {canRemove && (
          <button
            type="button"
            onClick={() => setConfirmingRemove(true)}
            disabled={pending}
            aria-label={`Remove ${label}`}
            className="rounded-md p-1.5 text-zinc-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-60 dark:hover:bg-red-950/50 dark:hover:text-red-400"
          >
            <UserMinusIcon />
          </button>
        )}
      </div>

      {canRemove && (
        <ConfirmDialog
          open={confirmingRemove}
          onCancel={() => setConfirmingRemove(false)}
          onConfirm={handleRemove}
          pending={pending}
          error={error}
          title={`Remove ${label}?`}
          description="They will lose access to this group and its expenses. Anything they paid or owe stays on record, and an owner can invite them back later."
          confirmLabel="Remove member"
          pendingLabel="Removing…"
        />
      )}
    </li>
  );
}
