"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { formatMinorUnits, type SpendingEntry } from "@expense-tracker/shared";

import { createClient } from "@/lib/supabase/client";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { UserMinusIcon } from "@/components/icons";
import type { BalanceEntry } from "@/lib/balances";
import { memberLabel, type GroupMember } from "@/lib/types";

/**
 * One member row: avatar/initial, name or email, role, optional remove, and
 * a labelled strip of figures on its own line — what they paid, their share
 * of the group's expenses and (when the group has split expenses or
 * payments) their net balance. The strip is a full-width line rather than a
 * right-hand column so that at phone width neither the name nor the figures
 * get truncated.
 */

type Strip = {
  currency: string;
  paid: number;
  share: number;
  /** Net balance; undefined while the balance column is hidden. */
  net: number | undefined;
};

/** One strip per currency across both lists (spending first, then balances). */
function stripsFor(spending: SpendingEntry[], balance: BalanceEntry[] | undefined): Strip[] {
  const byCurrency = new Map<string, Strip>();
  for (const entry of spending) {
    byCurrency.set(entry.currency, {
      currency: entry.currency,
      paid: entry.paid,
      share: entry.share,
      net: balance ? 0 : undefined,
    });
  }
  for (const entry of balance ?? []) {
    const strip = byCurrency.get(entry.currency) ?? {
      currency: entry.currency,
      paid: 0,
      share: 0,
      net: 0,
    };
    strip.net = entry.minorUnits;
    byCurrency.set(entry.currency, strip);
  }
  return [...byCurrency.values()];
}
export function MemberItem({
  groupId,
  member,
  isSelf,
  canRemove,
  balance,
  spending,
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
  /** Paid / share per currency across the group's expenses; empty = on none. */
  spending?: SpendingEntry[];
}) {
  const router = useRouter();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = memberLabel(member.profiles);
  const strips = stripsFor(spending ?? [], balance);
  const labelSuffix = (currency: string) =>
    strips.length > 1 ? ` · ${currency}` : "";
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
    <li className="flex flex-wrap items-center gap-3 px-4 py-3 sm:gap-4 sm:px-5 sm:py-4">
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

      {/* Fixed-width slot so name lines end at the same place whether or not a row can be removed. */}
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

      {/*
        Figures on their own full-width line (the `li` wraps). From `sm` the
        strip is indented past the avatar so it lines up under the name.
      */}
      {strips.map((strip) => (
        <dl
          key={strip.currency}
          className={`grid basis-full gap-3 sm:pl-13 ${
            strip.net === undefined ? "grid-cols-2" : "grid-cols-3"
          }`}
        >
          <div className="min-w-0">
            <dt className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Paid{labelSuffix(strip.currency)}
            </dt>
            <dd className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
              {formatMinorUnits(strip.paid, strip.currency)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Share{labelSuffix(strip.currency)}
            </dt>
            <dd className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
              {formatMinorUnits(strip.share, strip.currency)}
            </dd>
          </div>
          {strip.net !== undefined && (
            <div className="min-w-0">
              <dt className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Balance{labelSuffix(strip.currency)}
              </dt>
              <dd
                className={`text-sm font-semibold tabular-nums ${
                  strip.net > 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : strip.net < 0
                      ? "text-red-600 dark:text-red-400"
                      : "font-normal text-zinc-400 dark:text-zinc-500"
                }`}
              >
                {strip.net === 0
                  ? "Settled up"
                  : `${strip.net > 0 ? "+" : ""}${formatMinorUnits(strip.net, strip.currency)}`}
              </dd>
            </div>
          )}
        </dl>
      ))}

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
