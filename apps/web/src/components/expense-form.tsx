"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  DEFAULT_CURRENCY,
  PERCENT_BASIS,
  attributeExpenseDebts,
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
import { ActivityItem } from "@/components/activity-item";
import { LocalTime } from "@/components/added-at";
import { InfoIcon } from "@/components/icons";
import { expenseMemberNamer, groupMemberNamer } from "@/lib/members";
import type {
  ActivityEntry,
  CategoryOption,
  ExpenseListItem,
  GroupOption,
} from "@/lib/types";

const inputClasses =
  "mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-600";

const labelClasses =
  "block text-sm font-medium text-zinc-700 dark:text-zinc-300";

/** A member row (checkbox + name + inputs) in the payer and split lists. */
const memberRowClasses =
  "flex items-center gap-2.5 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:has-[:checked]:bg-emerald-950/40";

const amountInputClasses =
  "w-20 rounded-md border border-zinc-300 bg-white px-2 py-1 text-right text-sm tabular-nums text-zinc-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50";

/** Group picker sentinels: personal expense, or create a group inline. */
const PERSONAL = "";
const NEW_GROUP = "new";

/** "Paid by" picker sentinel: several members paid, amounts entered below. */
const SEVERAL = "several";

type PayerMode = "one" | "several";

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

/** A row of either `expense_splits` or `expense_payers`. */
type AmountRow = { user_id: string; amount_minor_units: number };

/**
 * What a set of inputs produces for the current amount. `amounts` is null
 * while the entry is incomplete or invalid; `error` says why (and is what
 * blocks the save), `footer` is the live status line under the list.
 */
type AmountPlan = {
  amounts: Map<string, number> | null;
  footer: string;
  error: string | null;
};

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Do the saved rows carry exactly these amounts (same people, same numbers)? */
function sameAmounts(existing: AmountRow[], amounts: Map<string, number>): boolean {
  return (
    existing.length === amounts.size &&
    existing.every((row) => amounts.get(row.user_id) === row.amount_minor_units)
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

/**
 * Parse one typed amount per id and check that they add up to `total`.
 * Shared by the exact-amount split and the several-payers list; `wording`
 * fits the status line to each ("assigned" vs "paid").
 */
function planExactAmounts(
  total: number | null,
  ids: string[],
  inputs: Record<string, string>,
  currency: string,
  wording: { missing: string; verb: string; done: string },
): AmountPlan {
  const fmt = (minorUnits: number) => formatMinorUnits(minorUnits, currency);
  const parsed = ids.map((id) => parseAmountToMinorUnits(inputs[id] ?? "", currency));
  if (parsed.some((value) => value === null)) {
    return { amounts: null, footer: wording.missing, error: wording.missing };
  }
  const parts = parsed as number[];
  const sum = parts.reduce((acc, part) => acc + part, 0);
  if (total === null) {
    return { amounts: null, footer: `${fmt(sum)} ${wording.verb}.`, error: null };
  }
  const diff = total - sum;
  if (diff !== 0) {
    const error = `${fmt(sum)} of ${fmt(total)} ${wording.verb} · ${fmt(Math.abs(diff))} ${diff > 0 ? "left" : "over"}.`;
    return { amounts: null, footer: error, error };
  }
  return {
    amounts: new Map(parts.map((part, index) => [ids[index], part] as const)),
    footer: wording.done,
    error: null,
  };
}

function planSplit(
  mode: SplitMode,
  amount: number | null,
  participants: string[],
  inputs: SplitInputs,
  currency: string,
): AmountPlan {
  const count = participants.length;
  if (count === 0) {
    return {
      amounts: new Map(),
      footer: "Not split — whoever paid bears the whole amount.",
      error: null,
    };
  }
  const tooSmall = (parts: number[]): AmountPlan | null =>
    parts.some((part) => part <= 0)
      ? {
          amounts: null,
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
        return { amounts: null, footer, error: null };
      }
      const parts = splitEqually(amount, count);
      return tooSmall(parts) ?? { amounts: toMap(parts), footer, error: null };
    }

    case "exact":
      return planExactAmounts(amount, participants, inputs.exact, currency, {
        missing: "Enter an amount for everyone in the split.",
        verb: "assigned",
        done: `Split by exact amounts, ${count} way${count === 1 ? "" : "s"}.`,
      });

    case "shares": {
      const weights = participants.map((id) => {
        const raw = (inputs.shares[id] ?? "").trim();
        return /^\d{1,4}$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
      });
      if (weights.some((value) => value === null)) {
        const error = "Enter a share count (1 or more) for everyone in the split.";
        return { amounts: null, footer: error, error };
      }
      const total = (weights as number[]).reduce((sum, weight) => sum + weight, 0);
      const footer = `Split by shares · ${plural(total, "share")} in total.`;
      if (amount === null) {
        return { amounts: null, footer, error: null };
      }
      const parts = splitByWeights(amount, weights as number[]);
      return tooSmall(parts) ?? { amounts: toMap(parts), footer, error: null };
    }

    case "percent": {
      const basisPoints = participants.map((id) =>
        parsePercentToBasisPoints(inputs.percent[id] ?? ""),
      );
      if (basisPoints.some((value) => value === null)) {
        const error = "Enter a percentage for everyone in the split.";
        return { amounts: null, footer: error, error };
      }
      const total = (basisPoints as number[]).reduce((sum, bp) => sum + bp, 0);
      if (total !== PERCENT_BASIS) {
        const diff = PERCENT_BASIS - total;
        const error = `${basisPointsToInputValue(total)}% of 100% assigned · ${basisPointsToInputValue(Math.abs(diff))}% ${diff > 0 ? "left" : "over"}.`;
        return { amounts: null, footer: error, error };
      }
      const footer = "Split by percentage.";
      if (amount === null) {
        return { amounts: null, footer, error: null };
      }
      const parts = splitByWeights(amount, basisPoints as number[]);
      return tooSmall(parts) ?? { amounts: toMap(parts), footer, error: null };
    }
  }
}

/** Who paid how much, when several members did. Must add up to the amount. */
function planPayers(
  amount: number | null,
  payers: string[],
  inputs: Record<string, string>,
  currency: string,
): AmountPlan {
  if (payers.length === 0) {
    const error = "Tick everyone who paid.";
    return { amounts: null, footer: error, error };
  }
  return planExactAmounts(amount, payers, inputs, currency, {
    missing: "Enter how much each person paid.",
    verb: "paid",
    done:
      payers.length === 1
        ? "Paid by one person."
        : `Paid by ${payers.length} people.`,
  });
}

/**
 * Which payer `expenses.user_id` names when several paid: the one picked
 * before (so an edit keeps it), else whoever paid most, ties by id — the
 * order the lists name payers in. The database only requires that it is one
 * of them; balances come from the rows, not from this choice.
 */
function primaryPayer(payers: Map<string, number>, preferred: string): string {
  if (payers.has(preferred)) {
    return preferred;
  }
  return [...payers].sort(
    ([idA, amountA], [idB, amountB]) => amountB - amountA || (idA < idB ? -1 : 1),
  )[0][0];
}

/**
 * Add/edit form for an expense, laid out for `ExpenseScreen`: the fields
 * scroll between the screen's header and a pinned footer with Save and
 * Cancel. Pass `expense` to edit it; omit it to create a new one. Pass
 * `readOnly` (a reason) to show an expense the viewer may not change —
 * every field disabled, the footer just closes. `activity` is the
 * expense's own trail (edits and deletions by anyone), shown at the end.
 *
 * An expense is personal or belongs to one group. For a group expense the
 * "Paid by" picker sets `user_id` (whose spend it is) to any member, or to
 * "Several people", which lists the members with an amount each; those are
 * `expense_payers` rows that must sum to the amount and include `user_id`
 * (the primary payer — see `primaryPayer`). `created_by` is always the
 * signed-in user — RLS enforces all of it. "Split between" picks the
 * members who share the cost and how — equally, by exact amounts, by shares
 * or by percentages; their shares are `expense_splits` rows that must sum
 * to the amount. Both sums are DB constraints, and the DB also refuses an
 * amount, group or primary-payer change while rows exist, so the save
 * sequences delete splits → delete payers → update → insert payers →
 * insert splits to keep every request boundary valid. Unticking everyone
 * leaves the expense un-split.
 */
export function ExpenseForm({
  categories,
  groups,
  userId,
  defaultGroupId,
  expense,
  readOnly = null,
  activity = [],
  onDone,
}: {
  categories: CategoryOption[];
  groups: GroupOption[];
  userId: string;
  defaultGroupId?: string;
  expense?: ExpenseListItem;
  readOnly?: string | null;
  activity?: ActivityEntry[];
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
  // The single payer — and, with several, the preferred primary one.
  const [paidBy, setPaidBy] = useState(expense?.user_id ?? userId);
  // Several payers: who, and how much each put in. An expense with payer
  // rows opens in that mode with its rows.
  const [payerMode, setPayerMode] = useState<PayerMode>(
    expense && expense.expense_payers.length > 0 ? "several" : "one",
  );
  const [payerIds, setPayerIds] = useState<string[]>(() =>
    (expense?.expense_payers ?? []).map((payer) => payer.user_id),
  );
  const [payerInputs, setPayerInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (expense?.expense_payers ?? []).map((payer) => [
        payer.user_id,
        minorUnitsToInputValue(payer.amount_minor_units, currency),
      ]),
    ),
  );
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
  // Set once a save has deleted payer or split rows, so that if it then
  // fails, the retry rewrites both sets whatever the (now stale) `expense`
  // prop says they were.
  const [rowsDirty, setRowsDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedGroup = groups.find((group) => group.id === groupChoice) ?? null;
  const members = selectedGroup?.members ?? [];
  // The chosen payer may not be in this group (group switched, or they left):
  // fall back to the signed-in user, who is always a member.
  const effectivePaidBy = members.some((member) => member.user_id === paidBy)
    ? paidBy
    : userId;
  // Same for payers and participants — and keep member order, so the
  // split's remainder lands on the first-listed members deterministically.
  const effectivePayerIds = members
    .filter((member) => payerIds.includes(member.user_id))
    .map((member) => member.user_id);
  const effectiveParticipants = members
    .filter((member) => participants.includes(member.user_id))
    .map((member) => member.user_id);

  // Live figures while the form is typed into; also what the save writes.
  const amountMinorUnits = parseAmountToMinorUnits(amount, currency);
  const payerPlan =
    payerMode === "several"
      ? planPayers(amountMinorUnits, effectivePayerIds, payerInputs, currency)
      : null;
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
    setPayerMode("one");
    setPayerIds([]);
    setParticipants(
      value === NEW_GROUP
        ? [userId]
        : (groups.find((group) => group.id === value)?.members ?? []).map(
            (member) => member.user_id,
          ),
    );
  }

  function changePaidBy(value: string) {
    if (value === SEVERAL) {
      setPayerMode("several");
      // Start from whoever was picked, so the common case is ticking one
      // more person and typing two amounts.
      setPayerIds((current) => (current.length > 0 ? current : [effectivePaidBy]));
    } else {
      setPayerMode("one");
      setPaidBy(value);
    }
  }

  function togglePayer(memberId: string, checked: boolean) {
    setPayerIds((current) =>
      checked ? [...current, memberId] : current.filter((id) => id !== memberId),
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

    // Who paid. Payer rows are only written for several people; one payer
    // is just `user_id`, as before. Only a group expense can be attributed
    // to someone else, and a brand-new group has exactly one member.
    let payer: string;
    let payerRows: Map<string, number>;
    if (groupChoice === NEW_GROUP || groupChoice === PERSONAL) {
      payer = userId;
      payerRows = new Map();
    } else if (payerPlan === null) {
      payer = effectivePaidBy;
      payerRows = new Map();
    } else if (payerPlan.amounts === null) {
      setError(payerPlan.error ?? "Complete who paid before saving.");
      return;
    } else if (payerPlan.amounts.size === 1) {
      payer = [...payerPlan.amounts.keys()][0];
      payerRows = new Map();
    } else {
      payerRows = payerPlan.amounts;
      payer = primaryPayer(payerRows, paidBy);
    }

    // A brand-new group has exactly one member: the creator, who bears it all.
    let shares: Map<string, number>;
    if (groupChoice === NEW_GROUP) {
      shares = new Map([[userId, amountMinorUnits]]);
    } else if (groupChoice === PERSONAL) {
      shares = new Map();
    } else if (plan.amounts === null) {
      setError(plan.error ?? "Complete the split before saving.");
      return;
    } else {
      shares = plan.amounts;
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

    const fields = {
      user_id: payer,
      group_id: groupId,
      amount_minor_units: amountMinorUnits,
      category_id: categoryId || null,
      expense_date: date,
      description: description.trim() || null,
    };

    const existingId = expense?.id ?? savedExpenseId;
    // Both row sets must be rewritten when the amount or group changes (the
    // DB rejects either while rows exist), payers also when the primary
    // payer changes, and each when its own rows differ. A retried save (no
    // `expense`, but `savedExpenseId`) or one after a half-done write
    // (`rowsDirty`) always rewrites both.
    const rewriteAll =
      !expense ||
      rowsDirty ||
      expense.amount_minor_units !== amountMinorUnits ||
      expense.group_id !== groupId;
    const payersChanged =
      rewriteAll ||
      expense.user_id !== payer ||
      !sameAmounts(expense.expense_payers, payerRows);
    const splitsChanged = rewriteAll || !sameAmounts(expense.expense_splits, shares);
    // Nothing to clear when the row is known to have none. (Another member
    // may have edited since this page loaded; a retry after the resulting
    // error goes through `rowsDirty` and rewrites both sets.)
    const clearPayers =
      payersChanged && (!expense || rowsDirty || expense.expense_payers.length > 0);
    const clearSplits =
      splitsChanged && (!expense || rowsDirty || expense.expense_splits.length > 0);

    let expenseId: string;

    if (existingId) {
      expenseId = existingId;

      if (clearSplits) {
        const { error: clearError } = await supabase
          .from("expense_splits")
          .delete()
          .eq("expense_id", expenseId);

        if (clearError) {
          setError(clearError.message);
          setPending(false);
          return;
        }
        setRowsDirty(true);
      }

      if (clearPayers) {
        const { error: clearError } = await supabase
          .from("expense_payers")
          .delete()
          .eq("expense_id", expenseId);

        if (clearError) {
          setError(clearError.message);
          setPending(false);
          return;
        }
        setRowsDirty(true);
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
      // Id minted client-side so the payer and split rows can reference it
      // without `.select()` on the insert.
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

    if (payersChanged && payerRows.size > 0) {
      const { error: payerError } = await supabase.from("expense_payers").insert(
        Array.from(payerRows, ([memberId, paid]) => ({
          expense_id: expenseId,
          user_id: memberId,
          amount_minor_units: paid,
        })),
      );

      if (payerError) {
        // The expense itself is saved, paid by the primary payer alone and
        // not split. Leave the form open so the user can retry; the retry
        // goes down the update path above and rewrites both row sets.
        setRowsDirty(true);
        router.refresh();
        setError(
          `${payerError.message} (The expense was saved as paid by one person and without a split — try again.)`,
        );
        setPending(false);
        return;
      }
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
        // The expense (and its payers) are saved, un-split. Same retry path.
        setRowsDirty(true);
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

  const nameOf = (memberId: string, label: string) =>
    memberId === userId ? "You" : label;
  const locked = pending || readOnly !== null;

  // Categories are private per user: an expense someone else filed under
  // one of theirs shows that category as "kept", and stays under it unless
  // the editor picks one of their own (the database refuses anything else).
  const foreignCategoryId =
    expense?.category_id && !categories.some((c) => c.id === expense.category_id)
      ? expense.category_id
      : null;
  const expenseNamer = expense ? expenseMemberNamer(expense, groups, userId) : null;

  // What this expense will do to balances, from the form as it stands —
  // the same attribution the group's balances use, so the numbers here add
  // up to what the Balances section will show once it is saved. Only shown
  // when several people paid: with one payer every other participant simply
  // owes them the share beside their checkbox, so the list would restate
  // the split card. With several payers the net-then-overlap attribution
  // cannot be read off the inputs, and this is the one place to check it
  // before it lands in the ledger.
  const previewDebts = (() => {
    if (
      !selectedGroup ||
      payerPlan === null ||
      payerPlan.amounts === null ||
      amountMinorUnits === null ||
      !plan.amounts ||
      plan.amounts.size === 0
    ) {
      return null;
    }
    const payers = Array.from(
      payerPlan.amounts,
      ([user_id, amount_minor_units]) => ({ user_id, amount_minor_units }),
    );
    const splits = Array.from(plan.amounts, ([user_id, amount_minor_units]) => ({
      user_id,
      amount_minor_units,
    }));
    return attributeExpenseDebts(payers, splits);
  })();
  const groupNamer = groupMemberNamer(selectedGroup ?? undefined, userId);

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
      <fieldset disabled={locked} className="space-y-4">
        {readOnly && (
          <p className="flex items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300">
            <span className="mt-0.5 shrink-0 text-zinc-400">
              <InfoIcon />
            </span>
            {readOnly}
          </p>
        )}

        {expense && expenseNamer && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Added by {expenseNamer(expense.created_by)} ·{" "}
            <LocalTime iso={expense.created_at} />
          </p>
        )}

        <div>
          <label htmlFor="description" className={labelClasses}>
            Description
          </label>
          <input
            id="description"
            type="text"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Groceries, cab fare…"
            autoFocus={!expense && !readOnly}
            className={inputClasses}
          />
        </div>

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
            className={inputClasses}
          >
            {foreignCategoryId && (
              <option value={foreignCategoryId}>
                Kept as set by {expenseNamer?.(expense!.created_by) ?? "its author"}
              </option>
            )}
            <option value="">No category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          {foreignCategoryId && (
            <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              Categories are personal, so you can&apos;t see theirs. It stays
              unless you pick one of yours.
            </p>
          )}
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
                value={payerMode === "several" ? SEVERAL : effectivePaidBy}
                onChange={(event) => changePaidBy(event.target.value)}
                className={inputClasses}
              >
                {members.map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {nameOf(member.user_id, member.label)}
                  </option>
                ))}
                {members.length > 1 && (
                  <option value={SEVERAL}>Several people…</option>
                )}
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

        {selectedGroup && payerPlan && (
          <fieldset>
            <legend className={labelClasses}>Who paid what</legend>
            <div className="mt-1.5 grid grid-cols-1 gap-2">
              {members.map((member) => {
                const checked = effectivePayerIds.includes(member.user_id);
                const name = nameOf(member.user_id, member.label);
                return (
                  <div key={member.user_id} className={memberRowClasses}>
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          togglePayer(member.user_id, event.target.checked)
                        }
                        className="h-4 w-4 accent-emerald-600"
                      />
                      <span className="min-w-0 flex-1 truncate">{name}</span>
                    </label>

                    {checked && (
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label={`${name} — paid`}
                        value={payerInputs[member.user_id] ?? ""}
                        onChange={(event) =>
                          setPayerInputs((current) => ({
                            ...current,
                            [member.user_id]: event.target.value,
                          }))
                        }
                        placeholder="0"
                        className={`${amountInputClasses} shrink-0`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <p
              className={`mt-1.5 text-xs ${
                payerPlan.error && amountMinorUnits !== null
                  ? "text-amber-700 dark:text-amber-400"
                  : "text-zinc-500 dark:text-zinc-400"
              }`}
            >
              {payerPlan.footer}
            </p>
          </fieldset>
        )}

        {selectedGroup && members.length > 0 && (
          <fieldset>
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
              className={`mt-1.5 grid grid-cols-1 gap-2 ${splitMode === "equal" ? "sm:grid-cols-2" : ""}`}
            >
              {members.map((member) => {
                const checked = effectiveParticipants.includes(member.user_id);
                const share = plan.amounts?.get(member.user_id);
                const name = nameOf(member.user_id, member.label);
                return (
                  <div key={member.user_id} className={memberRowClasses}>
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
                          className={amountInputClasses}
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

        {selectedGroup && previewDebts && (
          <section>
            <h3 className={labelClasses}>Who owes whom for this</h3>
            {previewDebts.length === 0 ? (
              <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                Nobody — everyone pays exactly their share.
              </p>
            ) : (
              <ul className="mt-1.5 divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-700">
                {previewDebts.map((debt) => {
                  const iOwe = debt.from === userId;
                  const owedToMe = debt.to === userId;
                  return (
                    <li
                      key={`${debt.from}|${debt.to}`}
                      className="flex items-center gap-3 px-3 py-2 text-sm"
                    >
                      <p className="min-w-0 flex-1 truncate text-zinc-900 dark:text-zinc-100">
                        <span className="font-medium">
                          {groupNamer(debt.from, { sentence: true })}
                        </span>
                        {iOwe ? " owe " : " owes "}
                        <span className="font-medium">{groupNamer(debt.to)}</span>
                      </p>
                      <p
                        className={`shrink-0 font-medium tabular-nums ${
                          iOwe
                            ? "text-red-600 dark:text-red-400"
                            : owedToMe
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-zinc-900 dark:text-zinc-100"
                        }`}
                      >
                        {formatMinorUnits(debt.minorUnits, currency)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {expense && activity.length > 0 && (
          <section>
            <h3 className={labelClasses}>History</h3>
            <ul className="mt-1 divide-y divide-zinc-100 dark:divide-zinc-800">
              {activity.map((entry) => (
                <ActivityItem
                  key={entry.id}
                  entry={entry}
                  group={selectedGroup ?? undefined}
                  userId={userId}
                  compact
                />
              ))}
            </ul>
          </section>
        )}
      </fieldset>
      </div>

      <div className="shrink-0 border-t border-zinc-200 bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 dark:border-zinc-800 dark:bg-zinc-900 sm:px-5">
        {error && (
          <p
            role="alert"
            className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
          >
            {error}
          </p>
        )}
        <div className="flex gap-3">
          {readOnly === null && (
            <button
              type="submit"
              disabled={pending}
              className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none dark:focus:ring-offset-zinc-950"
            >
              {pending ? "Saving…" : expense ? "Save changes" : "Add expense"}
            </button>
          )}
          <button
            type="button"
            onClick={onDone}
            disabled={pending}
            className={`rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 ${
              readOnly === null ? "flex-1 sm:flex-none" : "w-full sm:w-auto"
            }`}
          >
            {readOnly === null ? "Cancel" : "Close"}
          </button>
        </div>
      </div>
    </form>
  );
}
