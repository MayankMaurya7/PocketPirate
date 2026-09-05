"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  DEFAULT_CURRENCY,
  PERCENT_BASIS,
  basisPointsToInputValue,
  formatMinorUnits,
  minorUnitsToInputValue,
  parseAmountToMinorUnits,
  parsePercentToBasisPoints,
  splitByWeights,
  splitEqually,
  toLocalDateString,
} from "@expense-tracker/shared";

import { createClient } from "@/lib/supabase/client";
import type {
  CategoryOption,
  ExpenseListItem,
  ExpenseSplit,
  GroupOption,
} from "@/lib/types";

const inputClasses =
  "mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-600";

const labelClasses =
  "block text-sm font-medium text-zinc-700 dark:text-zinc-300";

/** Group picker sentinels: personal expense, or create a group inline. */
const PERSONAL = "";
const NEW_GROUP = "new";

/** How the participants' shares are worked out. */
type SplitMode = "equal" | "exact" | "shares" | "percent";

const SPLIT_MODES: { value: SplitMode; label: string }[] = [
  { value: "equal", label: "Equally" },
  { value: "exact", label: "Amounts" },
  { value: "shares", label: "Shares" },
  { value: "percent", label: "Percent" },
];

/** Per-member typed values for each of the non-equal modes. */
type SplitInputs = Record<Exclude<SplitMode, "equal">, Record<string, string>>;

/**
 * The shares a mode + inputs produce for the current amount. `shares` is
 * null while the split is incomplete or invalid; `error` says why (and is
 * what blocks the save), `footer` is the live status line under the list.
 */
type SplitPlan = {
  shares: Map<string, number> | null;
  footer: string;
  error: string | null;
};

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Do the saved split rows carry exactly these shares (same people, same amounts)? */
function sameShares(existing: ExpenseSplit[], shares: Map<string, number>): boolean {
  return (
    existing.length === shares.size &&
    existing.every((split) => shares.get(split.user_id) === split.amount_minor_units)
  );
}

/** True when the saved rows are what an equal split of the amount gives. */
function isEqualSplit(expense: ExpenseListItem): boolean {
  const saved = expense.expense_splits
    .map((split) => split.amount_minor_units)
    .sort((a, b) => a - b);
  const equal = splitEqually(expense.amount_minor_units, saved.length).sort(
    (a, b) => a - b,
  );
  return saved.every((value, index) => value === equal[index]);
}

function planSplit(
  mode: SplitMode,
  amount: number | null,
  participants: string[],
  inputs: SplitInputs,
  currency: string,
): SplitPlan {
  const count = participants.length;
  if (count === 0) {
    return {
      shares: new Map(),
      footer: "Not split — whoever paid bears the whole amount.",
      error: null,
    };
  }
  const fmt = (minorUnits: number) => formatMinorUnits(minorUnits, currency);
  const tooSmall = (parts: number[]): SplitPlan | null =>
    parts.some((part) => part <= 0)
      ? {
          shares: null,
          footer: `The amount is too small to split ${count} ways like this.`,
          error: `The amount is too small to split ${count} ways like this.`,
        }
      : null;
  const toMap = (parts: number[]) =>
    new Map(parts.map((part, index) => [participants[index], part] as const));

  switch (mode) {
    case "equal": {
      const footer = `Split equally ${count} way${count === 1 ? "" : "s"}.`;
      if (amount === null) {
        return { shares: null, footer, error: null };
      }
      const parts = splitEqually(amount, count);
      return tooSmall(parts) ?? { shares: toMap(parts), footer, error: null };
    }

    case "exact": {
      const parsed = participants.map((id) =>
        parseAmountToMinorUnits(inputs.exact[id] ?? "", currency),
      );
      if (parsed.some((value) => value === null)) {
        const error = "Enter an amount for everyone in the split.";
        return { shares: null, footer: error, error };
      }
      const parts = parsed as number[];
      const assigned = parts.reduce((sum, part) => sum + part, 0);
      if (amount === null) {
        return { shares: null, footer: `${fmt(assigned)} assigned.`, error: null };
      }
      const diff = amount - assigned;
      if (diff !== 0) {
        const error = `${fmt(assigned)} of ${fmt(amount)} assigned · ${fmt(Math.abs(diff))} ${diff > 0 ? "left" : "over"}.`;
        return { shares: null, footer: error, error };
      }
      return {
        shares: toMap(parts),
        footer: `Split by exact amounts, ${count} way${count === 1 ? "" : "s"}.`,
        error: null,
      };
    }

    case "shares": {
      const weights = participants.map((id) => {
        const raw = (inputs.shares[id] ?? "").trim();
        return /^\d{1,4}$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
      });
      if (weights.some((value) => value === null)) {
        const error = "Enter a share count (1 or more) for everyone in the split.";
        return { shares: null, footer: error, error };
      }
      const total = (weights as number[]).reduce((sum, weight) => sum + weight, 0);
      const footer = `Split by shares · ${plural(total, "share")} in total.`;
      if (amount === null) {
        return { shares: null, footer, error: null };
      }
      const parts = splitByWeights(amount, weights as number[]);
      return tooSmall(parts) ?? { shares: toMap(parts), footer, error: null };
    }

    case "percent": {
      const basisPoints = participants.map((id) =>
        parsePercentToBasisPoints(inputs.percent[id] ?? ""),
      );
      if (basisPoints.some((value) => value === null)) {
        const error = "Enter a percentage for everyone in the split.";
        return { shares: null, footer: error, error };
      }
      const total = (basisPoints as number[]).reduce((sum, bp) => sum + bp, 0);
      if (total !== PERCENT_BASIS) {
        const diff = PERCENT_BASIS - total;
        const error = `${basisPointsToInputValue(total)}% of 100% assigned · ${basisPointsToInputValue(Math.abs(diff))}% ${diff > 0 ? "left" : "over"}.`;
        return { shares: null, footer: error, error };
      }
      const footer = "Split by percentage.";
      if (amount === null) {
        return { shares: null, footer, error: null };
      }
      const parts = splitByWeights(amount, basisPoints as number[]);
      return tooSmall(parts) ?? { shares: toMap(parts), footer, error: null };
    }
  }
}

/**
 * Add/edit form for an expense. Pass `expense` to edit it in place; omit it
 * to create a new one.
 *
 * An expense is personal or belongs to one group. For a group expense the
 * "Paid by" picker sets `user_id` (whose spend it is) to any member, while
 * `created_by` is always the signed-in user — RLS enforces both. "Split
 * between" picks the members who share the cost and how — equally, by exact
 * amounts, by shares or by percentages; their shares are `expense_splits`
 * rows that must sum to the amount (a DB constraint), so the save sequences
 * delete → update → insert to keep that true at every request boundary.
 * Unticking everyone leaves the expense un-split.
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
  const currency = expense?.currency ?? DEFAULT_CURRENCY;

  const [amount, setAmount] = useState(
    expense ? minorUnitsToInputValue(expense.amount_minor_units, currency) : "",
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
  // An existing unequal split is edited as exact amounts, whatever method
  // produced it — the rows only record the outcome.
  const [splitMode, setSplitMode] = useState<SplitMode>(() =>
    expense && expense.expense_splits.length > 0 && !isEqualSplit(expense)
      ? "exact"
      : "equal",
  );
  const [splitInputs, setSplitInputs] = useState<SplitInputs>(() => ({
    exact: Object.fromEntries(
      (expense?.expense_splits ?? []).map((split) => [
        split.user_id,
        minorUnitsToInputValue(split.amount_minor_units, currency),
      ]),
    ),
    shares: {},
    percent: {},
  }));
  // Set once a new expense row is written, so a retry after a failed split
  // insert updates that row instead of creating a second expense.
  const [savedExpenseId, setSavedExpenseId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // Live shares while the form is typed into; also what the save writes.
  const amountMinorUnits = parseAmountToMinorUnits(amount, currency);
  const plan = planSplit(
    splitMode,
    amountMinorUnits,
    effectiveParticipants,
    splitInputs,
    currency,
  );

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

  /** Sensible starting values for a mode: the equal split, 1 share, or 100 ÷ n. */
  function defaultsFor(
    mode: Exclude<SplitMode, "equal">,
    ids: string[],
  ): Record<string, string> {
    if (mode === "shares") {
      return Object.fromEntries(ids.map((id) => [id, "1"]));
    }
    if (mode === "percent") {
      const parts = splitEqually(PERCENT_BASIS, ids.length);
      return Object.fromEntries(
        ids.map((id, index) => [id, basisPointsToInputValue(parts[index])]),
      );
    }
    if (amountMinorUnits === null || amountMinorUnits < ids.length) {
      return {};
    }
    const parts = splitEqually(amountMinorUnits, ids.length);
    return Object.fromEntries(
      ids.map((id, index) => [id, minorUnitsToInputValue(parts[index], currency)]),
    );
  }

  function changeSplitMode(mode: SplitMode) {
    setSplitMode(mode);
    if (mode === "equal") {
      return;
    }
    // Prefill only what the user hasn't typed yet, so switching back and
    // forth between methods never discards their numbers.
    setSplitInputs((current) => {
      const missing = effectiveParticipants.filter((id) => !current[mode][id]);
      if (missing.length === 0) {
        return current;
      }
      const defaults = defaultsFor(mode, effectiveParticipants);
      const filled = { ...current[mode] };
      for (const id of missing) {
        if (defaults[id] !== undefined) {
          filled[id] = defaults[id];
        }
      }
      return { ...current, [mode]: filled };
    });
  }

  function toggleParticipant(memberId: string, checked: boolean) {
    setParticipants((current) =>
      checked
        ? [...current, memberId]
        : current.filter((id) => id !== memberId),
    );
    // A newcomer to a shares split gets one share; in the other modes the
    // user has to say what they owe.
    if (checked && splitMode === "shares") {
      setSplitInputs((current) => ({
        ...current,
        shares: { ...current.shares, [memberId]: current.shares[memberId] || "1" },
      }));
    }
  }

  function setSplitInput(
    mode: Exclude<SplitMode, "equal">,
    memberId: string,
    value: string,
  ) {
    setSplitInputs((current) => ({
      ...current,
      [mode]: { ...current[mode], [memberId]: value },
    }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (amountMinorUnits === null) {
      setError("Enter a valid amount greater than zero.");
      return;
    }

    const trimmedGroupName = newGroupName.trim();
    if (groupChoice === NEW_GROUP && !trimmedGroupName) {
      setError("Enter a name for the new group.");
      return;
    }

    // A brand-new group has exactly one member: the creator, who bears it all.
    let shares: Map<string, number>;
    if (groupChoice === NEW_GROUP) {
      shares = new Map([[userId, amountMinorUnits]]);
    } else if (groupChoice === PERSONAL) {
      shares = new Map();
    } else if (plan.shares === null) {
      setError(plan.error ?? "Complete the split before saving.");
      return;
    } else {
      shares = plan.shares;
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
    // rejects an amount change while splits exist) or the shares change.
    // A retried save (no `expense`, but `savedExpenseId`) always rewrites.
    const splitsChanged =
      !expense ||
      expense.amount_minor_units !== amountMinorUnits ||
      expense.group_id !== groupId ||
      !sameShares(expense.expense_splits, shares);

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

    if (splitsChanged && shares.size > 0) {
      const { error: splitError } = await supabase.from("expense_splits").insert(
        Array.from(shares, ([memberId, share]) => ({
          expense_id: expenseId,
          user_id: memberId,
          amount_minor_units: share,
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
          <legend className="sr-only">Split between</legend>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={labelClasses}>Split between</span>
            <div
              role="radiogroup"
              aria-label="Split method"
              className="inline-flex rounded-lg border border-zinc-300 bg-zinc-100 p-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-800"
            >
              {SPLIT_MODES.map((mode) => {
                const active = mode.value === splitMode;
                return (
                  <button
                    key={mode.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => changeSplitMode(mode.value)}
                    className={`rounded-md px-2.5 py-1 font-medium transition ${
                      active
                        ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-50"
                        : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                    }`}
                  >
                    {mode.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div
            className={`mt-1.5 grid gap-2 ${splitMode === "equal" ? "sm:grid-cols-2" : ""}`}
          >
            {members.map((member) => {
              const checked = effectiveParticipants.includes(member.user_id);
              const share = plan.shares?.get(member.user_id);
              const name = member.user_id === userId ? "You" : member.label;
              return (
                <div
                  key={member.user_id}
                  className="flex items-center gap-2.5 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:has-[:checked]:bg-emerald-950/40"
                >
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) =>
                        toggleParticipant(member.user_id, event.target.checked)
                      }
                      className="h-4 w-4 accent-emerald-600"
                    />
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                  </label>

                  {checked && splitMode !== "equal" && (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                      <input
                        type="text"
                        inputMode={splitMode === "shares" ? "numeric" : "decimal"}
                        aria-label={`${name} — ${
                          splitMode === "exact"
                            ? "amount"
                            : splitMode === "shares"
                              ? "shares"
                              : "percent"
                        }`}
                        value={splitInputs[splitMode][member.user_id] ?? ""}
                        onChange={(event) =>
                          setSplitInput(splitMode, member.user_id, event.target.value)
                        }
                        placeholder={splitMode === "shares" ? "1" : "0"}
                        className="w-20 rounded-md border border-zinc-300 bg-white px-2 py-1 text-right text-sm tabular-nums text-zinc-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                      />
                      <span className="w-4">
                        {splitMode === "exact"
                          ? ""
                          : splitMode === "shares"
                            ? "sh"
                            : "%"}
                      </span>
                    </span>
                  )}

                  {checked && splitMode !== "exact" && (
                    <span className="w-20 shrink-0 text-right text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                      {share !== undefined ? formatMinorUnits(share, currency) : ""}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <p
            className={`mt-1.5 text-xs ${
              plan.error && amountMinorUnits !== null
                ? "text-amber-700 dark:text-amber-400"
                : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            {plan.footer}
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
